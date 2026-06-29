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
    pack_size: Optional[str] = None
    rate: float = 0.0


@router.get("/")
def list_products(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.is_active == True).all()
    return [
        {"id": p.id, "name": p.name, "pack_size": p.pack_size, "rate": p.rate}
        for p in products
    ]


@router.post("/")
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(Product).filter(Product.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Product already exists")
    p = Product(name=payload.name, pack_size=payload.pack_size, rate=payload.rate)
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name, "rate": p.rate}


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.is_active = False
    db.commit()
    return {"status": "deactivated"}
