"""
Fix reporting hierarchy so Thirumurugan sees all reps and their doctors.
Run: python -m backend.fix_hierarchy
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal
from backend.models.models import User, UserRole

db = SessionLocal()

users = db.query(User).order_by(User.id).all()

print("CURRENT USERS:")
print(f"  {'ID':<5} {'Name':<25} {'Role':<20} {'reports_to_id'}")
print("  " + "─" * 60)
for u in users:
    parent = next((x.name for x in users if x.id == u.reports_to_id), "—")
    print(f"  {u.id:<5} {u.name:<25} {u.role.value:<20} {parent}")

# Find Thirumurugan
thiru = next((u for u in users if any(k in u.name.lower() for k in ["thiru", "murugan"])), None)
if not thiru:
    print("\n✗ Thirumurugan not found. Check the name.")
    db.close(); exit()

print(f"\n✓ Found Thirumurugan: [{thiru.id}] {thiru.name} ({thiru.role.value})")

# Make sure his role is MD or Admin so he sees everything
if thiru.role not in (UserRole.admin, UserRole.md):
    print(f"  Upgrading role from '{thiru.role.value}' → 'md'")
    thiru.role = UserRole.md
    db.add(thiru)

# Set all other non-admin users to report to Thirumurugan if they have no manager
fixed = 0
for u in users:
    if u.id == thiru.id:
        continue
    if u.role in (UserRole.admin,):
        continue
    if u.reports_to_id is None:
        u.reports_to_id = thiru.id
        db.add(u)
        fixed += 1
        print(f"  Set {u.name} → reports to Thirumurugan")

db.commit()
print(f"\n✓ Done. Fixed {fixed} users. Thirumurugan now sees all data.")

# Verify
from backend.utils.hierarchy import get_subtree_ids
subtree = get_subtree_ids(thiru.id, db)
if subtree is None:
    print("  Thirumurugan has admin/md role → sees ALL doctors (no filter)")
else:
    names = [u.name for u in users if u.id in subtree]
    print(f"  Subtree: {names}")

db.close()
