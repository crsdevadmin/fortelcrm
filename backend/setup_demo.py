"""
Full demo data setup — creates sample doctors, investments and sales for every rep.

Run:  python -m backend.setup_demo

- Creates 20 sample doctors for any rep that has none assigned
- Seeds Apr / May / Jun 2026 investments + sales for every rep
- Removes Customer Master from non-MD nav (already done in Layout.jsx)
- Safe to re-run — skips existing rows
"""

import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from collections import defaultdict

from backend.database import SessionLocal
from backend.models.models import (
    User, UserRole, Doctor, Product,
    SalesEntry, Investment,
    InvestmentCategory, InvestmentSubCategory,
    CommercialModel,
)

db     = SessionLocal()
random.seed(77)

YEAR   = 2026
MONTHS = [4, 5, 6]

# ── 1. Products ───────────────────────────────────────────────
FORTEL_PRODUCTS = [
    {"name": "Fortel-D 10mg",   "pack_size": "10 tab strip", "rate": 185.0},
    {"name": "Fortel-N 5mg",    "pack_size": "10 tab strip", "rate": 145.0},
    {"name": "Fortel-X 250mg",  "pack_size": "6 cap strip",  "rate": 220.0},
    {"name": "Fortel-B Syrup",  "pack_size": "100ml",        "rate": 95.0},
    {"name": "Fortel-P Tablet", "pack_size": "10 tab strip", "rate": 165.0},
]

products = db.query(Product).all()
if not products:
    for p in FORTEL_PRODUCTS:
        db.add(Product(**p, is_active=True))
    db.commit()
    products = db.query(Product).all()
    print(f"✅ Created {len(products)} products")
else:
    print(f"✓  {len(products)} products in DB")

# ── 2. Users ──────────────────────────────────────────────────
all_users  = db.query(User).filter(User.is_active == True).all()
user_map   = {u.id: u for u in all_users}
SKIP_ROLES = {UserRole.admin, UserRole.md}
field_reps = [u for u in all_users if u.role not in SKIP_ROLES]

if not field_reps:
    print("No field users found. Run create_users.py first.")
    db.close(); sys.exit(1)

print(f"\n👥 Field users: {len(field_reps)}")

# ── 3. Fix hierarchy — all report to MD ──────────────────────
md_user = next((u for u in all_users if u.role == UserRole.md), None)
if md_user:
    changed = 0
    for u in field_reps:
        if u.reports_to_id is None:
            u.reports_to_id = md_user.id
            changed += 1
    if changed:
        db.commit()
        print(f"✅ {changed} users now report to {md_user.name}")

# ── 4. Sample doctor templates (used if rep has no doctors) ───
SAMPLE_SPECIALTIES = ["Cardiologist","Diabetologist","General Physician","Nephrologist",
                      "Endocrinologist","Pulmonologist","Gastroenterologist","Neurologist"]
SAMPLE_MODELS      = ["U1","U1","P1","P1","N1","N1","D1","R1","U2","P2"]

CITY_STATE = {
    "Chennai":     "TN", "Coimbatore": "TN", "Madurai":    "TN",
    "Hyderabad":   "TG", "Vijayawada": "AP", "Cochin":     "KL",
    "Bengaluru":   "KA", "Pune":       "MH",
}

def city_for_user(u):
    return u.city or random.choice(list(CITY_STATE.keys()))

def make_sample_doctors(rep, n=20):
    city  = city_for_user(rep)
    state = CITY_STATE.get(city, "TN")
    docs  = []
    for i in range(1, n + 1):
        spec  = SAMPLE_SPECIALTIES[i % len(SAMPLE_SPECIALTIES)]
        model = SAMPLE_MODELS[i % len(SAMPLE_MODELS)]
        doc   = Doctor(
            name             = f"Dr. {rep.name.split()[0]} Patient-{i:02d}",
            specialty        = spec,
            city             = city,
            state_code       = state,
            commercial_model = CommercialModel(model),
            expected_multiple= random.choice([4.0, 5.0, 6.0, 8.0]),
            manager_id       = rep.id,
            is_active        = True,
            customer_type    = "doctor",
            status           = "Active",
        )
        db.add(doc)
        docs.append(doc)
    db.commit()
    # refresh to get IDs
    for d in docs:
        db.refresh(d)
    return docs

# ── 5. Ensure every rep has doctors ───────────────────────────
rep_doctors: dict[int, list] = defaultdict(list)
for d in db.query(Doctor).filter(Doctor.is_active == True).all():
    if d.manager_id in user_map:
        rep_doctors[d.manager_id].append(d)

print(f"\n🏥 Doctor counts before setup:")
for u in field_reps:
    cnt = len(rep_doctors[u.id])
    print(f"   {u.name:<28} {cnt:>3} doctors", "← will create samples" if cnt == 0 else "")

created_docs = 0
for u in field_reps:
    if len(rep_doctors[u.id]) == 0:
        new_docs = make_sample_doctors(u, n=20)
        rep_doctors[u.id] = new_docs
        created_docs += len(new_docs)
        print(f"  ✅ Created 20 sample doctors for {u.name}")

if created_docs:
    print(f"\n✅ Total sample doctors created: {created_docs}")

# ── 6. Investment profiles ─────────────────────────────────────
MODEL_PROFILES = {
    "U1": {"cat": InvestmentCategory.PD, "mult": (5.0, 8.0), "amt": (8000, 25000),
           "subs": [InvestmentSubCategory.conference, InvestmentSubCategory.travel, InvestmentSubCategory.hotel], "qty": 4},
    "U2": {"cat": InvestmentCategory.PD, "mult": (6.0, 10.0),"amt": (15000, 40000),
           "subs": [InvestmentSubCategory.cme, InvestmentSubCategory.speaker], "qty": 6},
    "P1": {"cat": InvestmentCategory.PD, "mult": (4.0, 7.0), "amt": (5000, 18000),
           "subs": [InvestmentSubCategory.speaker, InvestmentSubCategory.cme], "qty": 3},
    "P2": {"cat": InvestmentCategory.PD, "mult": (5.0, 8.0), "amt": (6000, 20000),
           "subs": [InvestmentSubCategory.travel, InvestmentSubCategory.hotel], "qty": 4},
    "N1": {"cat": InvestmentCategory.CS, "mult": (8.0, 15.0),"amt": (1000, 5000),
           "subs": [InvestmentSubCategory.sample, InvestmentSubCategory.gift], "qty": 8},
    "D1": {"cat": InvestmentCategory.RD, "mult": (3.0, 5.0), "amt": (3000, 12000),
           "subs": [InvestmentSubCategory.meeting, InvestmentSubCategory.round_table], "qty": 2},
    "R1": {"cat": InvestmentCategory.RD, "mult": (2.0, 4.0), "amt": (2000, 8000),
           "subs": [InvestmentSubCategory.advisory, InvestmentSubCategory.meeting], "qty": 1},
}

# ── 7. Existing row index ──────────────────────────────────────
existing_inv = set(
    (r.doctor_id, r.associate_id, r.year, r.month)
    for r in db.query(Investment.doctor_id, Investment.associate_id,
                      Investment.year, Investment.month).all()
)
existing_sales = set(
    (r.doctor_id, r.associate_id, r.product_id, r.year, r.month, r.week)
    for r in db.query(SalesEntry.doctor_id, SalesEntry.associate_id,
                      SalesEntry.product_id, SalesEntry.year,
                      SalesEntry.month, SalesEntry.week).all()
)

# ── 8. Seed loop ───────────────────────────────────────────────
print(f"\n💾 Seeding Apr / May / Jun 2026 …")
total_inv = total_sales = 0

for u in field_reps:
    docs = rep_doctors[u.id]
    if not docs:
        continue

    perf       = sum(ord(c) for c in u.name) % 4
    sales_mult = [0.55, 0.80, 1.10, 1.40][perf]
    rep_inv = rep_sales = 0

    for month in MONTHS:
        active = random.sample(docs, max(3, int(len(docs) * 0.75)))

        for doc in active:
            model_code = doc.commercial_model.value if doc.commercial_model \
                         else random.choice(["U1","P1","N1","D1","R1"])
            prof = MODEL_PROFILES.get(model_code, MODEL_PROFILES["P1"])

            # Investment
            key_i = (doc.id, u.id, YEAR, month)
            if key_i not in existing_inv:
                amt  = round(random.uniform(*prof["amt"]) * (0.8 + perf * 0.1), -2)
                mult = round(random.uniform(*prof["mult"]), 1)
                sub  = random.choice(prof["subs"])
                db.add(Investment(
                    doctor_id             = doc.id,
                    associate_id          = u.id,
                    year                  = YEAR,
                    month                 = month,
                    week                  = random.randint(1, 4),
                    commercial_model_type = model_code,
                    category              = prof["cat"],
                    sub_category          = sub,
                    amount                = amt,
                    expected_multiple     = mult,
                    expected_sales        = round(amt * mult, 2),
                    purpose               = f"{sub.value} – {doc.name[:25]}",
                    is_approved           = (amt <= 25000),
                    submitted_at          = datetime(YEAR, month, random.randint(2, 20)),
                ))
                existing_inv.add(key_i)
                rep_inv += 1; total_inv += 1

            # Sales
            chosen = random.sample(products, random.randint(1, min(3, len(products))))
            weeks  = random.sample([1, 2, 3, 4], random.randint(2, 4))
            for prod in chosen:
                for wk in weeks:
                    key_s = (doc.id, u.id, prod.id, YEAR, month, wk)
                    if key_s in existing_sales:
                        continue
                    qty = max(1, round(prof["qty"] * sales_mult * random.uniform(0.7, 1.5)))
                    db.add(SalesEntry(
                        doctor_id    = doc.id,
                        associate_id = u.id,
                        product_id   = prod.id,
                        year         = YEAR, month = month, week = wk,
                        sale_date    = f"{YEAR}-{month:02d}-{min(wk*7,28):02d}",
                        quantity     = qty,
                        value        = round(qty * prod.rate, 2),
                        is_approved  = True,
                        submitted_at = datetime(YEAR, month, min(wk * 7, 28)),
                    ))
                    existing_sales.add(key_s)
                    rep_sales += 1; total_sales += 1

    db.commit()
    tier = ["🔴 Low","🟡 Mid","🟢 Good","⭐ High"][perf]
    print(f"  {u.name:<28} {tier}  +{rep_inv:>3} inv  +{rep_sales:>4} sales  ({len(docs)} docs)")

print(f"""
╔══════════════════════════════════════════╗
║           SETUP COMPLETE                 ║
╠══════════════════════════════════════════╣
║  Sample doctors created : {created_docs:<5}            ║
║  Investments added      : {total_inv:<5}            ║
║  Sales entries added    : {total_sales:<5}            ║
╚══════════════════════════════════════════╝

Restart backend → open ROI Dashboard → year 2026, month 4 / 5 / 6

  Thirumurugan (MD)  → sees ALL reps + all regions
  Hanni / directors  → see their assigned doctors only
  Each rep           → sees only their own doctors

Customer Master is now MD-only in the sidebar.
All other users see My Customers (their own list).
""")
db.close()
