# backend/auth/auth.py
# Email + Password login with JWT. No Google OAuth.

import secrets
import string
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
from fastapi import APIRouter, Depends, HTTPException, status
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


# ── Schemas ───────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    token: str
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

    token = create_access_token(user.id, user.role.value)

    return {
        "access_token": token,
        "token_type": "bearer",
        "must_reset_password": user.must_reset_password,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
            "display_role": user.display_role,
            "custom_role_name": user.custom_role_name,
            "reports_to_id": user.reports_to_id,
        }
    }


# ── Change own password (forced on first login) ──

@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, db: Session = Depends(get_db)):
    data = decode_token(payload.token)
    user = db.query(User).filter(User.id == int(data["sub"])).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user.password_hash = hash_password(payload.new_password)
    user.plain_password = payload.new_password
    user.must_reset_password = False
    db.commit()
    return {"status": "password changed"}


# ── Admin: reset any user's password ──────────

@router.post("/admin/reset-password")
def admin_reset_password(payload: AdminResetPasswordRequest, db: Session = Depends(get_db)):
    """Admin can reset any user's password. Returns the new password."""
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_pwd = payload.new_password or generate_password()
    user.password_hash = hash_password(new_pwd)
    user.plain_password = new_pwd
    user.must_reset_password = True    # force user to reset on next login
    db.commit()
    return {"status": "reset", "new_password": new_pwd, "user_email": user.email}


# ── Current user info ──────────────────────────

@router.get("/me")
def get_me(token: str, db: Session = Depends(get_db)):
    data = decode_token(token)
    user = db.query(User).filter(User.id == int(data["sub"])).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role.value, "display_role": user.display_role,
        "custom_role_name": user.custom_role_name,
        "must_reset_password": user.must_reset_password,
        "reports_to_id": user.reports_to_id,
    }
