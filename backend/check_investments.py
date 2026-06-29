"""
Diagnostic — show all investment records in the DB with doctor details.
Run: python -m backend.check_investments
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal
from backend.models.models import Investment, Doctor, User

db = SessionLocal()

# All investments grouped by doctor
rows = db.query(Investment).order_by(Investment.doctor_id, Investment.year, Investment.month).all()

if not rows:
    print("NO investments found in DB.")
    db.close()
    exit()

print(f"Total investment records: {len(rows)}\n")
print(f"{'Doctor':<35} {'Hospital':<25} {'Manager':<20} {'Yr-Mo':>7} {'Amount':>10}")
print("─" * 105)

total = 0
for inv in rows:
    doc = db.query(Doctor).filter(Doctor.id == inv.doctor_id).first()
    mgr = db.query(User).filter(User.id == (doc.manager_id if doc else None)).first()
    doc_name = doc.name      if doc else f"[MISSING doc {inv.doctor_id}]"
    hospital = (doc.hospital if doc else "")[:24]
    mgr_name = mgr.name      if mgr else "—"
    print(f"{doc_name:<35} {hospital:<25} {mgr_name:<20} {inv.year}-{inv.month:02d}  ₹{inv.amount:>9,.0f}")
    total += inv.amount

print("─" * 105)
print(f"{'TOTAL':>89}  ₹{total:>9,.0f}")

db.close()
