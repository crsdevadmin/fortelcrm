# backend/routers/products.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from ..database import get_db
from ..models.models import Product

router = APIRouter(prefix="/products", tags=["Products"])


class ProductCreate(BaseModel):
    name: str
    pack_size: Optional[str] = None   # stored as Product.code
    composition: Optional[str] = None
    pack: Optional[str] = None
    rate: float = 0.0                 # stored as Product.price (PTS)
    gst: Optional[str] = None         # e.g. "5%"
    mrp: Optional[float] = None       # Maximum Retail Price
    category: Optional[str] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    pack_size: Optional[str] = None
    composition: Optional[str] = None
    pack: Optional[str] = None
    rate: Optional[float] = None
    gst: Optional[str] = None
    mrp: Optional[float] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None


def _to_dict(p: Product) -> dict:
    return {
        "id":          p.id,
        "name":        p.name,
        "pack_size":   p.code or "",
        "composition": p.composition or "",
        "pack":        p.pack or p.code or "",
        "rate":        p.price or p.rate or 0.0,
        "gst":         p.gst or "5%",
        "mrp":         p.mrp or 0.0,
        "category":    p.category or "",
        "is_active":   p.is_active,
    }


@router.get("/")
def list_products(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.is_active == True).order_by(Product.name).all()
    return [_to_dict(p) for p in products]


@router.get("/all")
def list_all_products(db: Session = Depends(get_db)):
    """All products including inactive — for admin."""
    products = db.query(Product).order_by(Product.name).all()
    return [_to_dict(p) for p in products]


@router.post("/")
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(Product).filter(Product.name == payload.name).first()
    if existing:
        # Update instead of error if product already exists
        existing.code        = payload.pack_size or existing.code
        existing.composition = payload.composition or existing.composition
        existing.pack        = payload.pack or existing.pack
        existing.price       = payload.rate if payload.rate else existing.price
        existing.gst         = payload.gst or existing.gst
        existing.mrp         = payload.mrp if payload.mrp else existing.mrp
        existing.category    = payload.category or existing.category
        existing.is_active   = True
        db.commit()
        db.refresh(existing)
        return _to_dict(existing)
    p = Product(
        name=payload.name,
        code=payload.pack_size,
        composition=payload.composition,
        pack=payload.pack,
        price=payload.rate,
        gst=payload.gst,
        mrp=payload.mrp,
        category=payload.category,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.patch("/{product_id}")
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if payload.name        is not None: p.name        = payload.name
    if payload.pack_size   is not None: p.code        = payload.pack_size
    if payload.composition is not None: p.composition = payload.composition
    if payload.pack        is not None: p.pack        = payload.pack
    if payload.rate        is not None: p.price       = payload.rate
    if payload.gst         is not None: p.gst         = payload.gst
    if payload.mrp         is not None: p.mrp         = payload.mrp
    if payload.category    is not None: p.category    = payload.category
    if payload.is_active   is not None: p.is_active   = payload.is_active
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.is_active = False
    db.commit()
    return {"status": "deactivated"}
