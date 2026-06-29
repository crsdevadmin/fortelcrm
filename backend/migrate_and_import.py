"""
Run from the fortel-crm folder:
  python -m backend.migrate_and_import

This script:
  1. Adds new columns to the doctors and users tables (safe — skips if already exist)
  2. Creates Thirumurugan D (MD) and B.Vani (Key Account Manager) if they don't exist
  3. Imports all 228 client records from the Excel file
  4. Maps every doctor/pharmacy to B.Vani (rep) under Thirumurugan D (manager)
"""

import os, sys, re
from pathlib import Path

# ── locate the Excel file ──────────────────────────────────────
XLS_CANDIDATES = [
    Path(__file__).parent.parent / "client14789400731781953472.xls",
    Path(os.environ.get("USERPROFILE", "~")).expanduser() / "Downloads" / "client14789400731781953472.xls",
    Path(os.environ.get("USERPROFILE", "~")).expanduser() / "Downloads" / "fortel-crm" / "client14789400731781953472.xls",
]
XLS_PATH = next((p for p in XLS_CANDIDATES if p.exists()), None)
if XLS_PATH is None:
    # last resort — look in uploads dir relative to this file
    for root, dirs, files in os.walk(Path(__file__).parent.parent):
        for f in files:
            if f.endswith(".xls") and "client" in f:
                XLS_PATH = Path(root) / f
                break
        if XLS_PATH:
            break

print(f"Excel file: {XLS_PATH}")

import sqlalchemy as sa
from sqlalchemy.orm import Session
from .database import engine, SessionLocal
from .auth.auth import hash_password, generate_password


# ─────────────────────────────────────────────
# 1. Add new columns (safe — IF NOT EXISTS)
# ─────────────────────────────────────────────

DOCTOR_NEW_COLS = [
    ("client_id",           "VARCHAR(50)"),
    ("client_code",         "VARCHAR(50)"),
    ("registration_number", "VARCHAR(100)"),
    ("gender",              "VARCHAR(20)"),
    ("dob",                 "VARCHAR(30)"),
    ("anniversary",         "VARCHAR(30)"),
    ("firm_name",           "VARCHAR(300)"),
    ("qualification",       "VARCHAR(200)"),
    ("division",            "VARCHAR(100)"),
    ("prescriber_type",     "VARCHAR(50)"),
    ("category",            "VARCHAR(10)"),
    ("approx_business",     "VARCHAR(50)"),
    ("zone",                "VARCHAR(100)"),
    ("pincode",             "VARCHAR(20)"),
    ("country",             "VARCHAR(100) DEFAULT 'INDIA'"),
    ("full_address",        "TEXT"),
    ("address2",            "TEXT"),
    ("address3",            "TEXT"),
    ("latitude",            "VARCHAR(50)"),
    ("longitude",           "VARCHAR(50)"),
    ("add_date",            "VARCHAR(30)"),
    ("status",              "VARCHAR(30) DEFAULT 'Active'"),
    ("customer_type",       "VARCHAR(20) DEFAULT 'doctor'"),
]

USER_NEW_COLS = [
    ("personal_email", "VARCHAR(200)"),
]

def add_columns_if_missing(table, cols):
    with engine.connect() as conn:
        existing = [row[0].lower() for row in conn.execute(
            sa.text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}'")
        )]
        for col_name, col_def in cols:
            if col_name.lower() not in existing:
                conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))
                print(f"  + Added {table}.{col_name}")
            else:
                print(f"  ✓ {table}.{col_name} already exists")
        conn.commit()

print("\n── Step 1: Schema migration ──────────────────────")
add_columns_if_missing("doctors", DOCTOR_NEW_COLS)
add_columns_if_missing("users",   USER_NEW_COLS)


# ─────────────────────────────────────────────
# 2. Create Thirumurugan D and B.Vani
# ─────────────────────────────────────────────

print("\n── Step 2: Create users ─────────────────────────")

db: Session = SessionLocal()

try:
    from .models.models import User, UserRole, Doctor, RepDoctorMapping

    # Thirumurugan D — MD
    thiru = db.query(User).filter(User.email == "thirumurugan@fortel.in").first()
    if not thiru:
        pwd = "Fortel@2025"
        thiru = User(
            name="Thirumurugan D",
            email="thirumurugan@fortel.in",
            personal_email="mdthiru@gmail.com",
            phone="9677150981",
            role=UserRole.md,
            password_hash=hash_password(pwd),
            must_reset_password=False,
            is_active=True,
        )
        db.add(thiru)
        db.flush()
        print(f"  ✅ Created Thirumurugan D (MD) → thirumurugan@fortel.in / {pwd}")
    else:
        # Update personal email and phone if missing
        thiru.personal_email = thiru.personal_email or "mdthiru@gmail.com"
        thiru.phone = thiru.phone or "9677150981"
        print(f"  ✓ Thirumurugan D already exists (id={thiru.id})")

    db.flush()
    thiru_id = thiru.id

    # B.Vani — Key Account Manager (custom role)
    vani = db.query(User).filter(User.email == "bvani@fortel.in").first()
    vani_pwd = None
    if not vani:
        vani_pwd = generate_password()
        vani = User(
            name="B.Vani",
            email="bvani@fortel.in",
            personal_email="bandivani4@gmail.com",
            phone="9652129858",
            role=UserRole.custom,
            custom_role_name="Key Account Manager",
            password_hash=hash_password(vani_pwd),
            must_reset_password=True,
            reports_to_id=thiru_id,
            is_active=True,
        )
        db.add(vani)
        db.flush()
        print(f"  ✅ Created B.Vani (Key Account Manager) → bvani@fortel.in / {vani_pwd}")
        print(f"     Reports to: Thirumurugan D (id={thiru_id})")
    else:
        vani.personal_email = vani.personal_email or "bandivani4@gmail.com"
        vani.phone = vani.phone or "9652129858"
        vani.reports_to_id = vani.reports_to_id or thiru_id
        print(f"  ✓ B.Vani already exists (id={vani.id})")

    db.commit()
    vani_id = vani.id

    # ─────────────────────────────────────────────
    # 3. Import Excel records
    # ─────────────────────────────────────────────

    print("\n── Step 3: Import Excel records ─────────────────")

    if XLS_PATH is None:
        print("  ⚠️  Excel file not found. Skipping import.")
        print("     Place client14789400731781953472.xls in the fortel-crm folder and re-run.")
    else:
        import pandas as pd
        df = pd.read_excel(str(XLS_PATH), header=0)
        df.columns = [str(c).strip() for c in df.columns]

        # Clean helper
        def val(row, col, default=None):
            v = row.get(col, default)
            if v is None or (isinstance(v, float) and str(v) == 'nan'):
                return default
            s = str(v).strip()
            if s.lower() in ('nan', 'n/a', 'none', 'select type', 'select day', ''):
                return default
            return s

        created = 0
        skipped = 0

        for _, row in df.iterrows():
            client_name = val(row, "Client Name")
            if not client_name:
                skipped += 1
                continue

            client_id_raw = val(row, "Client ID")
            client_id = str(int(float(client_id_raw))) if client_id_raw else None

            # Determine customer type
            qualification = val(row, "Qualification", "")
            prescriber_type_raw = val(row, "Type")
            ctype = "pharmacy" if (
                "pharmacist" in (qualification or "").lower() or
                "pharmacy" in (client_name or "").lower()
            ) else "doctor"

            # Parse lat/long from "lat,row_number" format
            lat_lng = val(row, "latitude/longitude 1", "")
            lat, lng = None, None
            if lat_lng and "," in lat_lng:
                parts = lat_lng.split(",")
                try:
                    lat = str(float(parts[0]))
                    # second part is sometimes row number not longitude — skip if not a real coord
                    if len(parts) > 1 and len(parts[1]) > 3:
                        lng = parts[1].strip()
                except:
                    pass

            # Skip exact duplicates (same client_id)
            if client_id:
                existing = db.query(Doctor).filter(Doctor.client_id == client_id).first()
                if existing:
                    skipped += 1
                    continue

            doctor = Doctor(
                customer_type=ctype,
                client_id=client_id,
                client_code=val(row, "Client Code"),
                registration_number=val(row, "Registration Number"),
                name=client_name,
                hospital=val(row, "Hospital Name"),
                firm_name=val(row, "Firm Name"),
                qualification=val(row, "Qualification"),
                specialty=val(row, "Speciality"),
                division=val(row, "Division"),
                prescriber_type=val(row, "Type"),
                category=val(row, "Category"),
                approx_business=val(row, "Approximated Business"),
                gender=val(row, "Gender"),
                phone=val(row, "Contact Number"),
                email=val(row, "Email"),
                dob=val(row, "DOB"),
                anniversary=val(row, "Anniversary"),
                city=val(row, "City"),
                state_code=val(row, "State"),
                zone=val(row, "Zone"),
                pincode=val(row, "Pincode"),
                country=val(row, "Country", "INDIA"),
                full_address=val(row, "Address 1"),
                address2=val(row, "Address 2"),
                address3=val(row, "Address 3"),
                latitude=lat,
                longitude=lng,
                add_date=val(row, "Doctor Add Date"),
                status=val(row, "Status", "Active"),
                manager_id=thiru_id,
                expected_multiple=5.0,
                is_active=True,
            )
            db.add(doctor)
            db.flush()

            # Map to B.Vani as the rep
            db.add(RepDoctorMapping(
                doctor_id=doctor.id,
                manager_id=thiru_id,
                associate_id=vani_id,
                assigned_by_id=1,  # admin
                is_active=True,
            ))
            created += 1

        db.commit()
        print(f"  ✅ Imported {created} records  |  Skipped {skipped} (duplicates / empty)")

    # ── Summary ──────────────────────────────────────────
    print("\n── Done ──────────────────────────────────────────")
    print(f"  Thirumurugan D  → thirumurugan@fortel.in  (MD)")
    print(f"  B.Vani          → bvani@fortel.in          (Key Account Manager)")
    if vani_pwd:
        print(f"  B.Vani temp password: {vani_pwd}")
    print(f"  All imported records mapped to B.Vani under Thirumurugan D")

finally:
    db.close()
