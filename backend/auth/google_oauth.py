# backend/auth/google_oauth.py
# Google OAuth 2.0 login + JWT token generation

import httpx
from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import User, UserRole
from ..core.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


@router.get("/google/login")
def google_login():
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{query}")


@router.get("/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        })
        token_data = token_resp.json()
        access_token = token_data.get("access_token")

        user_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        google_user = user_resp.json()

    email = google_user.get("email")
    name = google_user.get("name")
    picture = google_user.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="Could not retrieve email from Google")

    user = db.query(User).filter(User.email == email).first()

    if not user:
        user = User(
            email=email,
            name=name,
            profile_picture=picture,
            role=UserRole.associate,
            is_approved=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"status": "pending_approval", "email": email, "name": name}

    if not user.is_approved:
        return {"status": "pending_approval", "email": email, "name": name}

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    token = create_access_token(user.id, user.role.value)
    return {
        "status": "success",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
            "picture": user.profile_picture,
        }
    }


@router.get("/me")
def get_current_user_info(token: str, db: Session = Depends(get_db)):
    payload = decode_token(token)
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role.value, "is_approved": user.is_approved,
        "picture": user.profile_picture,
    }
