# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .core.config import settings

from .auth.auth import router as auth_router
from .routers.users import router as users_router
from .routers.sales import router as sales_router
from .routers.investments import router as investments_router
from .routers.roi import router as roi_router
from .routers.regions import router as regions_router
from .routers.doctors import router as doctors_router
from .routers.products import router as products_router
from .routers.visits import router as visits_router
from .routers.exports import router as exports_router

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Fortel CRM API",
    description="Doctor Investment, ROI and Growth Platform - Fortel Life Sciences",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(sales_router)
app.include_router(investments_router)
app.include_router(roi_router)
app.include_router(regions_router)
app.include_router(doctors_router)
app.include_router(products_router)
app.include_router(visits_router)
app.include_router(exports_router)


@app.get("/")
def health():
    return {"status": "ok", "service": "Fortel CRM API"}
