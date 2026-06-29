# backend/seed_products.py
# Seeds Fortel products into the DB
# Run: python -m backend.seed_products

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from backend.database import SessionLocal
from backend.models.models import Product

db = SessionLocal()

PRODUCTS = [
    {"name": "Amtrios Injection", "pack_size": "1 vial", "rate": 0.0},
    {"name": "Product B",         "pack_size": None,      "rate": 0.0},
    {"name": "Product C",         "pack_size": None,      "rate": 0.0},
]

for p in PRODUCTS:
    existing = db.query(Product).filter(Product.name == p["name"]).first()
    if existing:
        print(f"  SKIP (exists): {p['name']}")
        continue
    db.add(Product(name=p["name"], pack_size=p["pack_size"], rate=p["rate"]))
    print(f"  + {p['name']}")

db.commit()
db.close()
print("\nProducts seeded.")
