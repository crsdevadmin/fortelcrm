# backend/main.py
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .core.config import settings

from .auth.auth import enforce_request_identity, router as auth_router
from .routers.users import router as users_router
from .routers.sales import router as sales_router
from .routers.investments import router as investments_router
from .routers.roi import router as roi_router
from .routers.regions import router as regions_router
from .routers.doctors import router as doctors_router
from .routers.products import router as products_router
from .routers.visits import router as visits_router
from .routers.targets import router as targets_router
from .routers.notifications import router as notifications_router
from .routers.tasks import router as tasks_router
from .routers.dashboard import router as dashboard_router
from .routers.reports import router as reports_router
from .routers.primary_sales import router as primary_sales_router, transport_router as primary_sales_transport_router
from .routers.expenses import router as expenses_router
from .routers.collections import router as collections_router
from .routers.secondary_sales import router as secondary_sales_router

Base.metadata.create_all(bind=engine)


def _migrate_renamed_territories():
    """Move rows saved under a territory that has since been split (e.g. the old
    single "Chennai") to its successor ("Chennai 1"). Idempotent."""
    from sqlalchemy import text
    from .utils.regional_territories import RENAMED_TERRITORIES
    with engine.begin() as conn:
        for old, new in RENAMED_TERRITORIES.items():
            # user access: skip users who already have the new name (unique constraint)
            conn.execute(text(
                "DELETE FROM user_regional_territories t WHERE t.territory = :old AND EXISTS ("
                " SELECT 1 FROM user_regional_territories n WHERE n.user_id = t.user_id AND n.territory = :new)"
            ), {"old": old, "new": new})
            for table in ("user_regional_territories", "stockists", "primary_city_split_entries"):
                conn.execute(text(f"UPDATE {table} SET territory = :new WHERE territory = :old"),
                             {"old": old, "new": new})


try:
    _migrate_renamed_territories()
except Exception as exc:  # never block startup on this
    print("territory rename migration skipped:", exc)

try:
    from .database import SessionLocal
    from .utils.regional_territories import load_territory_owners
    _db = SessionLocal()
    try:
        load_territory_owners(_db)
    finally:
        _db.close()
except Exception as exc:
    print("territory owner load skipped:", exc)

app = FastAPI(
    title="Fortel CRM API",
    description="Doctor Investment, ROI and Growth Platform - Fortel Life Sciences",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys([
        settings.FRONTEND_URL,
        "https://dzetmt39mvlql.cloudfront.net",
        "http://13.206.119.130",
    ])),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
private = [Depends(enforce_request_identity)]
app.include_router(users_router, dependencies=private)
app.include_router(sales_router, dependencies=private)
app.include_router(investments_router, dependencies=private)
app.include_router(roi_router, dependencies=private)
app.include_router(regions_router, dependencies=private)
app.include_router(doctors_router, dependencies=private)
app.include_router(products_router, dependencies=private)
app.include_router(visits_router, dependencies=private)
app.include_router(targets_router, dependencies=private)
app.include_router(notifications_router, dependencies=private)
app.include_router(tasks_router, dependencies=private)
app.include_router(dashboard_router, dependencies=private)
app.include_router(reports_router, dependencies=private)
app.include_router(primary_sales_router, dependencies=private)
app.include_router(primary_sales_transport_router, dependencies=private)
app.include_router(expenses_router, dependencies=private)
app.include_router(collections_router, dependencies=private)
app.include_router(secondary_sales_router, dependencies=private)


@app.get("/")
def health():
    return {"status": "ok", "service": "Fortel CRM API"}
