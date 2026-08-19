"""Seed the primary-sales stockist master and create the two back-office logins."""

import json

from sqlalchemy import func

from backend.auth.auth import generate_password, hash_password
from backend.database import Base, SessionLocal, engine
from backend.models.models import User
from backend.services.primary_sales_import import ensure_seed_stockists


STAFF_ACCOUNTS = (
    ("Staff 1", "staff1@fortel.in"),
    ("Staff 2", "staff2@fortel.in"),
)


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    result = {"stockists": 0, "reports_to": None, "users": []}
    try:
        stockists = ensure_seed_stockists(db)
        result["stockists"] = len(stockists)
        hanni = db.query(User).filter(func.lower(User.name).like("%hanni%")).order_by(User.is_active.desc(), User.id).first()
        if not hanni:
            raise RuntimeError("Could not find Hanni in the user list; no staff users were created")
        result["reports_to"] = {"id": hanni.id, "name": hanni.name, "email": hanni.email}

        for name, email in STAFF_ACCOUNTS:
            user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
            if user:
                user.name = name
                user.role = "back_office"
                user.custom_role_name = None
                user.reports_to_id = hanni.id
                user.is_active = True
                result["users"].append({"id": user.id, "name": user.name, "email": user.email, "status": "updated"})
                continue

            temporary_password = generate_password(16)
            user = User(
                name=name,
                email=email,
                password_hash=hash_password(temporary_password),
                role="back_office",
                reports_to_id=hanni.id,
                must_reset_password=True,
                is_active=True,
            )
            db.add(user)
            db.flush()
            result["users"].append({
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "temporary_password": temporary_password,
                "must_reset_password": True,
                "status": "created",
            })
        db.commit()
        print(json.dumps(result, indent=2))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
