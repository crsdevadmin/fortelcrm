# backend/routers/users.py
# Admin-controlled user management — create, assign, hierarchy, password

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime

from ..database import get_db
from ..models.models import User, UserRole
from ..auth.auth import hash_password, generate_password
from ..utils.hierarchy import get_subtree_ids

router = APIRouter(prefix="/users", tags=["Users"])


# ── Schemas ───────────────────────────────────

class CreateUserRequest(BaseModel):
    name: str
    email: str
    role: UserRole
    custom_role_name: Optional[str] = None
    reports_to_id: Optional[int] = None
    phone: Optional[str] = None
    personal_email: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    password: Optional[str] = None


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[UserRole] = None
    custom_role_name: Optional[str] = None
    reports_to_id: Optional[int] = None
    phone: Optional[str] = None
    personal_email: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    is_active: Optional[bool] = None


# ── Create user (Admin only) ──────────────────

@router.post("/create")
def create_user(payload: CreateUserRequest, db: Session = Depends(get_db)):
    """
    Admin creates a user.
    - Email is the username
    - Password auto-generated if not provided
    - User must reset password on first login
    """
    existing = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")

    auto_pwd = payload.password or generate_password()
    user = User(
        name=payload.name,
        email=payload.email.lower().strip(),
        personal_email=payload.personal_email,
        password_hash=hash_password(auto_pwd),
        plain_password=auto_pwd,
        role=payload.role,
        custom_role_name=payload.custom_role_name,
        reports_to_id=payload.reports_to_id,
        phone=payload.phone,
        city=payload.city,
        state=payload.state,
        must_reset_password=True,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role.value,
        "display_role": user.display_role,
        "temp_password": auto_pwd,    # admin shows this to the user for first login
        "must_reset_password": True,
    }


# ── List all users ────────────────────────────

@router.get("/")
def list_users(role: Optional[str] = None, viewer_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)

    # Role-scoped: only show users in the viewer's subtree
    if viewer_id:
        subtree = get_subtree_ids(viewer_id, db)
        if subtree is not None:           # None = admin/md, sees all
            q = q.filter(User.id.in_(subtree))

    users = q.order_by(User.created_at).all()
    return [
        {
            "id": u.id, "name": u.name, "email": u.email,
            "personal_email": getattr(u, 'personal_email', None),
            "phone": u.phone,
            "city": getattr(u, 'city', None),
            "state": getattr(u, 'state', None),
            "plain_password": getattr(u, 'plain_password', None),
            "role": u.role.value, "display_role": u.display_role,
            "custom_role_name": u.custom_role_name,
            "is_active": u.is_active,
            "must_reset_password": u.must_reset_password,
            "reports_to_id": u.reports_to_id,
            "reports_to_name": u.reports_to.name if u.reports_to else None,
            "created_at": u.created_at,
        }
        for u in users
    ]


# ── Full hierarchy tree  (must be BEFORE /{user_id}) ─────────

@router.get("/hierarchy/tree")
def get_hierarchy_tree(db: Session = Depends(get_db)):
    all_users = db.query(User).filter(User.is_active == True).all()

    def build_node(user):
        children = [u for u in all_users if u.reports_to_id == user.id]
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "personal_email": getattr(user, 'personal_email', None),
            "city": getattr(user, 'city', None),
            "state": getattr(user, 'state', None),
            "role": user.role.value,
            "display_role": user.display_role,
            "custom_role_name": user.custom_role_name,
            "is_active": user.is_active,
            "reports": [build_node(c) for c in children],
        }

    roots = [u for u in all_users if u.reports_to_id is None and u.role != UserRole.admin]
    return [build_node(r) for r in roots]


# ── Get single user ───────────────────────────

@router.get("/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role.value, "display_role": user.display_role,
        "custom_role_name": user.custom_role_name,
        "phone": user.phone, "is_active": user.is_active,
        "must_reset_password": user.must_reset_password,
        "reports_to_id": user.reports_to_id,
        "reports_to_name": user.reports_to.name if user.reports_to else None,
    }


# ── Update user ───────────────────────────────

@router.patch("/{user_id}")
def update_user(user_id: int, payload: UpdateUserRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.name is not None:             user.name = payload.name
    if payload.role is not None:             user.role = payload.role
    if payload.custom_role_name is not None: user.custom_role_name = payload.custom_role_name
    if payload.reports_to_id is not None:    user.reports_to_id = payload.reports_to_id
    if payload.phone is not None:            user.phone = payload.phone
    if payload.personal_email is not None:   user.personal_email = payload.personal_email
    if payload.city is not None:             user.city = payload.city
    if payload.state is not None:            user.state = payload.state
    if payload.is_active is not None:        user.is_active = payload.is_active
    db.commit()
    return {"status": "updated", "user_id": user_id}


# ── Change reporting line ─────────────────────

@router.patch("/{user_id}/reports-to")
def change_reporting(user_id: int, reports_to_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    Admin can reassign who any user reports to at any time.
    Existing data (sales, investments) is never deleted.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.reports_to_id = reports_to_id
    db.commit()
    return {"status": "reporting updated", "user_id": user_id, "reports_to_id": reports_to_id}


# ── Deactivate user ───────────────────────────

@router.delete("/{user_id}")
def deactivate_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.admin:
        raise HTTPException(status_code=400, detail="Cannot deactivate admin")
    user.is_active = False
    db.commit()
    return {"status": "deactivated"}
