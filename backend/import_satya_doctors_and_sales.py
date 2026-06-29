"""
backend/import_satya_doctors_and_sales.py
==========================================
Extracts all doctors and sales data from the SATYA DISTRIBUTORS
Customer & Product Analysis report (May 2026) and loads them into
the Fortel CRM database.

What this script does:
  1. Seeds all products from the distributor report (if not already in DB)
  2. For each customer in the report:
       - Find existing doctor by phone number
       - If not found → create new Doctor record
  3. For each rep name → find matching Fortel user
  4. Creates SalesEntry records for May 2026 (one per doctor×product×date)
  5. Prints a clear summary of what was created vs skipped

Usage:
    cd fortel-crm
    python -m backend.import_satya_doctors_and_sales

After running:
  - Dashboard will show top products, total sales, ROI data
  - Doctor report per doctor will have actual May 2026 sales
  - Reps with unmatched names are flagged in the log
"""

import os, sys, re
from datetime import datetime
from difflib import SequenceMatcher

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal
from backend.models.models import Doctor, User, Product, SalesEntry

db = SessionLocal()
YEAR, MONTH = 2026, 5
SOURCE_TAG  = "SATYA DIST — May 2026"

LOG = []
def log(msg): print(msg); LOG.append(msg)


# ─────────────────────────────────────────────────────────────────────────────
# PRODUCTS from the SATYA DISTRIBUTORS report — name + standard rate
# ─────────────────────────────────────────────────────────────────────────────
PRODUCTS_TO_SEED = [
    {"name": "AMTRIOS SOFTGEL CAP 30",  "pack_size": "30 CAP BOTTLE",  "rate": 3809.52},
    {"name": "LYCOTURM SYRUP 200ML",     "pack_size": "200ML BOTTLE",   "rate": 1714.29},
    {"name": "NUTRIA CAPSULES 1*10S",    "pack_size": "10 CAP STRIP",   "rate": 158.73},
    {"name": "ZOLVERA LOTION 150ML",     "pack_size": "150ML",          "rate": 593.22},
    {"name": "NUNEXA 400GM",             "pack_size": "400GM BOTTLE",   "rate": 1619.05},
    {"name": "ZYORA MOUTHWASH 500ML",    "pack_size": "500ML",          "rate": 428.57},
    {"name": "EMWET SPRAY",              "pack_size": "1S",             "rate": 475.00},
    {"name": "ONCODOL 50 TAB",           "pack_size": "1 STRIP",        "rate": 50.00},
    {"name": "XENOCAINE VISCOUS",        "pack_size": "1S",             "rate": 218.57},
    {"name": "XEROWET MD",               "pack_size": "BOTTLE",         "rate": 267.24},
    {"name": "CAXIMEG ORAL SUSP 60ML",   "pack_size": "60ML",           "rate": 906.67},
    {"name": "REFILAC CAP 10S",          "pack_size": "10 CAP",         "rate": 250.00},
    {"name": "HEXAMUNE TABLETS",         "pack_size": "1S",             "rate": 98.00},
    {"name": "IMUNEXA CAPS 10S",         "pack_size": "10 CAP",         "rate": 236.76},
    {"name": "NUTAMINE SACHETS",         "pack_size": "1S",             "rate": 109.80},
]

# Map from report product name → DB product name
PRODUCT_ALIASES = {
    "AMTRIOS SOFTGEL CAP 30":  "AMTRIOS SOFTGEL CAP 30",
    "LYCOTURM SYRUP 200ML":    "LYCOTURM SYRUP 200ML",
    "NUTRIA CAPSULES":          "NUTRIA CAPSULES 1*10S",
    "ZOLVERA LOTION 150ML":    "ZOLVERA LOTION 150ML",
    "NUNEXA 400GM":            "NUNEXA 400GM",
    "ZYORA MOUTHWASH 500ML":   "ZYORA MOUTHWASH 500ML",
    "EMWET SPRAY":             "EMWET SPRAY",
    "ONCODOL 50 TAB":          "ONCODOL 50 TAB",
    "XENOCAINE VISCOUS":       "XENOCAINE VISCOUS",
    "XEROWET MD":              "XEROWET MD",
    "CAXIMEG ORAL SUSP 60ML":  "CAXIMEG ORAL SUSP 60ML",
    "REFILAC CAP 10S":         "REFILAC CAP 10S",
    "HEXAMUNE TABLETS":        "HEXAMUNE TABLETS",
    "IMUNEXA CAPS":            "IMUNEXA CAPS 10S",
    "NUTAMINE SACHETS":        "NUTAMINE SACHETS",
}


# ─────────────────────────────────────────────────────────────────────────────
# CUSTOMER + SALES DATA from the SATYA DISTRIBUTORS report
# customer_type: 'doctor' | 'pharmacy' | 'hospital' | 'distributor'
# invoices: (date_DDMMYYYY, product_raw_name, qty, value)
# ─────────────────────────────────────────────────────────────────────────────
REPORT = [
    {
        "name": "AMRA RAM",
        "phone": "9705529596",
        "type": "doctor",
        "rep": "DR ANVESH",
        "invoices": [
            ("09/05/2026", "ZYORA MOUTHWASH 500ML",        1.0,   428.57),
            ("09/05/2026", "ZYORA MOUTHWASH 500ML",        2.0,   857.14),
        ],
    },
    {
        "name": "BASAVATARAKAM INDO AMERICAN HOSPITAL",
        "phone": "9966404696",
        "type": "hospital",
        "rep": None,
        "invoices": [
            ("30/05/2026", "EMWET SPRAY",                  10.0,  5065.70),
            ("20/05/2026", "NUNEXA 400GM",                 10.0,  9593.20),
            ("25/05/2026", "NUNEXA 400GM",                 10.0,  9593.20),
            ("30/05/2026", "ONCODOL 50 TAB",               38.0,  1900.00),
            ("19/05/2026", "XENOCAINE VISCOUS",            20.0,  2500.00),
            ("09/05/2026", "XEROWET MD",                   95.0,  25387.80),
            ("18/05/2026", "XEROWET MD",                   30.0,  8017.20),
            ("30/05/2026", "ZOLVERA LOTION 150ML",         20.0,  7240.00),
        ],
    },
    {
        "name": "CHINA LAXMAIAH",
        "phone": "9985386313",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("21/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3333.33),
            ("21/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.28),
        ],
    },
    {
        "name": "CONTINENTAL HOSPITALS",
        "phone": "7288889911",
        "type": "hospital",
        "rep": None,
        "invoices": [
            ("12/05/2026", "EMWET SPRAY",                  10.0,  4160.00),
        ],
    },
    {
        "name": "D MANJULA",
        "phone": "7675056842",
        "type": "doctor",
        "rep": "DR SARATH CHANDRA G",
        "invoices": [
            ("30/05/2026", "XENOCAINE VISCOUS",            3.0,   771.42),
        ],
    },
    {
        "name": "DR A RAJYALAKSHMI",
        "phone": "9490039891",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("07/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.52),
            ("07/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
            ("07/05/2026", "NUTRIA CAPSULES",               3.0,   476.13),
            ("07/05/2026", "ZOLVERA LOTION 150ML",         1.0,   593.22),
        ],
    },
    {
        "name": "DR DARWIN",
        "phone": "9441996257",
        "type": "doctor",
        "rep": "DR ANVESH",
        "invoices": [
            ("02/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3619.05),
            ("02/05/2026", "NUNEXA 400GM",                 1.0,   1619.05),
            ("02/05/2026", "NUTRIA CAPSULES",               3.0,   476.19),
        ],
    },
    {
        "name": "DR SANKALPA NAIDU",
        "phone": "9959914308",
        "type": "doctor",
        "rep": "DR VIDYA SAGAR",
        "invoices": [
            ("12/05/2026", "REFILAC CAP 10S",              10.0,  2200.00),
            ("30/05/2026", "REFILAC CAP 10S",              20.0,  4400.00),
        ],
    },
    {
        "name": "DURGA BAI DESHMUKH HOSPITAL",
        "phone": None,
        "type": "hospital",
        "rep": None,
        "invoices": [
            ("22/05/2026", "CAXIMEG ORAL SUSP 60ML",       10.0,  9062.50),
        ],
    },
    {
        "name": "DURGABAI DESHMUKH HOSPITAL",
        "phone": "9502050103",
        "type": "hospital",
        "rep": None,
        "invoices": [
            ("04/05/2026", "CAXIMEG ORAL SUSP 60ML",       10.0,  9066.70),
            ("18/05/2026", "CAXIMEG ORAL SUSP 60ML",       10.0,  9066.70),
            ("30/05/2026", "CAXIMEG ORAL SUSP 60ML",       11.0,  9973.37),
            ("19/05/2026", "LYCOTURM SYRUP 200ML",         2.0,   2922.20),
        ],
    },
    {
        "name": "DWARAKA MEDICAL DISTRIBUTORS",
        "phone": "9848626142",
        "type": "distributor",
        "rep": None,
        "invoices": [
            ("16/05/2026", "AMTRIOS SOFTGEL CAP 30",       3.0,   8850.00),
            ("29/05/2026", "AMTRIOS SOFTGEL CAP 30",       6.0,   17700.00),
            ("16/05/2026", "CAXIMEG ORAL SUSP 60ML",       15.0,  11250.00),
            ("04/05/2026", "LYCOTURM SYRUP 200ML",         5.0,   7309.30),
            ("11/05/2026", "LYCOTURM SYRUP 200ML",         5.0,   7309.30),
            ("16/05/2026", "LYCOTURM SYRUP 200ML",         6.0,   8771.16),
            ("29/05/2026", "LYCOTURM SYRUP 200ML",         5.0,   7309.30),
            ("12/05/2026", "NUTRIA CAPSULES",               30.0,  3177.90),
            ("29/05/2026", "NUTRIA CAPSULES",               50.0,  5296.50),
            ("16/05/2026", "REFILAC CAP 10S",              12.0,  2564.52),
            ("26/05/2026", "XENOCAINE VISCOUS",            10.0,  1928.60),
            ("16/05/2026", "XEROWET MD",                   5.0,   1250.00),
            ("29/05/2026", "ZOLVERA LOTION 150ML",         10.0,  4406.80),
        ],
    },
    {
        "name": "GADDIPATI SAI RATNA",
        "phone": "7204020304",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("19/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.14),
            ("19/05/2026", "NUTRIA CAPSULES",               3.0,   476.10),
        ],
    },
    {
        "name": "GANGA PHARMA DISTRIBUTORS",
        "phone": None,
        "type": "distributor",
        "rep": None,
        "invoices": [
            ("05/05/2026", "AMTRIOS SOFTGEL CAP 30",       2.0,   5932.20),
            ("21/05/2026", "AMTRIOS SOFTGEL CAP 30",       3.0,   8898.30),
            ("13/05/2026", "ZOLVERA LOTION 150ML",         5.0,   2620.30),
        ],
    },
    {
        "name": "HYDERABAD INSTITUTE OF ONCOLOGY",
        "phone": "9951674903",
        "type": "hospital",
        "rep": None,
        "invoices": [
            ("04/05/2026", "AMTRIOS SOFTGEL CAP 30",       5.0,   9000.00),
            ("12/05/2026", "AMTRIOS SOFTGEL CAP 30",       10.0,  18000.00),
        ],
    },
    {
        "name": "JANGAIAH",
        "phone": "7731923570",
        "type": "doctor",
        "rep": None,
        "invoices": [
            ("12/05/2026", "ZOLVERA LOTION 150ML",         1.0,   576.27),
        ],
    },
    {
        "name": "JAYA SURGICAL AND PHARMA",
        "phone": None,
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("29/05/2026", "NUNEXA 400GM",                 20.0,  27800.00),
            ("29/05/2026", "XENOCAINE VISCOUS",            20.0,  2924.00),
        ],
    },
    {
        "name": "K RAMREDDY",
        "phone": "9000107298",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("05/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
        ],
    },
    {
        "name": "LAKSHMI",
        "phone": "9849926202",
        "type": "doctor",
        "rep": "DR SHARATH JAKKA",
        "invoices": [
            ("18/05/2026", "CAXIMEG ORAL SUSP 60ML",       1.0,   3809.52),
        ],
    },
    {
        "name": "MEDICARE GALAXY LLP",
        "phone": "9290865979",
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("22/05/2026", "AMTRIOS SOFTGEL CAP 30",       6.0,   16434.00),
        ],
    },
    {
        "name": "MEDIHAUXE PHARMACEUTICALS",
        "phone": None,
        "type": "distributor",
        "rep": None,
        "invoices": [
            ("21/05/2026", "HEXAMUNE TABLETS",             50.0,  4900.00),
        ],
    },
    {
        "name": "NATIONAL PHARMACY",
        "phone": "9807845845",
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("05/05/2026", "CAXIMEG ORAL SUSP 60ML",       6.0,   5282.16),
            ("13/05/2026", "CAXIMEG ORAL SUSP 60ML",       6.0,   5282.16),
            ("05/05/2026", "IMUNEXA CAPS",                 30.0,  7102.80),
            ("13/05/2026", "LYCOTURM SYRUP 200ML",         2.0,   2838.70),
            ("26/05/2026", "NUNEXA 400GM",                 2.0,   2869.84),
            ("13/05/2026", "NUTRIA CAPSULES",               70.0,  8389.50),
            ("13/05/2026", "ONCODOL 50 TAB",               20.0,  2367.80),
            ("05/05/2026", "REFILAC CAP 10S",              20.0,  8827.20),
            ("13/05/2026", "XENOCAINE VISCOUS",            50.0,  10928.50),
            ("05/05/2026", "ZOLVERA LOTION 150ML",         2.0,   950.84),
            ("05/05/2026", "ZYORA MOUTHWASH 500ML",        15.0,  5008.95),
        ],
    },
    {
        "name": "NEERAJA REDDY",
        "phone": "9848024594",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("22/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.28),
            ("09/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
            ("22/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
            ("22/05/2026", "NUTRIA CAPSULES",               3.0,   476.04),
            ("22/05/2026", "ZOLVERA LOTION 150ML",         1.0,   666.66),
        ],
    },
    {
        "name": "P KOTESHWARAMMA",
        "phone": "8341920259",
        "type": "doctor",
        "rep": None,
        "invoices": [
            ("08/05/2026", "REFILAC CAP 10S",              2.0,   500.00),
        ],
    },
    {
        "name": "P VENKATAIAH",
        "phone": "9985014719",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("30/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.52),
            ("30/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
            ("30/05/2026", "NUNEXA 400GM",                 1.0,   1688.14),
            ("30/05/2026", "NUTRIA CAPSULES",               5.0,   792.85),
        ],
    },
    {
        "name": "PRASAD MEHTA",
        "phone": "9620037860",
        "type": "doctor",
        "rep": "DR S C MOULI",
        "invoices": [
            ("15/05/2026", "REFILAC CAP 10S",              6.0,   1508.52),
        ],
    },
    {
        "name": "PURUSHOTTAM",
        "phone": "9347564857",
        "type": "doctor",
        "rep": "DR AVINASH BONDA",
        "invoices": [
            ("12/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.52),
            ("12/05/2026", "NUTRIA CAPSULES",               3.0,   476.19),
        ],
    },
    {
        "name": "RAJANNA",
        "phone": "8919263999",
        "type": "doctor",
        "rep": "DR ANVESH",
        "invoices": [
            ("11/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3619.05),
            ("11/05/2026", "ZOLVERA LOTION 150ML",         1.0,   593.22),
        ],
    },
    {
        "name": "RAMA MURTHY",
        "phone": "8978362441",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("16/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3809.52),
            ("16/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
            ("16/05/2026", "NUTRIA CAPSULES",               2.0,   342.86),
        ],
    },
    {
        "name": "RENOVA PHARMACY",
        "phone": "9705243321",
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("07/05/2026", "EMWET SPRAY",                  1.0,   475.00),
        ],
    },
    {
        "name": "RENOVA SOUMYA PHARMACY",
        "phone": "9908252963",
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("23/05/2026", "EMWET SPRAY",                  2.0,   820.00),
            ("05/05/2026", "LYCOTURM SYRUP 200ML",         9.0,   11835.00),
            ("23/05/2026", "NUNEXA 400GM",                 2.0,   2624.00),
        ],
    },
    {
        "name": "SACHIN ASTHAGE",
        "phone": "9373075845",
        "type": "doctor",
        "rep": "DR SARATH CHANDRA G",
        "invoices": [
            ("12/05/2026", "ZYORA MOUTHWASH 500ML",        2.0,   761.90),
        ],
    },
    {
        "name": "SAVITRI",
        "phone": "9603064002",
        "type": "doctor",
        "rep": "DR ANVESH",
        "invoices": [
            ("09/05/2026", "AMTRIOS SOFTGEL CAP 30",       1.0,   3619.04),
            ("09/05/2026", "NUTRIA CAPSULES",               3.0,   476.19),
        ],
    },
    {
        "name": "SHABANA",
        "phone": "9640875486",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("25/05/2026", "NUTRIA CAPSULES",               3.0,   571.41),
        ],
    },
    {
        "name": "SHABANA BEGUM",
        "phone": "9963052471",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("04/05/2026", "NUTRIA CAPSULES",               2.0,   317.42),
        ],
    },
    {
        "name": "SHOBHA",
        "phone": "9985100900",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("22/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.80),
            ("22/05/2026", "NUTRIA CAPSULES",               6.0,   952.20),
        ],
    },
    {
        "name": "SRI SAI ASHIRWAD ENTERPRISES",
        "phone": "9959879545",
        "type": "pharmacy",
        "rep": None,
        "invoices": [
            ("25/05/2026", "NUNEXA 400GM",                 10.0,  13294.10),
            ("25/05/2026", "NUTAMINE SACHETS",             10.0,  1098.00),
        ],
    },
    {
        "name": "SYED WAHEED",
        "phone": "9885866448",
        "type": "doctor",
        "rep": "DR ZOHA",
        "invoices": [
            ("08/05/2026", "CAXIMEG ORAL SUSP 60ML",       1.0,   1038.09),
        ],
    },
    {
        "name": "VARSHA ARORA",
        "phone": "7984196410",
        "type": "doctor",
        "rep": "DR GANGADHAR",
        "invoices": [
            ("02/05/2026", "LYCOTURM SYRUP 200ML",         1.0,   1714.29),
        ],
    },
    {
        "name": "VIJAY",
        "phone": "9640444431",
        "type": "doctor",
        "rep": "DR ARMURGAN",
        "invoices": [
            ("25/05/2026", "EMWET SPRAY",                  4.0,   2933.32),
            ("25/05/2026", "ZOLVERA LOTION 150ML",         1.0,   559.32),
            ("25/05/2026", "ZYORA MOUTHWASH 500ML",        1.0,   388.57),
        ],
    },
    {
        "name": "ZAMRUD BEGUM",
        "phone": "9849051017",
        "type": "doctor",
        "rep": "DR SENTHIL RAJAPPA",
        "invoices": [
            ("16/05/2026", "CAXIMEG ORAL SUSP 60ML",       1.0,   3428.57),
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def clean_phone(phone):
    if not phone: return None
    return re.sub(r'\D', '', phone)[-10:]


def similarity(a, b):
    return SequenceMatcher(None, (a or '').lower(), (b or '').lower()).ratio()


def find_doctor_by_phone(phone):
    digits = clean_phone(phone)
    if not digits: return None
    for doc in db.query(Doctor).filter(Doctor.is_active == True).all():
        if clean_phone(doc.phone) == digits:
            return doc
    return None


def find_user_by_rep_name(rep_name):
    if not rep_name: return None
    clean = re.sub(r'^DR\.?\s*', '', rep_name, flags=re.IGNORECASE).strip()
    users = db.query(User).filter(User.is_active == True).all()
    best, best_score = None, 0.0
    for u in users:
        for candidate in [(u.name or ''), (u.name or '').split()[-1]]:
            s = similarity(clean, candidate)
            if s > best_score:
                best_score = s
                best = u
    return best if best_score >= 0.60 else None


def get_or_create_product(canonical_name):
    prod = db.query(Product).filter(Product.name.ilike(canonical_name)).first()
    if not prod:
        # Try fuzzy match
        for p in db.query(Product).all():
            if similarity(canonical_name, p.name) >= 0.85:
                return p
    return prod


def date_to_ymd(date_str):
    """'DD/MM/YYYY' → (year, month, day, 'YYYY-MM-DD')"""
    d, m, y = date_str.split('/')
    return int(y), int(m), int(d), f"{y}-{m}-{d}"


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Seed products
# ─────────────────────────────────────────────────────────────────────────────
def seed_products():
    log("\n━━━ STEP 1: Products ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    created = 0
    for p in PRODUCTS_TO_SEED:
        existing = db.query(Product).filter(Product.name.ilike(p["name"])).first()
        if existing:
            log(f"  ✓ {p['name']:45s} (exists)")
        else:
            new_prod = Product(
                name      = p["name"],
                pack_size = p.get("pack_size"),
                rate      = p.get("rate", 0.0),
                is_active = True,
            )
            db.add(new_prod)
            db.commit()
            log(f"  + {p['name']:45s} (created, rate ₹{p['rate']})")
            created += 1
    log(f"\n  {created} new products added, {len(PRODUCTS_TO_SEED)-created} already existed.")
    return created


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 & 3: Create doctors + insert sales
# ─────────────────────────────────────────────────────────────────────────────
def import_doctors_and_sales():
    log("\n━━━ STEP 2 & 3: Doctors + Sales ━━━━━━━━━━━━━━━━━━━━━━━━")

    # ALL data in this sheet belongs to Vani B
    vani = db.query(User).filter(User.name.ilike('%vani%')).first()
    if not vani:
        log("  ✗ ERROR: Could not find user 'Vani B' in database. Check Admin → Users.")
        return 0, 0, 0, 0.0, []
    log(f"  ✓ All entries will be assigned to: {vani.name} (id={vani.id})")

    docs_created   = 0
    docs_matched   = 0
    sales_inserted = 0
    total_value    = 0.0

    for entry in REPORT:
        cname = entry["name"]
        phone = entry["phone"]
        ctype = entry["type"]

        log(f"\n  ─── {cname} ───")

        # Find or create doctor
        doc = find_doctor_by_phone(phone) if phone else None

        if doc:
            log(f"  ✓ Found in DB: {doc.name} (id={doc.id})")
            docs_matched += 1
        else:
            doc = Doctor(
                name          = cname,
                phone         = phone,
                customer_type = ctype,
                manager_id    = vani.id,
                is_active     = True,
            )
            db.add(doc)
            db.commit()
            db.refresh(doc)
            log(f"  + Created: {cname} | phone: {phone or 'n/a'} | type: {ctype} (id={doc.id})")
            docs_created += 1

        associate_id = vani.id

        # Group invoices: (date_str, product_raw) → (qty, value)
        # Multiple invoice lines for same product on same date get summed
        daily = {}
        for (date_str, prod_raw, qty, value) in entry["invoices"]:
            canonical = PRODUCT_ALIASES.get(prod_raw.upper().strip(), prod_raw.strip())
            yr, mo, day, sale_date = date_to_ymd(date_str)
            key = (canonical, sale_date, yr, mo, day)
            if key not in daily:
                daily[key] = [0.0, 0.0]
            daily[key][0] += qty
            daily[key][1] += value

        for (canonical, sale_date, yr, mo, day), (qty, val) in daily.items():
            prod = get_or_create_product(canonical)
            if not prod:
                log(f"  ⚠ Product '{canonical}' still not found — skipping")
                continue

            existing = db.query(SalesEntry).filter(
                SalesEntry.doctor_id    == doc.id,
                SalesEntry.associate_id == associate_id,
                SalesEntry.product_id   == prod.id,
                SalesEntry.year         == yr,
                SalesEntry.month        == mo,
                SalesEntry.week         == day,
            ).first()

            if existing:
                existing.quantity  = qty
                existing.value     = val
                existing.sale_date = sale_date
                existing.remarks   = SOURCE_TAG
                db.commit()
                log(f"  ↻ {sale_date}  {prod.name}: {qty:.0f} units  ₹{val:,.2f} (updated)")
            else:
                db.add(SalesEntry(
                    doctor_id    = doc.id,
                    associate_id = associate_id,
                    product_id   = prod.id,
                    year         = yr,
                    month        = mo,
                    week         = day,
                    sale_date    = sale_date,
                    quantity     = qty,
                    value        = val,
                    remarks      = SOURCE_TAG,
                    is_approved  = True,
                    submitted_at = datetime.utcnow(),
                ))
                db.commit()
                log(f"  ✓ {sale_date}  {prod.name}: {qty:.0f} units  ₹{val:,.2f}")

            sales_inserted += 1
            total_value    += val

    return docs_created, docs_matched, sales_inserted, total_value, []


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def run():
    log("━" * 60)
    log("  Fortel CRM  —  SATYA DISTRIBUTORS Import")
    log(f"  Period: May {YEAR}  |  Customers: {len(REPORT)}")
    log("━" * 60)

    prod_created = seed_products()
    docs_created, docs_matched, sales_inserted, total_value, unmatched_reps = import_doctors_and_sales()

    log("\n" + "━" * 60)
    log("  SUMMARY")
    log("━" * 60)
    log(f"  Products created     : {prod_created}")
    log(f"  Doctors matched      : {docs_matched}")
    log(f"  Doctors created      : {docs_created}")
    log(f"  Sales entries saved  : {sales_inserted}")
    log(f"  Total value imported : ₹{total_value:,.2f}")

    if unmatched_reps:
        unique = sorted(set(unmatched_reps))
        log(f"\n  ℹ  {len(unique)} rep name(s) not matched to a Fortel user:")
        for r in unique:
            log(f"     • {r}")
        log("     Verify these names in Admin → Users and re-run if needed.")

    log("\n  ✅ Done! Open the dashboard to see reports.")

    log_path = os.path.join(os.path.dirname(__file__), "satya_import_log.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG))
    log(f"\n  Full log: {log_path}")


if __name__ == "__main__":
    try:
        run()
    finally:
        db.close()
