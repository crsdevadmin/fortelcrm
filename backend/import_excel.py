# Run from fortel-crm folder:  python -m backend.import_excel
import os
from pathlib import Path

import sqlalchemy as sa
from .database import engine, SessionLocal
from .models.models import User, UserRole, Doctor, RepDoctorMapping
from .auth.auth import hash_password, generate_password

db = SessionLocal()

# ── Step 1: Add missing columns safely ────────────────────────────
NEW_DOCTOR_COLS = [
    ("customer_type",       "VARCHAR(20) DEFAULT 'doctor'"),
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
]
NEW_USER_COLS = [
    ("personal_email", "VARCHAR(200)"),
    ("city",           "VARCHAR(100)"),
    ("state",          "VARCHAR(100)"),
]

def add_cols(table, cols):
    with engine.connect() as conn:
        existing = [r[0].lower() for r in conn.execute(
            sa.text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}'")
        )]
        for name, defn in cols:
            if name.lower() not in existing:
                conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {name} {defn}"))
                print(f"  + {table}.{name}")
        conn.commit()

print("Step 1: Schema migration...")
add_cols("doctors", NEW_DOCTOR_COLS)
add_cols("users",   NEW_USER_COLS)

# ── Step 2: Create Thirumurugan D and B.Vani ──────────────────────
print("\nStep 2: Creating users...")

thiru = db.query(User).filter(User.email == "thirumurugan@fortel.in").first()
if not thiru:
    thiru = User(
        name="Thirumurugan D", email="thirumurugan@fortel.in",
        phone="9677150981", role=UserRole.md,
        password_hash=hash_password("Fortel@2025"),
        must_reset_password=False, is_active=True,
    )
    db.add(thiru); db.flush()
    print(f"  created Thirumurugan D  ->  thirumurugan@fortel.in / Fortel@2025")
else:
    print(f"  Thirumurugan D exists (id={thiru.id})")
db.flush()

vani = db.query(User).filter(User.email == "bvani@fortel.in").first()
vani_pwd = None
if not vani:
    vani_pwd = "Fortel@2025"
    vani = User(
        name="B.Vani", email="bvani@fortel.in",
        phone="9652129858", role=UserRole.custom,
        custom_role_name="Key Account Manager",
        city="Hyderabad", state="Telangana",
        password_hash=hash_password(vani_pwd),
        must_reset_password=True,
        reports_to_id=thiru.id, is_active=True,
    )
    db.add(vani); db.flush()
    print(f"  created B.Vani  ->  bvani@fortel.in / {vani_pwd}  (Hyderabad)")
else:
    # update city if missing
    if not getattr(vani, 'city', None):
        vani.city = "Hyderabad"
        vani.state = "Telangana"
    if not vani.reports_to_id:
        vani.reports_to_id = thiru.id
    print(f"  B.Vani exists (id={vani.id}) — city set to Hyderabad")

db.commit()
thiru_id = thiru.id
vani_id  = vani.id

# ── Step 3: Find the XLS file ─────────────────────────────────────
print("\nStep 3: Finding Excel file...")
SEARCH_PATHS = [
    Path(__file__).parent.parent / "client14789400731781953472.xls",
    Path(os.environ.get("USERPROFILE","~")) / "Downloads" / "client14789400731781953472.xls",
    Path(os.environ.get("USERPROFILE","~")) / "Downloads" / "fortel-crm" / "client14789400731781953472.xls",
    Path(os.environ.get("USERPROFILE","~")) / "Desktop" / "client14789400731781953472.xls",
]
xls_path = next((p for p in SEARCH_PATHS if p.exists()), None)

if not xls_path:
    print("  XLS not found. Place client14789400731781953472.xls in:")
    print(f"  {Path(__file__).parent.parent}")
    db.close(); exit(1)

print(f"  Found: {xls_path}")

# ── Step 4: Import records ────────────────────────────────────────
print("\nStep 4: Importing records...")
import pandas as pd
df = pd.read_excel(str(xls_path), header=0)

def val(row, col, default=None):
    v = row.get(col, default)
    if v is None: return default
    s = str(v).strip()
    return default if s.lower() in ('nan','n/a','none','select type','select day','') else s

created = skipped = 0

for _, row in df.iterrows():
    name = val(row, "Client Name")
    if not name: skipped += 1; continue

    client_id_raw = val(row, "Client ID")
    client_id = str(int(float(client_id_raw))) if client_id_raw else None

    # skip if already imported
    if client_id and db.query(Doctor).filter(Doctor.client_id == client_id).first():
        skipped += 1; continue

    qual = (val(row, "Qualification") or "").lower()
    ctype = "pharmacy" if ("pharmacist" in qual or "pharmacy" in (name or "").lower()) else "doctor"

    lat_lng = val(row, "latitude/longitude 1", "")
    lat = None
    if lat_lng and "," in lat_lng:
        try: lat = str(float(lat_lng.split(",")[0]))
        except: pass

    doc = Doctor(
        customer_type=ctype,
        client_id=client_id,
        client_code=val(row, "Client Code"),
        registration_number=val(row, "Registration Number"),
        name=name,
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
        city=val(row, "City"),
        state_code=val(row, "State"),
        zone=val(row, "Zone"),
        pincode=val(row, "Pincode"),
        country=val(row, "Country", "INDIA"),
        full_address=val(row, "Address 1"),
        address2=val(row, "Address 2"),
        add_date=val(row, "Doctor Add Date"),
        status=val(row, "Status", "Active"),
        latitude=lat,
        manager_id=thiru_id,
        expected_multiple=5.0,
        is_active=True,
    )
    db.add(doc); db.flush()

    # map to B.Vani
    db.add(RepDoctorMapping(
        doctor_id=doc.id, manager_id=thiru_id,
        associate_id=vani_id, assigned_by_id=1, is_active=True,
    ))
    created += 1

db.commit()
print(f"  Imported {created} records, skipped {skipped}")
print(f"\nDone! Refresh Customer Management to see all records.")
print(f"B.Vani (bvani@fortel.in) is mapped to all {created} customers under Thirumurugan D.")
db.close()
