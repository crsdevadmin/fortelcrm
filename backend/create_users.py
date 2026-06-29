# Run from fortel-crm folder:  python -m backend.create_users
from .database import SessionLocal
from .models.models import User, UserRole
from .auth.auth import hash_password

db = SessionLocal()

try:
    # ── Thirumurugan D — MD ───────────────────────
    thiru = db.query(User).filter(User.email == "thirumurugan@fortel.in").first()
    if not thiru:
        thiru = User(
            name="Thirumurugan D",
            email="thirumurugan@fortel.in",
            phone="9677150981",
            role=UserRole.md,
            password_hash=hash_password("Fortel@2025"),
            must_reset_password=False,
            is_active=True,
        )
        db.add(thiru)
        db.flush()
        print(f"✅ Created Thirumurugan D  →  thirumurugan@fortel.in  /  Fortel@2025")
    else:
        print(f"✓  Thirumurugan D already exists (id={thiru.id})")

    db.flush()

    # ── B.Vani — Key Account Manager ─────────────
    vani = db.query(User).filter(User.email == "bvani@fortel.in").first()
    if not vani:
        vani = User(
            name="B.Vani",
            email="bvani@fortel.in",
            phone="9652129858",
            role=UserRole.custom,
            custom_role_name="Key Account Manager",
            password_hash=hash_password("Fortel@2025"),
            must_reset_password=True,
            reports_to_id=thiru.id,
            city="Hyderabad",
            state="Telangana",
            is_active=True,
        )
        db.add(vani)
        db.flush()
        print(f"✅ Created B.Vani  →  bvani@fortel.in  /  Fortel@2025")
        print(f"   Reports to: Thirumurugan D")
    else:
        print(f"✓  B.Vani already exists (id={vani.id})")

    db.commit()
    print("\nDone. Both users created. Refresh User Management page.")

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
finally:
    db.close()
