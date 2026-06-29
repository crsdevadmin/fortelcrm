# backend/import_sathish.py
# Imports K Sathish Kumar's doctor list (63 records)
# Run from fortel-crm folder: python -m backend.import_sathish

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import xlrd
from backend.database import SessionLocal
from backend.models.models import Doctor, User

EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'client9872986281782296967.xls')
# If not found, adjust:
# EXCEL_PATH = r"C:\Users\mjaff\Downloads\client9872986281782296967.xls"

db = SessionLocal()

sathish = db.query(User).filter(User.email == 'sathish.k@fortel.in').first()
if not sathish:
    print("ERROR: sathish.k@fortel.in not found. Run create_new_users.py first.")
    db.close()
    sys.exit(1)
print(f"Mapping to: {sathish.name} (id={sathish.id})")

wb = xlrd.open_workbook(EXCEL_PATH)
ws = wb.sheet_by_index(0)
print(f"Excel rows: {ws.nrows - 1}")

def val(row, idx):
    v = row[idx]
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else str(v)
    s = str(v).strip()
    return None if s in ('', 'Select Type', 'Select day') else s

created = skipped = 0

for i in range(1, ws.nrows):
    row = ws.row_values(i)
    name = val(row, 5)
    if not name:
        continue

    client_id = val(row, 1)
    if client_id:
        exists = db.query(Doctor).filter(Doctor.client_id == client_id).first()
        if exists:
            print(f"  SKIP (already exists): {name}")
            skipped += 1
            continue

    latlon1 = val(row, 26) or ''
    lat = lon = None
    if ',' in latlon1:
        parts = latlon1.split(',')
        lat = parts[0].strip() or None
        lon = parts[1].strip() or None

    qual = val(row, 10) or ''
    ctype = 'pharmacy' if ('pharma' in qual.lower() or 'pharmacy' in name.lower()) else 'doctor'

    doc = Doctor(
        customer_type=ctype, name=name, client_id=client_id,
        client_code=val(row,4), phone=val(row,16), email=val(row,17),
        gender=val(row,8), dob=val(row,18), anniversary=val(row,19),
        hospital=val(row,7), firm_name=val(row,22), qualification=qual or None,
        specialty=val(row,11), division=val(row,9), prescriber_type=val(row,20),
        category=val(row,12), approx_business=val(row,21),
        city=val(row,6), state_code=val(row,13), zone=val(row,14),
        pincode=val(row,15), country=val(row,23) or 'INDIA',
        full_address=val(row,25), address2=val(row,29), address3=val(row,33),
        latitude=lat, longitude=lon, add_date=val(row,3),
        status=val(row,24) or 'Active', manager_id=sathish.id, is_active=True,
    )
    db.add(doc)
    created += 1
    print(f"  + {name} ({val(row,6)})")

db.commit()
db.close()
print(f"\nDone. Created: {created}  Skipped: {skipped}")
