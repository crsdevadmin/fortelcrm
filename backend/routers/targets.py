from datetime import datetime
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

    for product in products:
        history = []
        units_sum = value_sum = 0.0
        for y, m in prev_months:
            cell = product_month_sales.get((product.id, y, m), {"units": 0.0, "value": 0.0})
            units_sum += cell["units"]
            value_sum += cell["value"]
            history.append({
                "year": y,
                "month": m,
                "units": round(cell["units"], 2),
                "value": round(cell["value"], 2),
            })

        target = existing_targets.get(product.id)
        avg_units = units_sum / 3
        avg_value = value_sum / 3
        target_units = float(target.target_units if target else 0)
        target_value = float(target.target_value if target else 0)

        total_avg_units += avg_units
        total_avg_value += avg_value
        total_target_units += target_units
        total_target_value += target_value

        rows.append({
            "product_id": product.id,
            "product_name": product.name,
            "rate": float(product.price or product.rate or 0),
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

    product_ids = {p.id for p in db.query(Product.id).filter(Product.is_active == True).all()}
    saved = 0
    for item in payload.items:
        if item.product_id not in product_ids:
            continue
        target = db.query(ProductTarget).filter(
            ProductTarget.owner_user_id == payload.owner_user_id,
            ProductTarget.product_id == item.product_id,
            ProductTarget.year == payload.year,
            ProductTarget.month == payload.month,
        ).first()
        if target:
            target.target_units = float(item.target_units or 0)
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
                target_value=float(item.target_value or 0),
                created_by_id=actor.id,
                updated_by_id=actor.id,
            ))
        saved += 1

    db.commit()
    return {"status": "saved", "targets_saved": saved}
