# backend/check_mappings.py
# Shows how many clients/doctors are mapped to each user
# Run from fortel-crm folder: python -m backend.check_mappings

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from backend.database import SessionLocal
from backend.models.models import Doctor, User
from sqlalchemy import func

db = SessionLocal()

print("=" * 65)
print(f"{'User':<30} {'Email':<30} {'Mapped'}")
print("=" * 65)

users = db.query(User).order_by(User.name).all()
total_mapped = 0
total_unmapped = 0

for u in users:
    count = db.query(func.count(Doctor.id)).filter(Doctor.manager_id == u.id).scalar()
    flag = " ✓" if count > 0 else " —"
    print(f"{(u.name or '(no name)'):<30} {u.email:<30} {count}{flag}")
    total_mapped += count

unmapped = db.query(func.count(Doctor.id)).filter(Doctor.manager_id == None).scalar()
total_all = db.query(func.count(Doctor.id)).scalar()

print("=" * 65)
print(f"{'TOTAL MAPPED':<61} {total_mapped}")
print(f"{'UNMAPPED (no manager_id)':<61} {unmapped}")
print(f"{'GRAND TOTAL':<61} {total_all}")
print("=" * 65)

# Detailed breakdown by active/inactive
print("\nActive / Inactive breakdown per user:")
print("-" * 65)
for u in users:
    active   = db.query(func.count(Doctor.id)).filter(Doctor.manager_id == u.id, Doctor.is_active != False).scalar()
    inactive = db.query(func.count(Doctor.id)).filter(Doctor.manager_id == u.id, Doctor.is_active == False).scalar()
    total    = active + inactive
    if total > 0:
        print(f"  {(u.name or '?'):<28}  Active: {active:<5} Inactive: {inactive:<5} Total: {total}")

db.close()
