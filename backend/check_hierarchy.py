"""
Check user hierarchy and fix Thirumurugan's visibility.
Run: python -m backend.check_hierarchy
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal
from backend.models.models import User, Doctor
from backend.utils.hierarchy import get_subtree_ids

db = SessionLocal()

# All users
users = db.query(User).order_by(User.id).all()
print("ALL USERS:")
print(f"  {'ID':<5} {'Name':<25} {'Role':<20} {'reports_to_id'}")
print("  " + "─"*65)
for u in users:
    rname = ""
    if u.reports_to_id:
        mgr = db.query(User).filter(User.id == u.reports_to_id).first()
        rname = mgr.name if mgr else f"[{u.reports_to_id}]"
    print(f"  {u.id:<5} {u.name:<25} {u.role.value:<20} {rname}")

# Thirumurugan
thiru = next((u for u in users if "thiru" in u.name.lower() or "murugan" in u.name.lower()), None)
if not thiru:
    print("\n✗ Thirumurugan not found! Check spelling in DB.")
    db.close(); exit()

print(f"\nThirumurugan: [{thiru.id}] {thiru.name}  role={thiru.role.value}")

subtree = get_subtree_ids(thiru.id, db)
if subtree is None:
    print("  → Admin/MD role — sees ALL doctors (no filter)")
else:
    print(f"  → Subtree user IDs: {subtree}")
    subtree_names = [u.name for u in users if u.id in subtree]
    print(f"  → Subtree names  : {subtree_names}")

# Vani B
vani = next((u for u in users if "vani" in u.name.lower()), None)
if vani:
    print(f"\nVani B: [{vani.id}] {vani.name}  reports_to_id={vani.reports_to_id}")
    in_thiru_subtree = subtree is None or vani.id in (subtree or set())
    print(f"  → Is Vani in Thiru's subtree? {'YES ✓' if in_thiru_subtree else 'NO ✗ — THIS IS THE PROBLEM'}")

    doc_count = db.query(Doctor).filter(Doctor.manager_id == vani.id).count()
    print(f"  → Doctors under Vani B: {doc_count}")

db.close()
