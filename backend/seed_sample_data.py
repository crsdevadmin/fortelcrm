"""
Seed realistic sample investments + sales for all reps and their doctors.

Run:  python -m backend.seed_sample_data

Uses doctor.manager_id to link doctors to reps (how all import scripts work).
Covers April / May / June 2026.
Safe to re-run — skips already-existing rows.
"""

import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from collections import defaultdict

from backend.database import SessionLocal
from backend.models.models import (
    User, Doctor, Product,
    SalesEntry, Investment,
    InvestmentCategory, InvestmentSubCategory,
    CommercialModel,
)

db      = SessionLocal()
random.seed(42)

YEAR   = 2026
MONTHS = [4, 5, 6]   # April, May, June

# ── Investment profile per commercial model ─────────────
MODEL_PROFILES = {
    "U1": {"cat": InvestmentCategory.PD, "mult": (5, 8),  "amt": (8000, 25000),
           "subs": [InvestmentSubCategory.conference, InvestmentSubCategory.travel, InvestmentSubCategory.hotel]},
    "U2": {"cat": InvestmentCategory.PD, "mult": (6, 10), "amt": (15000, 40000),
           "subs": [InvestmentSubCategory.cme, InvestmentSubCategory.speaker, InvestmentSubCategory.conference]},
    "P1": {"cat": InvestmentCategory.PD, "mult": (4, 7),  "amt": (5000, 18000),
           "subs": [InvestmentSubCategory.speaker, InvestmentSubCategory.cme]},
    "P2": {"cat": InvestmentCategory.PD, "mult": (5, 8),  "amt": (6000, 20000),
           "subs": [InvestmentSubCategory.travel, InvestmentSubCategory.hotel]},
    "N1": {"cat": InvestmentCategory.CS, "mult": (8, 15), "amt": (1000, 5000),
           "subs": [InvestmentSubCategory.sample, InvestmentSubCategory.gift]},
    "D1": {"cat": InvestmentCategory.RD, "mult": (3, 5),  "amt": (3000, 12000),
           "subs": [InvestmentSubCategory.meeting, InvestmentSubCategory.round_table]},
    "R1": {"cat": InvestmentCategory.RD, "mult": (2, 4),  "amt": (2000, 8000),
           "subs": [InvestmentSubCategory.advisory, InvestmentSubCategory.meeting]},
}

DEFAULT_MODEL_WEIGHTS = ["U1","U1","P1","P1","N1","N1","D1","R1"]

# ── Products ─────────────────────────────────────────────
FORTEL_PRODUCTS = [
    {"name": "Fortel-D 10mg",   "pack_size": "10 tab strip", "rate": 185.0},
    {"name": "Fortel-N 5mg",    "pack_size": "10 tab strip", "rate": 145.0},
    {"name": "Fortel-X 250mg",  "pack_size": "6 cap strip",  "rate": 220.0},
    {"name": "Fortel-B Syrup",  "pack_size": "100ml",        "rate": 95.0},
    {"name": "Fortel-P Tablet", "pack_size": "10 tab strip", "rate": 165.0},
]

products = db.query(Product).all()
if not products:
    print("Creating products...")
    for p in FORTEL_PRODUCTS:
        db.add(Product(name=p["name"], pack_size=p["pack_size"], rate=p["rate"], is_active=True))
    db.commit()
    products = db.query(Product).all()
    print(f"  ✅ {len(products)} products created")
else:
    print(f"  ✓ {len(products)} products already exist")

# ── Load all doctors grouped by manager_id (= the rep) ──
all_doctors = db.query(Doctor).filter(Doctor.is_active == True).all()
all_users   = {u.id: u for u in db.query(User).all()}

rep_to_doctors: dict[int, list[Doctor]] = defaultdict(list)
for doc in all_doctors:
    if doc.manager_id and doc.manager_id in all_users:
        rep_to_doctors[doc.manager_id].append(doc)

if not rep_to_doctors:
    print("\n⚠  No doctors found with manager_id set.")
    print("   Run your import scripts first (import_sathish, import_mahesh, etc.)")
    db.close(); sys.exit(1)

print(f"\n👥 Reps with assigned doctors:")
for uid, docs in sorted(rep_to_doctors.items(), key=lambda x: -len(x[1])):
    u = all_users[uid]
    print(f"   {u.name:<28} ({u.display_role:<25}) → {len(docs)} doctors")

# ── Existing rows index (avoid duplicates) ───────────────
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

inv_added = sales_added = 0

# ── Seed loop ─────────────────────────────────────────────
for rep_id, doctors in sorted(rep_to_doctors.items(), key=lambda x: all_users[x[0]].name):
    rep  = all_users[rep_id]
    # Give each rep a stable performance tier so MD sees real variation
    perf = sum(ord(c) for c in rep.name) % 4   # 0=low … 3=high
    sales_mult = [0.55, 0.80, 1.10, 1.40][perf]

    rep_inv = rep_sales = 0

    for month in MONTHS:
        # ~70 % of doctors active each month
        n_active = max(2, int(len(doctors) * 0.70))
        active   = random.sample(doctors, min(n_active, len(doctors)))

        for doc in active:
            # Pick commercial model
            model_code = doc.commercial_model.value if doc.commercial_model \
                         else random.choice(DEFAULT_MODEL_WEIGHTS)
            prof = MODEL_PROFILES.get(model_code, MODEL_PROFILES["P1"])

            # ── Investment ────────────────────────────────
            key_inv = (doc.id, rep_id, YEAR, month)
            if key_inv not in existing_inv:
                amt      = round(random.uniform(*prof["amt"]) * (0.8 + perf * 0.1), -2)
                multiple = round(random.uniform(*prof["mult"]), 1)
                sub      = random.choice(prof["subs"])

                db.add(Investment(
                    doctor_id            = doc.id,
                    associate_id         = rep_id,
                    year                 = YEAR,
                    month                = month,
                    week                 = random.randint(1, 4),
                    commercial_model_type= model_code,
                    category             = prof["cat"],
                    sub_category         = sub,
                    amount               = amt,
                    expected_multiple    = multiple,
                    expected_sales       = round(amt * multiple, 2),
                    purpose              = f"{sub.value} – {doc.name[:25]}",
                    is_approved          = amt <= 25000,
                    submitted_at         = datetime(YEAR, month, random.randint(2, 20)),
                ))
                existing_inv.add(key_inv)
                inv_added += 1; rep_inv += 1

            # ── Sales (2–3 products, 2–4 weeks) ──────────
            n_prods = random.randint(1, min(3, len(products)))
            chosen  = random.sample(products, n_prods)
            weeks   = random.sample([1, 2, 3, 4], random.randint(2, 4))

            base_qty = {"U1":4,"U2":6,"P1":3,"P2":4,"N1":8,"D1":2,"R1":1}.get(model_code,3)

            for prod in chosen:
                for wk in weeks:
                    key_s = (doc.id, rep_id, prod.id, YEAR, month, wk)
                    if key_s in existing_sales:
                        continue
                    qty = max(1, round(base_qty * sales_mult * random.uniform(0.7, 1.5)))
                    db.add(SalesEntry(
                        doctor_id    = doc.id,
                        associate_id = rep_id,
                        product_id   = prod.id,
                        year         = YEAR,
                        month        = month,
                        week         = wk,
                        sale_date    = f"{YEAR}-{month:02d}-{min(wk*7,28):02d}",
                        quantity     = qty,
                        value        = round(qty * prod.rate, 2),
                        is_approved  = True,
                        submitted_at = datetime(YEAR, month, min(wk * 7, 28)),
                    ))
                    existing_sales.add(key_s)
                    sales_added += 1; rep_sales += 1

    db.commit()
    print(f"  ✅ {rep.name:<28} → +{rep_inv} investments  +{rep_sales} sales entries")

# ── Final summary ─────────────────────────────────────────
total_inv_rows   = db.query(Investment).count()
total_sales_rows = db.query(SalesEntry).count()

print(f"""
╔══════════════════════════════════════════╗
║           SEED COMPLETE                  ║
╠══════════════════════════════════════════╣
║  New investments  : {inv_added:<6}                ║
║  New sales entries: {sales_added:<6}                ║
║  Total in DB now  :                      ║
║    Investments    : {total_inv_rows:<6}                ║
║    Sales entries  : {total_sales_rows:<6}                ║
╚══════════════════════════════════════════╝

Open ROI Dashboard → select 2026, month 4 / 5 / 6
  MD login     → sees ALL reps + all regions
  Director     → sees their team
  Rep          → sees only their assigned doctors
""")

db.close()
