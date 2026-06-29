# backend/import_sivasakthi.py
# Imports Sivasakthi's doctor list (66 records — Chennai area)
# This file has a different column layout (no Client ID / Reporting Manager columns)
# Run from fortel-crm folder: python -m backend.import_sivasakthi

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import xlrd
from backend.database import SessionLocal
from backend.models.models import Doctor, User

# Column mapping for this file format:
# 0: Registration Number
# 1: Doctor Add Date
# 2: Client Code
# 3: Client Name       ← name
# 4: City
# 5: Hospital Name
# 6: Gender
# 7: Division
# 8: Qualification
# 9: Speciality
# 10: Category
# 11: State
# 12: Zone
# 13: Pincode
# 14: Contact Number
# 15: Email
# 16: DOB
# 17: Anniversary
# 18: Type
# 19: Approximated Business
# 20: Firm Name
# 21: Country
# 22: Status
# 23: Address 1
# 24: latitude/longitude 1
# 27: Address 2
# 31: Address 3

EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'client14489131391782297101.xls')
# If not found, adjust:
# EXCEL_PATH = r"C:\Users\mjaff\Downloads\client14489131391782297101.xls"

db = SessionLocal()

sivasakthi = db.query(User).filter(User.email == 'sivasakthi@fortel.in').first()
if not sivasakthi:
    print("ERROR: sivasakthi@fortel.in not found. Run create_new_users.py first.")
    db.close()
    sys.exit(1)
print(f"Mapping to: {sivasakthi.name} (id={sivasakthi.id})")

wb = xlrd.open_workbook(EXCEL_PATH)
ws = wb.sheet_by_index(0)
print(f"Excel rows: {ws.nrows - 1}")

def val(row, idx):
    if idx >= len(row):
        return None
    v = row[idx]
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else str(v)
    s = str(v).strip()
    return None if s in ('', 'Select Type', 'Select day') else s

created = skipped = 0

for i in range(1, ws.nrows):
    row = ws.row_values(i)
    name = val(row, 3)   # Client Name
    if not name:
        continue

    client_code = val(row, 2)  # Client Code (used as unique key since no Client ID)

    # Skip duplicates by client_code
    if client_code:
        exists = db.query(Doctor).filter(Doctor.client_code == client_code).first()
        if exists:
            print(f"  SKIP (dup client_code {client_code}): {name}")
            skipped += 1
            continue

    latlon1 = val(row, 24) or ''
    lat = lon = None
    if ',' in latlon1:
        parts = latlon1.split(',')
        lat = parts[0].strip() or None
        lon = parts[1].strip() or None

    qual = val(row, 8) or ''
    ctype = 'pharmacy' if ('pharma' in qual.lower() or 'pharmacy' in name.lower()) else 'doctor'

    doc = Doctor(
        customer_type    = ctype,
        name             = name,
        client_id        = None,          # not present in this file format
        client_code      = client_code,
        registration_number = val(row, 0),
        phone            = val(row, 14),
        email            = val(row, 15),
        gender           = val(row, 6),
        dob              = val(row, 16),
        anniversary      = val(row, 17),
        hospital         = val(row, 5),
        firm_name        = val(row, 20),
        qualification    = qual or None,
        specialty        = val(row, 9),
        division         = val(row, 7),
        prescriber_type  = val(row, 18),
        category         = val(row, 10),
        approx_business  = val(row, 19),
        city             = val(row, 4),
        state_code       = val(row, 11),
        zone             = val(row, 12),
        pincode          = val(row, 13),
        country          = val(row, 21) or 'INDIA',
        full_address     = val(row, 23),
        address2         = val(row, 27) if len(row) > 27 else None,
        address3         = val(row, 31) if len(row) > 31 else None,
        latitude         = lat,
        longitude        = lon,
        add_date         = val(row, 1),
        status           = val(row, 22) or 'Active',
        manager_id       = sivasakthi.id,
        is_active        = True,
    )
    db.add(doc)
    created += 1
    print(f"  + {name} ({val(row,4)}) — {val(row,5) or '—'}")

db.commit()
db.close()
print(f"\nDone. Created: {created}  Skipped: {skipped}")
