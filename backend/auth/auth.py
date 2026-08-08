# backend/auth/auth.py
# Email + Password login with JWT. No Google OAuth.

import secrets
import string
import json
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from ..database import get_db
from ..models.models import User, UserRole
from ..core.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Password helpers ─────────────────────────

def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)

def generate_password(length: int = 10) -> str:
    """Auto-generate a random password for new users."""
    chars = string.ascii_letters + string.digits + "!@#$"
    return ''.join(secrets.choice(chars) for _ in range(length))

def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "role": role, "exp": expire},
                      settings.SECRET_KEY, algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the active user exclusively from the Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Login required")
    data = decode_token(token)
    try:
        user_id = int(data.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid login token")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User account is not active")
    return user


def require_roles(*roles: str):
    allowed = set(roles)

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise HTTPException(status_code=403, detail="You are not permitted to perform this action")
        return current_user

    return dependency


async def enforce_request_identity(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Reject caller-supplied identity claims that are outside the logged-in user's scope."""
    from ..utils.hierarchy import get_subtree_ids

    direct_identity_fields = {
        "viewer_id", "actor_id", "approver_id", "approved_by_id",
        "user_id", "assigned_by_id", "created_by_id",
    }
    accessible_ids = get_subtree_ids(current_user.id, db)

    def check(field: str, value):
        if value in (None, ""):
            return
        try:
            claimed_id = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid {field}")
        if field in direct_identity_fields and claimed_id != current_user.id:
            raise HTTPException(status_code=403, detail=f"{field} does not match the logged-in user")
        if field == "associate_id" and accessible_ids is not None and claimed_id not in accessible_ids:
            raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")

    for field in direct_identity_fields | {"associate_id"}:
        check(field, request.query_params.get(field))

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        raw_body = await request.body()
        if raw_body:
            try:
                payload = json.loads(raw_body)
            except (TypeError, ValueError):
                payload = None
            if isinstance(payload, dict):
                for field in direct_identity_fields | {"associate_id"}:
                    check(field, payload.get(field))
    return current_user


# ── Schemas ───────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    new_password: str

class AdminResetPasswordRequest(BaseModel):
    user_id: int
    new_password: Optional[str] = None   # if None, auto-generate


# ── Login ─────────────────────────────────────

@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Email + password login.
    Returns JWT + must_reset_password flag.
    """
    email = payload.email.lower().strip()

    # Enforce @fortel.in domain (admin@fortel.in is the only exception if needed)
    if not email.endswith('@fortel.in'):
        raise HTTPException(status_code=401, detail="Only @fortel.in accounts are allowed.")

    user = db.query(User).filter(User.email == email).first()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact admin.")

    token = create_access_token(user.id, user.role if isinstance(user.role, str) else user.role.value)

    return {
        "access_token": token,
        "token_type": "bearer",
        "must_reset_password": getattr(user, "must_reset_password", False),
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role if isinstance(user.role, str) else user.role.value,
            "display_role": getattr(user, "display_role", None),
            "custom_role_name": getattr(user, "custom_role_name", None),
            "reports_to_id": getattr(user, "reports_to_id", None),
        }
    }


# ── Change own password (forced on first login) ──

@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(payload.new_password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    current_user.password_hash = hash_password(payload.new_password)
    if hasattr(current_user, "must_reset_password"): current_user.must_reset_password = False
    db.commit()
    return {"status": "password changed"}


# ── Admin: reset any user's password ──────────

@router.post("/admin/reset-password")
def admin_reset_password(
    payload: AdminResetPasswordRequest,
    current_user: User = Depends(require_roles("admin", "md")),
    db: Session = Depends(get_db),
):
    """Admin can reset any user's password. Returns the new password."""
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Use change password for your own account")
    if current_user.role == "md" and user.role in {"admin", "md"}:
        raise HTTPException(status_code=403, detail="You cannot reset this account")

    new_pwd = payload.new_password or generate_password(16)
    if len(new_pwd) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    user.password_hash = hash_password(new_pwd)
    if hasattr(user, "must_reset_password"): user.must_reset_password = True    # force user to reset on next login
    db.commit()
    return {"status": "reset", "new_password": new_pwd, "user_email": user.email}


# ── Current user info ──────────────────────────

@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role if isinstance(user.role, str) else user.role.value, "display_role": getattr(user, "display_role", None),
        "custom_role_name": getattr(user, "custom_role_name", None),
        "must_reset_password": getattr(user, "must_reset_password", False),
        "reports_to_id": getattr(user, "reports_to_id", None),
    }
