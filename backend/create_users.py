# Run from fortel-crm folder:  python -m backend.create_users
from .database import SessionLocal
from .models.models import User, UserRole
from .auth.auth import generate_password, hash_password

db = SessionLocal()

try:
    # ── Thirumurugan D — MD ───────────────────────
    thiru = db.query(User).filter(User.email == "thirumurugan@fortel.in").first()
    if not thiru:
        thiru_password = generate_password(16)
        thiru = User(
            name="Thirumurugan D",
            email="thirumurugan@fortel.in",
            phone="9677150981",
            role=UserRole.md,
            password_hash=hash_password(thiru_password),
            must_reset_password=True,
            is_active=True,
        )
        db.add(thiru)
        db.flush()
        print(f"✅ Created Thirumurugan D  →  thirumurugan@fortel.in  /  {thiru_password}")
    else:
        print(f"✓  Thirumurugan D already exists (id={thiru.id})")

    db.flush()

    # ── B.Vani — Key Account Manager ─────────────
    vani = db.query(User).filter(User.email == "bvani@fortel.in").first()
    if not vani:
        vani_password = generate_password(16)
        vani = User(
            name="B.Vani",
            email="bvani@fortel.in",
            phone="9652129858",
            role=UserRole.custom,
            custom_role_name="Key Account Manager",
            password_hash=hash_password(vani_password),
            must_reset_password=True,
            reports_to_id=thiru.id,
            city="Hyderabad",
            state="Telangana",
            is_active=True,
        )
        db.add(vani)
        db.flush()
        print(f"✅ Created B.Vani  →  bvani@fortel.in  /  {vani_password}")
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
