# backend/seed.py
# Run once: python -m backend.seed

from .database import SessionLocal, engine, Base
from .models.models import User, UserRole, Product, Doctor, CommercialModel, Region
from .auth.auth import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()


def seed():
    print("Seeding Fortel CRM database...")

    # ── Admin user ── (fixed credentials, never shown to field users)
    if not db.query(User).filter(User.email == "admin@fortel.in").first():
        db.add(User(
            name="System Admin",
            email="admin@fortel.in",
            password_hash=hash_password("admin2026"),
            role=UserRole.admin,
            must_reset_password=False,
            is_active=True,
        ))
        print("  ✓ Admin user created: admin@fortel.in / admin2026")

    db.commit()

    # ── Products (from SATYA DISTRIBUTORS report) ──
    products = [
        {"name": "Amtrios Softgel Cap 30",  "rate": 3619.0, "pack_size": "30 caps"},
        {"name": "Lycoturm Syrup 200ml",     "rate": 1714.0, "pack_size": "200ml"},
        {"name": "Nutria Capsules 1x10s",    "rate": 159.0,  "pack_size": "10 caps"},
        {"name": "Caximeg Oral Susp 60ml",   "rate": 906.0,  "pack_size": "60ml"},
        {"name": "Zolvera Lotion 150ml",     "rate": 593.0,  "pack_size": "150ml"},
        {"name": "Xerowet MD Bottle",        "rate": 850.0,  "pack_size": "Bottle"},
        {"name": "Xenocaine Viscous",        "rate": 420.0,  "pack_size": "Tube"},
        {"name": "Nunexa 400GM",             "rate": 2100.0, "pack_size": "400g"},
        {"name": "Refilac Cap 10s",          "rate": 310.0,  "pack_size": "10 caps"},
        {"name": "Oncodol 50 Tab",           "rate": 480.0,  "pack_size": "50 tabs"},
        {"name": "Emwet Spray",              "rate": 375.0,  "pack_size": "Spray"},
        {"name": "Zyora Mouthwash 500ml",    "rate": 290.0,  "pack_size": "500ml"},
    ]
    for p in products:
        if not db.query(Product).filter(Product.name == p["name"]).first():
            db.add(Product(**p))

    # ── South India regions ──
    for code, name in [("TN","Tamil Nadu"),("AP","Andhra Pradesh"),("TS","Telangana"),("KL","Kerala"),("KA","Karnataka")]:
        if not db.query(Region).filter(Region.state_code == code).first():
            db.add(Region(state_code=code, state_name=name))

    # ── Sample doctors ──
    doctors = [
        {"name": "Dr. Anand, P.",     "hospital": "Apollo Hospitals",   "state_code": "TN", "commercial_model": CommercialModel.U1, "expected_multiple": 5.0},
        {"name": "Dr. Rajanna",       "hospital": "SIMS Hospital",      "state_code": "TN", "commercial_model": CommercialModel.P1, "expected_multiple": 5.0},
        {"name": "Dr. Mehta, R.",     "hospital": "MIOT International", "state_code": "TN", "commercial_model": CommercialModel.N1, "expected_multiple": 3.0},
        {"name": "Dr. Savitri",       "hospital": "Private Clinic",     "state_code": "TN", "commercial_model": CommercialModel.U2, "expected_multiple": 5.0},
        {"name": "Dr. Darwin",        "hospital": "Private Clinic",     "state_code": "AP", "commercial_model": CommercialModel.D1, "expected_multiple": 5.0},
        {"name": "Dr. Priya Sharma",  "hospital": "Yashoda Hospitals",  "state_code": "TS", "commercial_model": CommercialModel.P2, "expected_multiple": 6.0},
        {"name": "Dr. Venkat Rao",    "hospital": "KIMS Hospital",      "state_code": "AP", "commercial_model": CommercialModel.R1, "expected_multiple": 5.0},
        {"name": "Dr. Lakshmi",       "hospital": "Amrita Institute",   "state_code": "KL", "commercial_model": CommercialModel.N1, "expected_multiple": 4.0},
        {"name": "Dr. Srinivas",      "hospital": "Manipal Hospital",   "state_code": "KA", "commercial_model": CommercialModel.U1, "expected_multiple": 5.0},
        {"name": "Dr. Ramesh Kumar",  "hospital": "Fortis Hospital",    "state_code": "KA", "commercial_model": CommercialModel.P1, "expected_multiple": 5.0},
    ]
    for d in doctors:
        if not db.query(Doctor).filter(Doctor.name == d["name"]).first():
            db.add(Doctor(**d))

    db.commit()
    print("  ✓ Products, regions, doctors seeded")
    print("\n✅ Seed complete.")
    print("\n─── Admin Login ───────────────────────────")
    print("   URL      : http://localhost:3000")
    print("   Email    : admin@fortel.in")
    print("   Password : admin2026")
    print("──────────────────────────────────────────\n")
    db.close()


if __name__ == "__main__":
    seed()
