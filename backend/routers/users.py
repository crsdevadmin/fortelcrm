# backend/routers/users.py
# Admin-controlled user management — create, assign, hierarchy, password

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime

from ..database import get_db
from ..models.models import User, UserRole, UserRegionalTerritory
from ..auth.auth import MIN_PASSWORD_LENGTH, generate_password, get_current_user, hash_password, require_roles
from ..utils.hierarchy import get_subtree_ids
from ..utils.regional_territories import (
    REGIONAL_TERRITORIES,
    can_manage_multiple_territories,
    direct_territories,
    normalize_territories,
    visible_territories,
)

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
    regional_territories: List[str] = Field(default_factory=list)


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
    regional_territories: Optional[List[str]] = None


class UserTerritoriesRequest(BaseModel):
    territories: List[str] = Field(default_factory=list)


def _replace_user_territories(user_id: int, territories, db: Session):
    try:
        normalized = normalize_territories(territories)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.query(UserRegionalTerritory).filter(UserRegionalTerritory.user_id == user_id).delete()
    for territory in normalized:
        db.add(UserRegionalTerritory(user_id=user_id, territory=territory))
    return normalized


# ── Create user (Admin only) ──────────────────

@router.post("/create")
def create_user(
    payload: CreateUserRequest,
    current_user: User = Depends(require_roles("admin", "md")),
    db: Session = Depends(get_db),
):
    """
    Admin creates a user.
    - Email is the username
    - Password auto-generated if not provided
    - User must reset password on first login
    """
    existing = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")

    if payload.password is not None and len(payload.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Temporary password must be at least {MIN_PASSWORD_LENGTH} characters")
    auto_pwd = payload.password or generate_password(16)
    user = User(
        name=payload.name,
        email=payload.email.lower().strip(),
        personal_email=payload.personal_email,
        password_hash=hash_password(auto_pwd),
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
    db.flush()
    assigned_territories = _replace_user_territories(user.id, payload.regional_territories, db)
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "display_role": user.display_role,
        "regional_territories": assigned_territories,
        "temp_password": auto_pwd,    # admin shows this to the user for first login
        "must_reset_password": True,
    }


# ── List all users ────────────────────────────

@router.get("/")
def list_users(
    role: Optional[str] = None,
    viewer_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)

    # Role-scoped: only show users in the viewer's subtree
    if viewer_id is not None and viewer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Viewer does not match the logged-in user")
    if current_user.role not in {"admin", "md"}:
        subtree = get_subtree_ids(current_user.id, db)
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
            "role": u.role, "display_role": u.display_role,
            "custom_role_name": u.custom_role_name,
            "is_active": u.is_active,
            "must_reset_password": getattr(u, "must_reset_password", False),
            "reports_to_id": u.reports_to_id,
            "reports_to_name": u.reports_to.name if u.reports_to else None,
            "regional_territories": direct_territories(u.id, db),
            "created_at": u.created_at,
        }
        for u in users
    ]


# ── Full hierarchy tree  (must be BEFORE /{user_id}) ─────────

@router.get("/hierarchy/tree")
def get_hierarchy_tree(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    visible_ids = get_subtree_ids(current_user.id, db)
    q = db.query(User).filter(User.is_active == True)
    if visible_ids is not None:
        q = q.filter(User.id.in_(visible_ids))
    all_users = q.all()
    visited = set()

    def build_node(user):
        if user.id in visited:
            return None
        visited.add(user.id)
        children = [u for u in all_users if u.reports_to_id == user.id]
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "personal_email": getattr(user, 'personal_email', None),
            "city": getattr(user, 'city', None),
            "state": getattr(user, 'state', None),
            "role": user.role,
            "display_role": user.display_role,
            "custom_role_name": user.custom_role_name,
            "regional_territories": direct_territories(user.id, db),
            "is_active": user.is_active,
            "reports": [node for c in children if (node := build_node(c)) is not None],
        }

    visible_user_ids = {u.id for u in all_users}
    roots = [u for u in all_users if (u.reports_to_id is None or u.reports_to_id not in visible_user_ids) and u.role != "admin"]
    return [build_node(r) for r in roots]


@router.get("/regional-territories/options")
def get_regional_territory_options():
    return list(REGIONAL_TERRITORIES)


# ── Get single user ───────────────────────────

@router.get("/{user_id}")
def get_user(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and user_id not in visible_ids:
        raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role, "display_role": user.display_role,
        "custom_role_name": user.custom_role_name,
        "phone": user.phone, "is_active": user.is_active,
        "must_reset_password": getattr(user, "must_reset_password", False),
        "reports_to_id": user.reports_to_id,
        "reports_to_name": user.reports_to.name if user.reports_to else None,
        "regional_territories": direct_territories(user.id, db),
        "has_reportees": db.query(User.id).filter(User.reports_to_id == user.id, User.is_active == True).first() is not None,
    }


@router.get("/{user_id}/regional-territories/access")
def get_user_regional_territory_access(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and user_id not in visible_ids:
        raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    visible = visible_territories(user_id, db)
    return {
        "direct_territories": direct_territories(user_id, db),
        "visible_territories": list(REGIONAL_TERRITORIES) if visible is None else [
            territory for territory in REGIONAL_TERRITORIES if territory in visible
        ],
        "can_view_all": visible is None,
        "can_manage_multiple": can_manage_multiple_territories(user_id, db),
    }


@router.put("/{user_id}/regional-territories")
def update_user_regional_territories(
    user_id: int,
    payload: UserTerritoriesRequest,
    current_user: User = Depends(require_roles("admin", "md")),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    territories = _replace_user_territories(user_id, payload.territories, db)
    db.commit()
    return {"status": "updated", "user_id": user_id, "regional_territories": territories}


# ── Update user ───────────────────────────────

@router.patch("/{user_id}")
def update_user(user_id: int, payload: UpdateUserRequest, current_user: User = Depends(require_roles("admin", "md")), db: Session = Depends(get_db)):
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
    if payload.regional_territories is not None:
        _replace_user_territories(user_id, payload.regional_territories, db)
    db.commit()
    return {"status": "updated", "user_id": user_id}


# ── Change reporting line ─────────────────────

@router.patch("/{user_id}/reports-to")
def change_reporting(user_id: int, reports_to_id: Optional[int] = None, current_user: User = Depends(require_roles("admin", "md")), db: Session = Depends(get_db)):
    """
    Admin can reassign who any user reports to at any time.
    Existing data (sales, investments) is never deleted.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if reports_to_id == user_id:
        raise HTTPException(status_code=400, detail="A user cannot report to themselves")
    if reports_to_id is not None:
        manager = db.query(User).filter(User.id == reports_to_id, User.is_active == True).first()
        if not manager:
            raise HTTPException(status_code=404, detail="Reporting manager not found")
        descendants = get_subtree_ids(user_id, db)
        if descendants is None or reports_to_id in descendants:
            raise HTTPException(status_code=400, detail="Reporting change would create a hierarchy cycle")
    user.reports_to_id = reports_to_id
    db.commit()
    return {"status": "reporting updated", "user_id": user_id, "reports_to_id": reports_to_id}


# ── Deactivate user ───────────────────────────

@router.delete("/{user_id}")
def deactivate_user(user_id: int, current_user: User = Depends(require_roles("admin", "md")), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot deactivate admin")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    user.is_active = False
    db.commit()
    return {"status": "deactivated"}
