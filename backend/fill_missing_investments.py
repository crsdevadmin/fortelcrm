"""
Fill investments for doctors who have sales entries but zero investments.

Run:  python -m backend.fill_missing_investments

Safe to re-run — skips doctors that already have at least one investment.
"""

import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from backend.database import SessionLocal
from backend.models.models import (
    User, UserRole, Doctor, Product,
    SalesEntry, Investment,
    InvestmentCategory, InvestmentSubCategory, CommercialModel,
)
from sqlalchemy import func

db     = SessionLocal()
random.seed(99)

YEAR   = 2026
MONTHS = [4, 5, 6]

MODEL_PROFILES = {
    "U1": {"cat": InvestmentCategory.PD, "mult": (5.0, 8.0),  "amt": (8000, 25000),
           "subs": [InvestmentSubCategory.conference, InvestmentSubCategory.travel, InvestmentSubCategory.hotel]},
    "U2": {"cat": InvestmentCategory.PD, "mult": (6.0, 10.0), "amt": (15000, 40000),
           "subs": [InvestmentSubCategory.cme, InvestmentSubCategory.speaker]},
    "P1": {"cat": InvestmentCategory.PD, "mult": (4.0, 7.0),  "amt": (5000, 18000),
           "subs": [InvestmentSubCategory.speaker, InvestmentSubCategory.cme]},
    "P2": {"cat": InvestmentCategory.PD, "mult": (5.0, 8.0),  "amt": (6000, 20000),
           "subs": [InvestmentSubCategory.travel, InvestmentSubCategory.hotel]},
    "N1": {"cat": InvestmentCategory.CS, "mult": (8.0, 15.0), "amt": (1000, 5000),
           "subs": [InvestmentSubCategory.sample, InvestmentSubCategory.gift]},
    "D1": {"cat": InvestmentCategory.RD, "mult": (3.0, 5.0),  "amt": (3000, 12000),
           "subs": [InvestmentSubCategory.meeting, InvestmentSubCategory.round_table]},
    "R1": {"cat": InvestmentCategory.RD, "mult": (2.0, 4.0),  "amt": (2000, 8000),
           "subs": [InvestmentSubCategory.advisory, InvestmentSubCategory.meeting]},
}

# Doctors that have at least one investment already
docs_with_inv = set(
    r.doctor_id
    for r in db.query(Investment.doctor_id).group_by(Investment.doctor_id).all()
)

# Doctors that have sales but NO investment
docs_with_sales_only = (
    db.query(SalesEntry.doctor_id, SalesEntry.associate_id)
    .filter(SalesEntry.doctor_id.notin_(docs_with_inv))
    .group_by(SalesEntry.doctor_id, SalesEntry.associate_id)
    .all()
)

if not docs_with_sales_only:
    print("✅ No gaps found — all doctors with sales already have investments.")
    db.close()
    sys.exit(0)

print(f"Found {len(docs_with_sales_only)} doctor-rep pairs with sales but no investment.")

all_users = {u.id: u for u in db.query(User).all()}
all_docs  = {d.id: d for d in db.query(Doctor).all()}

added = 0

for row in docs_with_sales_only:
    doc_id, rep_id = row.doctor_id, row.associate_id
    doc = all_docs.get(doc_id)
    rep = all_users.get(rep_id)
    if not doc or not rep:
        continue

    model_code = doc.commercial_model.value if doc.commercial_model else "P1"
    prof = MODEL_PROFILES.get(model_code, MODEL_PROFILES["P1"])
    perf = sum(ord(c) for c in rep.name) % 4

    for month in MONTHS:
        # Only add investment if there's a sale in that month
        has_sale = db.query(SalesEntry.id).filter(
            SalesEntry.doctor_id == doc_id,
            SalesEntry.associate_id == rep_id,
            SalesEntry.year == YEAR,
            SalesEntry.month == month,
        ).first()
        if not has_sale:
            continue

        # Skip if already exists
        exists = db.query(Investment.id).filter(
            Investment.doctor_id == doc_id,
            Investment.associate_id == rep_id,
            Investment.year == YEAR,
            Investment.month == month,
        ).first()
        if exists:
            continue

        amt  = round(random.uniform(*prof["amt"]) * (0.8 + perf * 0.1), -2)
        mult = round(random.uniform(*prof["mult"]), 1)
        sub  = random.choice(prof["subs"])

        db.add(Investment(
            doctor_id             = doc_id,
            associate_id          = rep_id,
            year                  = YEAR,
            month                 = month,
            week                  = random.randint(1, 4),
            commercial_model_type = model_code,
            category              = prof["cat"],
            sub_category          = sub,
            amount                = amt,
            expected_multiple     = mult,
            expected_sales        = round(amt * mult, 2),
            purpose               = f"{sub.value} – {(doc.name or '')[:25]}",
            is_approved           = (amt <= 25000),
            submitted_at          = datetime(YEAR, month, random.randint(2, 20)),
        ))
        added += 1

db.commit()
print(f"✅ Added {added} investment records for previously-zero doctors.")
print("Restart backend and refresh ROI Dashboard.")
db.close()
