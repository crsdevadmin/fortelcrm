# backend/create_new_users.py
# Run: python -m backend.create_new_users

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from backend.database import SessionLocal
from backend.models.models import User, UserRole
from backend.auth.auth import generate_password, hash_password

db = SessionLocal()

NEW_USERS = [
    {
        "name": "K Sathish Kumar",
        "email": "sathish.k@fortel.in",
        "personal_email": "sathishkaruppusamy@gmail.com",
        "phone": "9944635099",
        "role": UserRole.custom,
        "custom_role_name": "Key Accounts Manager",
        "city": "Coimbatore",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Mahesh C",
        "email": "mahesh.c@fortel.in",
        "personal_email": "getisaaconline@gmail.com",
        "phone": "9003693033",
        "role": UserRole.custom,
        "custom_role_name": "Key Accounts Manager",
        "city": "Madurai",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Manikanda Prabhu M",
        "email": "manikanda.prabhu@fortel.in",
        "personal_email": "prabhuyogham85@gmail.com",
        "phone": "9965552110",
        "role": UserRole.custom,
        "custom_role_name": "Regional Manager",
        "city": "Madurai",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Hanni Wilfred",
        "email": "hanni.wilfred@fortel.in",
        "personal_email": "hannimathew@yahoo.com",
        "phone": "9940412798",
        "role": UserRole.director,
        "custom_role_name": None,
        "city": "Chennai",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Sivasakthi S",
        "email": "sivasakthi@fortel.in",
        "personal_email": "ssiva4918@gmail.com",
        "phone": "8124309024",
        "role": UserRole.custom,
        "custom_role_name": "Area Business Executive",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Suresh Kamalraj K",
        "email": "suresh.k@fortel.in",
        "personal_email": "ksureshkamal92@gmail.com",
        "phone": "8508552483",
        "role": UserRole.custom,
        "custom_role_name": "Key Accounts Manager",
        "city": "Coimbatore",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Siva Kumar D",
        "email": "siva.kumar@fortel.in",
        "personal_email": "microsiva76@gmail.com",
        "phone": "9840220350",
        "role": UserRole.custom,
        "custom_role_name": "Zonal Manager",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "password": generate_password(16),
    },
    {
        "name": "Vigneswar M",
        "email": "vigneswar.m@fortel.in",
        "personal_email": "saravanavigneswar7@gmail.com",
        "phone": "9946799913",
        "role": UserRole.custom,
        "custom_role_name": "Key Accounts Manager",
        "city": "Cochin",
        "state": "Kerala",
        "password": generate_password(16),
    },
]

created = 0
skipped = 0

for u in NEW_USERS:
    existing = db.query(User).filter(User.email == u["email"]).first()
    if existing:
        print(f"  ⚠ SKIP (exists): {u['name']} → {u['email']}")
        skipped += 1
        continue

    user = User(
        name=u["name"],
        email=u["email"],
        personal_email=u["personal_email"],
        phone=u["phone"],
        role=u["role"],
        custom_role_name=u["custom_role_name"],
        city=u["city"],
        state=u["state"],
        password_hash=hash_password(u["password"]),
        must_reset_password=True,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"  ✅ Created: {user.name} ({user.display_role}) → {user.email} / {u['password']}")
    created += 1

db.close()
print(f"\nDone. Created: {created}  Skipped: {skipped}")
