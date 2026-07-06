"""
Run this ONCE after stopping the uvicorn server to apply backend patches.
Usage:  python apply_backend_patches.py
"""
import os, re

BASE = os.path.dirname(os.path.abspath(__file__))

def patch_file(path, old, new, label):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if old in content:
        content = content.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ Patched: {label}")
    else:
        print(f"  ⚠️  Already done or not found: {label}")

# ── 1. Register exports router in main.py ─────────────────────────────────────
main_py = os.path.join(BASE, "backend", "main.py")

patch_file(
    main_py,
    "from .routers.visits import router as visits_router",
    "from .routers.visits import router as visits_router\nfrom .routers.exports import router as exports_router",
    "main.py: import exports_router",
)
patch_file(
    main_py,
    "app.include_router(visits_router)",
    "app.include_router(visits_router)\napp.include_router(exports_router)",
    "main.py: include_router(exports_router)",
)

# ── 2. Add User import to sales.py ────────────────────────────────────────────
sales_py = os.path.join(BASE, "backend", "routers", "sales.py")

patch_file(
    sales_py,
    "from ..models.models import SalesEntry, Doctor, Product",
    "from ..models.models import SalesEntry, Doctor, Product, User",
    "sales.py: add User import",
)

print("\nDone. Restart uvicorn now.")
