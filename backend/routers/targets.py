from datetime import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import Product, ProductTarget, SalesEntry, User
from ..utils.hierarchy import get_subtree_ids

router = APIRouter(prefix="/targets", tags=["Targets"])


def _require_md(actor_id: int, db: Session) -> User:
    actor = db.query(User).filter(User.id == actor_id, User.is_active == True).first()
    if not actor:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != "md":
        raise HTTPException(status_code=403, detail="Only MD can manage targets")
    return actor


def _previous_months(year: int, month: int, count: int = 3):
    pairs = []
    y, m = year, month
    for _ in range(count):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        pairs.append((y, m))
    return pairs


def _normalize_product_name(name: str) -> str:
    text = (name or "").upper().replace("'S", "S")
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    replacements = {
        r"\bCAPSULES?\b|\bCAPS\b": "CAP",
        r"\bTABLETS?\b|\bTABS?\b": "TAB",
        r"\bSACHETS?\b": "SACHET",
        r"\bINJECTIONS?\b": "INJ",
        r"\bGRAMS?\b|\bGMS?\b": "GM",
        r"\bM L\b": "ML",
    }
    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"\b(\d+)\s+(ML|MG|GM|G|S)\b", r"\1\2", text)
    text = re.sub(r"\b1\s*X?\s*10S\b", "10S", text)
    return re.sub(r"\s+", " ", text).strip()


def _product_base_key(normalized_name: str) -> str:
    text = re.sub(r"\b\d+(?:ML|MG|GM|G|S)\b", " ", normalized_name)
    text = re.sub(r"\b\d+\s*X\s*\d+\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _group_products(products: List[Product]):
    by_base = {}
    metadata = {}
    for product in products:
        normalized = _normalize_product_name(product.name)
        base = _product_base_key(normalized)
        by_base.setdefault(base, set()).add(normalized)
        metadata[product.id] = {"normalized": normalized, "base": base}

    groups = {}
    for product in products:
        meta = metadata[product.id]
        variants = by_base.get(meta["base"], set())
        has_unsized_variant = meta["base"] in variants
        group_key = meta["base"] if len(variants) <= 1 or (has_unsized_variant and len(variants) <= 2) else meta["normalized"]
        groups.setdefault(group_key, []).append(product)

    return [
        sorted(group, key=lambda p: (not bool(p.price or p.rate), p.name or "", p.id))
        for group in groups.values()
    ]


def _product_group_lookup(products: List[Product]):
    lookup = {}
    for group in _group_products(products):
        ids = [p.id for p in group]
        for product_id in ids:
            lookup[product_id] = ids
    return lookup


def _owner_sales_user_ids(owner_id: int, db: Session):
    owner = db.query(User).filter(User.id == owner_id, User.is_active == True).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Target user not found")

    subtree = get_subtree_ids(owner_id, db)
    if subtree is None:
        return [owner_id]
    return list(subtree)


def _user_dict(u: User):
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role,
        "display_role": u.display_role,
        "reports_to_id": u.reports_to_id,
        "reports_to_name": u.reports_to.name if u.reports_to else "",
    }


class TargetItem(BaseModel):
    product_id: int
    target_units: float = 0
    target_rate: Optional[float] = None
    target_value: float = 0


class TargetSaveRequest(BaseModel):
    actor_id: int
    owner_user_id: int
    year: int
    month: int
    items: List[TargetItem]


@router.get("/assignees")
def list_target_assignees(actor_id: int, db: Session = Depends(get_db)):
    _require_md(actor_id, db)
    roles = ["director", "senior_manager", "manager", "rep", "custom"]
    users = (
        db.query(User)
        .filter(User.is_active == True, User.role.in_(roles))
        .order_by(User.role, User.name)
        .all()
    )
    return [_user_dict(u) for u in users]


@router.get("/context")
def get_target_context(
    actor_id: int,
    owner_user_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
):
    _require_md(actor_id, db)
    owner = db.query(User).filter(User.id == owner_user_id, User.is_active == True).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Target user not found")

    sales_user_ids = _owner_sales_user_ids(owner_user_id, db)
    prev_months = _previous_months(year, month)

    month_filters = [
        (SalesEntry.year == y) & (SalesEntry.month == m)
        for y, m in prev_months
    ]

    sales_rows = []
    if sales_user_ids:
        sales_rows = (
            db.query(
                SalesEntry.product_id,
                SalesEntry.year,
                SalesEntry.month,
                func.sum(SalesEntry.qty).label("units"),
                func.sum(SalesEntry.value).label("value"),
            )
            .filter(SalesEntry.associate_id.in_(sales_user_ids))
            .filter(*([] if not month_filters else [month_filters[0] | month_filters[1] | month_filters[2]]))
            .group_by(SalesEntry.product_id, SalesEntry.year, SalesEntry.month)
            .all()
        )

    product_month_sales = {}
    for row in sales_rows:
        product_month_sales[(row.product_id, row.year, row.month)] = {
            "units": float(row.units or 0),
            "value": float(row.value or 0),
        }

    existing_targets = {
        t.product_id: t
        for t in db.query(ProductTarget).filter(
            ProductTarget.owner_user_id == owner_user_id,
            ProductTarget.year == year,
            ProductTarget.month == month,
        ).all()
    }

    products = db.query(Product).filter(Product.is_active == True).order_by(Product.name).all()
    rows = []
    total_avg_value = total_target_value = 0.0
    total_avg_units = total_target_units = 0.0

    for product_group in _group_products(products):
        product = product_group[0]
        product_ids = [p.id for p in product_group]
        history = []
        units_sum = value_sum = 0.0
        for y, m in prev_months:
            cell_units = cell_value = 0.0
            for product_id in product_ids:
                cell = product_month_sales.get((product_id, y, m), {"units": 0.0, "value": 0.0})
                cell_units += cell["units"]
                cell_value += cell["value"]
            units_sum += cell_units
            value_sum += cell_value
            history.append({
                "year": y,
                "month": m,
                "units": round(cell_units, 2),
                "value": round(cell_value, 2),
            })

        group_targets = [existing_targets[product_id] for product_id in product_ids if product_id in existing_targets]
        avg_units = units_sum / 3
        avg_value = value_sum / 3
        target_units = sum(float(target.target_units or 0) for target in group_targets)
        target_value = sum(float(target.target_value or 0) for target in group_targets)
        stored_rate = next((float(target.target_rate) for target in group_targets if target.target_rate), None)
        default_rate = next((float(p.price or p.rate) for p in product_group if p.price or p.rate), 0.0)
        target_rate = stored_rate if stored_rate is not None else default_rate

        total_avg_units += avg_units
        total_avg_value += avg_value
        total_target_units += target_units
        total_target_value += target_value

        rows.append({
            "product_id": product.id,
            "product_name": product.name,
            "rate": default_rate,
            "target_rate": round(target_rate, 2),
            "last_3_months": history,
            "avg_units": round(avg_units, 2),
            "avg_value": round(avg_value, 2),
            "target_units": round(target_units, 2),
            "target_value": round(target_value, 2),
        })

    return {
        "owner": _user_dict(owner),
        "year": year,
        "month": month,
        "history_months": [{"year": y, "month": m} for y, m in prev_months],
        "summary": {
            "products": len(rows),
            "avg_units": round(total_avg_units, 2),
            "avg_value": round(total_avg_value, 2),
            "target_units": round(total_target_units, 2),
            "target_value": round(total_target_value, 2),
        },
        "products": rows,
    }


@router.post("/")
def save_targets(payload: TargetSaveRequest, db: Session = Depends(get_db)):
    actor = _require_md(payload.actor_id, db)
    owner = db.query(User).filter(User.id == payload.owner_user_id, User.is_active == True).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Target user not found")
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")

    products = db.query(Product).filter(Product.is_active == True).order_by(Product.name).all()
    product_ids = {p.id for p in products}
    grouped_product_ids = _product_group_lookup(products)
    saved = 0
    for item in payload.items:
        if item.product_id not in product_ids:
            continue
        duplicate_ids = [pid for pid in grouped_product_ids.get(item.product_id, [item.product_id]) if pid != item.product_id]
        if duplicate_ids:
            db.query(ProductTarget).filter(
                ProductTarget.owner_user_id == payload.owner_user_id,
                ProductTarget.product_id.in_(duplicate_ids),
                ProductTarget.year == payload.year,
                ProductTarget.month == payload.month,
            ).delete(synchronize_session=False)
        target = db.query(ProductTarget).filter(
            ProductTarget.owner_user_id == payload.owner_user_id,
            ProductTarget.product_id == item.product_id,
            ProductTarget.year == payload.year,
            ProductTarget.month == payload.month,
        ).first()
        if target:
            target.target_units = float(item.target_units or 0)
            target.target_rate = float(item.target_rate or 0) if item.target_rate is not None else None
            target.target_value = float(item.target_value or 0)
            target.updated_by_id = actor.id
            target.updated_at = datetime.utcnow()
        else:
            db.add(ProductTarget(
                owner_user_id=payload.owner_user_id,
                product_id=item.product_id,
                year=payload.year,
                month=payload.month,
                target_units=float(item.target_units or 0),
                target_rate=float(item.target_rate or 0) if item.target_rate is not None else None,
                target_value=float(item.target_value or 0),
                created_by_id=actor.id,
                updated_by_id=actor.id,
            ))
        saved += 1

    db.commit()
    return {"status": "saved", "targets_saved": saved}


@router.get("/summary")
def get_target_summary(
    user_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.utcnow()
    eff_year = year or now.year
    eff_month = month or now.month
    sales_user_ids = _owner_sales_user_ids(user_id, db)

    target = db.query(
        func.sum(ProductTarget.target_units).label("units"),
        func.sum(ProductTarget.target_value).label("value"),
    ).filter(
        ProductTarget.owner_user_id == user_id,
        ProductTarget.year == eff_year,
        ProductTarget.month == eff_month,
    ).first()

    actual = db.query(
        func.sum(SalesEntry.qty).label("units"),
        func.sum(SalesEntry.value).label("value"),
    ).filter(
        SalesEntry.associate_id.in_(sales_user_ids),
        SalesEntry.year == eff_year,
        SalesEntry.month == eff_month,
    ).first()

    target_units = float(target.units or 0)
    target_value = float(target.value or 0)
    actual_units = float(actual.units or 0)
    actual_value = float(actual.value or 0)
    remaining_value = max(target_value - actual_value, 0)
    achievement_pct = round((actual_value / target_value) * 100, 1) if target_value > 0 else 0

    target_rows = db.query(ProductTarget).filter(
        ProductTarget.owner_user_id == user_id,
        ProductTarget.year == eff_year,
        ProductTarget.month == eff_month,
    ).all()

    actual_rows = db.query(
        SalesEntry.product_id,
        func.sum(SalesEntry.qty).label("units"),
        func.sum(SalesEntry.value).label("value"),
    ).filter(
        SalesEntry.associate_id.in_(sales_user_ids),
        SalesEntry.year == eff_year,
        SalesEntry.month == eff_month,
    ).group_by(SalesEntry.product_id).all()

    actual_by_product = {
        row.product_id: {
            "units": float(row.units or 0),
            "value": float(row.value or 0),
        }
        for row in actual_rows
    }

    products = db.query(Product).filter(Product.is_active == True).order_by(Product.name).all()
    target_by_product = {target_row.product_id: target_row for target_row in target_rows}
    product_rows = []
    for product_group in _group_products(products):
        group_targets = [target_by_product[p.id] for p in product_group if p.id in target_by_product]
        if not group_targets:
            continue
        product = product_group[0]
        product_ids = [p.id for p in product_group]
        row_target_value = sum(float(target_row.target_value or 0) for target_row in group_targets)
        row_target_units = sum(float(target_row.target_units or 0) for target_row in group_targets)
        row_actual_units = sum(float(actual_by_product.get(product_id, {"units": 0.0})["units"] or 0) for product_id in product_ids)
        row_actual_value = sum(float(actual_by_product.get(product_id, {"value": 0.0})["value"] or 0) for product_id in product_ids)
        product_rows.append({
            "product_id": product.id,
            "product_name": product.name if product else f"Product {product.id}",
            "target_units": round(row_target_units, 2),
            "target_value": round(row_target_value, 2),
            "actual_units": round(row_actual_units, 2),
            "actual_value": round(row_actual_value, 2),
            "remaining_value": round(max(row_target_value - row_actual_value, 0), 2),
            "achievement_pct": round((row_actual_value / row_target_value) * 100, 1) if row_target_value > 0 else 0,
        })
    product_rows.sort(key=lambda row: (row["remaining_value"] <= 0, -row["remaining_value"], row["product_name"]))

    return {
        "user_id": user_id,
        "year": eff_year,
        "month": eff_month,
        "target_units": round(target_units, 2),
        "target_value": round(target_value, 2),
        "actual_units": round(actual_units, 2),
        "actual_value": round(actual_value, 2),
        "remaining_value": round(remaining_value, 2),
        "achievement_pct": achievement_pct,
        "has_target": target_value > 0 or target_units > 0,
        "products": product_rows,
    }
