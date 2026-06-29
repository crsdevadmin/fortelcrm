# backend/import_manikanda.py
# Imports Manikanda Prabhu's doctor list (108 records — Tamil Nadu)
# Run from fortel-crm folder: python -m backend.import_manikanda

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import xlrd
from backend.database import SessionLocal
from backend.models.models import Doctor, User

# Column mapping (36 cols, no Immediate Reporting Manager):
# 0: Client ID
# 1: Registration Number
# 2: Doctor Add Date
# 3: Client Code
# 4: Client Name       ← name
# 5: City
# 6: Hospital Name
# 7: Gender
# 8: Division
# 9: Qualification
# 10: Speciality
# 11: Category
# 12: State
# 13: Zone
# 14: Pincode
# 15: Contact Number
# 16: Email
# 17: DOB
# 18: Anniversary
# 19: Type
# 20: Approximated Business
# 21: Firm Name
# 22: Country
# 23: Status
# 24: Address 1
# 25: latitude/longitude 1
# 28: Address 2
# 32: Address 3

EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'client7688318171782297203.xls')
# If not found, adjust:
# EXCEL_PATH = r"C:\Users\mjaff\Downloads\client7688318171782297203.xls"

db = SessionLocal()

manikanda = db.query(User).filter(User.email == 'manikanda.prabhu@fortel.in').first()
if not manikanda:
    print("ERROR: manikanda.prabhu@fortel.in not found. Run create_new_users.py first.")
    db.close()
    sys.exit(1)
print(f"Mapping to: {manikanda.name} (id={manikanda.id})")

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
    name = val(row, 4)
    if not name:
        continue

    client_id = val(row, 0)
    if client_id:
        exists = db.query(Doctor).filter(Doctor.client_id == client_id).first()
        if exists:
            print(f"  SKIP (dup client_id {client_id}): {name}")
            skipped += 1
            continue

    latlon1 = val(row, 25) or ''
    lat = lon = None
    if ',' in latlon1:
        parts = latlon1.split(',')
        lat = parts[0].strip() or None
        lon = parts[1].strip() or None

    qual = val(row, 9) or ''
    ctype = 'pharmacy' if ('pharma' in qual.lower() or 'pharmacy' in name.lower()) else 'doctor'

    doc = Doctor(
        customer_type    = ctype,
        name             = name,
        client_id        = client_id,
        client_code      = val(row, 3),
        registration_number = val(row, 1),
        phone            = val(row, 15),
        email            = val(row, 16),
        gender           = val(row, 7),
        dob              = val(row, 17),
        anniversary      = val(row, 18),
        hospital         = val(row, 6),
        firm_name        = val(row, 21),
        qualification    = qual or None,
        specialty        = val(row, 10),
        division         = val(row, 8),
        prescriber_type  = val(row, 19),
        category         = val(row, 11),
        approx_business  = val(row, 20),
        city             = val(row, 5),
        state_code       = val(row, 12),
        zone             = val(row, 13),
        pincode          = val(row, 14),
        country          = val(row, 22) or 'INDIA',
        full_address     = val(row, 24),
        address2         = val(row, 28) if len(row) > 28 else None,
        address3         = val(row, 32) if len(row) > 32 else None,
        latitude         = lat,
        longitude        = lon,
        add_date         = val(row, 2),
        status           = val(row, 23) or 'Active',
        manager_id       = manikanda.id,
        is_active        = True,
    )
    db.add(doc)
    created += 1
    print(f"  + {name} ({val(row,5)})")

db.commit()
db.close()
print(f"\nDone. Created: {created}  Skipped: {skipped}")
