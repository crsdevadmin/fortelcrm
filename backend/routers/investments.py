# backend/routers/investments.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..models.models import Investment, InvestmentCategory, InvestmentSubCategory, Doctor, User, SalesEntry
from ..utils.hierarchy import get_subtree_ids
from pydantic import BaseModel
from ..core.config import settings

router = APIRouter(prefix="/investments", tags=["Investments"])


COMMERCIAL_MODEL_LABELS = {
    "U1": "Upfront Investment Account",
    "U2": "Strategic Upfront Account",
    "P1": "Performance-Linked Account",
    "P2": "Growth Incentive Account",
    "N1": "Natural Prescriber",
    "D1": "Development Account",
    "R1": "At-Risk Account",
}

COMMERCIAL_MODEL_DESC = {
    "U1": "Investment made first, expected business multiple later",
    "U2": "High-value account with long-term growth potential",
    "P1": "Support linked to actual sales generated",
    "P2": "Support increases as business increases",
    "N1": "Prescribes without significant investment",
    "D1": "New doctor under evaluation",
    "R1": "Declining business or high competitor threat",
}

CATEGORY_LABELS = {
    "PD": "Professional Development",
    "RD": "Research & Development",
    "CS": "Commercial Support",
}


@router.get("/my")
def get_my_investments(
    associate_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment).filter(Investment.associate_id == associate_id)
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    q = q.order_by(Investment.year.desc(), Investment.month.desc(), Investment.week.desc())
    invs = q.all()

    result = []
    for i in invs:
        doc = db.query(Doctor).filter(Doctor.id == i.doctor_id).first()
        cmt = i.commercial_model_type or (doc.commercial_model if doc else None)
        result.append({
            "id":                    i.id,
            "doctor_id":             i.doctor_id,
            "doctor_name":           doc.name if doc else "Unknown",
            "doctor_commercial_model": doc.commercial_model if doc else None,
            "commercial_model_type": cmt,
            "commercial_model_label":COMMERCIAL_MODEL_LABELS.get(cmt or "", ""),
            "expected_multiple":     i.expected_multiple,
            "year":                  i.year,
            "month":                 i.month,
            "week":                  i.week,
            "category":              _str_cat(i.category) or None,
            "sub_category":          _str_cat(i.sub_category) or None,
            "amount":                i.amount,
            "expected_sales":        i.expected_sales,
            "purpose":               i.purpose,
            "bill_url":              i.bill_url,
            "is_approved":           i.is_approved,
            "submitted_at":          i.submitted_at.isoformat() if i.submitted_at else None,
        })
    return result


@router.get("/summary/my")
def get_my_investment_summary(
    associate_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment).filter(Investment.associate_id == associate_id)
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    invs = q.all()
    total      = sum(i.amount for i in invs)
    approved   = sum(i.amount for i in invs if i.is_approved)
    pending    = sum(i.amount for i in invs if not i.is_approved)
    exp_sales  = sum(i.expected_sales or 0 for i in invs)
    return {
        "total": round(total, 2),
        "approved": round(approved, 2),
        "pending": round(pending, 2),
        "expected_sales": round(exp_sales, 2),
        "count": len(invs),
    }




COMMERCIAL_MODEL_TO_CATEGORY = {
    "U1": "PD", "U2": "PD",
    "P1": "PD", "P2": "PD",
    "N1": "CS",
    "D1": "PD",
    "R1": "CS",
}


def _str_cat(v) -> str:
    if v is None:
        return ""
    return v.value if hasattr(v, "value") else str(v)


class InvestmentPayload(BaseModel):
    doctor_id: int
    associate_id: Optional[int] = None
    commercial_model_type: Optional[str] = None
    expected_multiple: Optional[float] = 5.0
    year: int
    month: int
    week: Optional[int] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    amount: float
    expected_sales: Optional[float] = None
    purpose: Optional[str] = None
    bill_url: Optional[str] = None


@router.post("/")
def create_investment(payload: InvestmentPayload, db: Session = Depends(get_db)):
    try:
        # Auto-derive category from commercial_model_type if not provided
        category = payload.category or COMMERCIAL_MODEL_TO_CATEGORY.get(
            payload.commercial_model_type or "", "PD"
        )
        inv = Investment(
            doctor_id=payload.doctor_id,
            associate_id=payload.associate_id or 1,
            commercial_model_type=payload.commercial_model_type,
            expected_multiple=payload.expected_multiple or 5.0,
            year=payload.year,
            month=payload.month,
            week=payload.week or 1,
            category=category,
            sub_category=payload.sub_category,
            amount=payload.amount,
            expected_sales=payload.expected_sales,
            purpose=payload.purpose,
            bill_url=payload.bill_url,
            submitted_at=datetime.utcnow(),
            is_approved=False,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        return {"id": inv.id, "status": "created"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")


@router.get("/")
def list_investments(
    doctor_id: Optional[int] = None,
    associate_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    is_approved: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment)
    if doctor_id:    q = q.filter(Investment.doctor_id    == doctor_id)
    if associate_id: q = q.filter(Investment.associate_id == associate_id)
    if year:         q = q.filter(Investment.year         == year)
    if month:        q = q.filter(Investment.month        == month)
    if is_approved is not None:
        q = q.filter(Investment.is_approved == is_approved)
    invs = q.order_by(Investment.submitted_at.desc()).all()

    result = []
    for i in invs:
        doc = db.query(Doctor).filter(Doctor.id == i.doctor_id).first()
        cmt = i.commercial_model_type or (doc.commercial_model if doc else None)
        result.append({
            "id":                    i.id,
            "doctor_id":             i.doctor_id,
            "doctor_name":           doc.name if doc else "Unknown",
            "associate_id":          i.associate_id,
            "commercial_model_type": cmt,
            "commercial_model_label": COMMERCIAL_MODEL_LABELS.get(cmt or "", ""),
            "expected_multiple":     i.expected_multiple,
            "year":                  i.year,
            "month":                 i.month,
            "week":                  i.week,
            "category":              _str_cat(i.category) or None,
            "sub_category":          _str_cat(i.sub_category) or None,
            "amount":                i.amount,
            "expected_sales":        i.expected_sales,
            "purpose":               i.purpose,
            "bill_url":              i.bill_url,
            "is_approved":           i.is_approved,
            "approved_by_id":        i.approved_by_id,
            "approved_at":           i.approved_at.isoformat() if i.approved_at else None,
            "submitted_at":          i.submitted_at.isoformat() if i.submitted_at else None,
        })
    return result


@router.patch("/{investment_id}/approve")
def approve_investment(investment_id: int, approved_by_id: int, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == investment_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")
    inv.is_approved = True
    inv.approved_by_id = approved_by_id
    inv.approved_at = datetime.utcnow()
    db.commit()
    return {"status": "approved"}


@router.delete("/{investment_id}")
def delete_investment(investment_id: int, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == investment_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")
    db.delete(inv)
    db.commit()
    return {"status": "deleted"}


@router.get("/spend-analysis")
def spend_analysis(
    year: Optional[int] = None,
    month: Optional[int] = None,
    viewer_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment)
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    if viewer_id:
        visible_ids = get_subtree_ids(viewer_id, db)
        if visible_ids is not None:
            q = q.join(Doctor, Doctor.id == Investment.doctor_id).filter(
                or_(
                    Investment.associate_id.in_(visible_ids),
                    Doctor.manager_id.in_(visible_ids),
                )
            )
    invs = q.all()

    allocation_q = db.query(Investment)
    if viewer_id:
        visible_ids = get_subtree_ids(viewer_id, db)
        if visible_ids is not None:
            allocation_q = allocation_q.join(Doctor, Doctor.id == Investment.doctor_id).filter(
                or_(
                    Investment.associate_id.in_(visible_ids),
                    Doctor.manager_id.in_(visible_ids),
                )
            )
    allocation_invs = allocation_q.all()

    by_cat = {}
    cat_counts = {}
    by_model = {}
    by_doctor = {}
    for i in invs:
        cat = _str_cat(i.category) or "PD"
        model = i.commercial_model_type or "N/A"
        by_cat[cat]   = by_cat.get(cat, 0) + i.amount
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        by_model[model] = by_model.get(model, 0) + i.amount

    for i in allocation_invs:
        cat = _str_cat(i.category) or "PD"
        model = i.commercial_model_type or "N/A"
        if i.doctor_id not in by_doctor:
            by_doctor[i.doctor_id] = {
                "doctor_id": i.doctor_id,
                "PD": 0.0,
                "RD": 0.0,
                "CS": 0.0,
                "total": 0.0,
                "commercial_model": model,
            }
        by_doctor[i.doctor_id][cat] = by_doctor[i.doctor_id].get(cat, 0.0) + (i.amount or 0)
        by_doctor[i.doctor_id]["total"] += i.amount or 0
        if model != "N/A":
            by_doctor[i.doctor_id]["commercial_model"] = model

    doctor_ids = list(by_doctor.keys())
    doc_map = {}
    if doctor_ids:
        doc_map = {d.id: d for d in db.query(Doctor).filter(Doctor.id.in_(doctor_ids)).all()}

    sales_map = {}
    if doctor_ids and year and month:
        sales_rows = db.query(
            SalesEntry.doctor_id,
            func.sum(SalesEntry.value).label("sales"),
        ).filter(
            SalesEntry.doctor_id.in_(doctor_ids),
            SalesEntry.year == year,
            SalesEntry.month == month,
        ).group_by(SalesEntry.doctor_id).all()
        sales_map = {r.doctor_id: float(r.sales or 0) for r in sales_rows}

    def grade_for(sales, invested):
        if invested <= 0:
            return 0.0, "Bronze"
        roi = sales / invested
        if roi > 8:
            grade = "Platinum"
        elif roi >= 5:
            grade = "Gold"
        elif roi >= 3:
            grade = "Silver"
        else:
            grade = "Bronze"
        return round(roi, 2), grade

    per_doctor_category = []
    for doctor_id, row in by_doctor.items():
        doc = doc_map.get(doctor_id)
        sales = sales_map.get(doctor_id, 0.0)
        roi_multiple, roi_grade = grade_for(sales, row["total"])
        per_doctor_category.append({
            "doctor_id": doctor_id,
            "doctor_name": doc.name if doc else f"Doctor {doctor_id}",
            "commercial_model": row["commercial_model"] or (doc.commercial_model if doc else "N/A"),
            "PD": round(row.get("PD", 0.0), 2),
            "RD": round(row.get("RD", 0.0), 2),
            "CS": round(row.get("CS", 0.0), 2),
            "total": round(row["total"], 2),
            "sales": round(sales, 2),
            "roi_multiple": roi_multiple,
            "roi_grade": roi_grade,
        })
    per_doctor_category.sort(key=lambda r: r["total"], reverse=True)

    total = sum(by_cat.values())
    return {
        "total": round(total, 2),
        "by_category": {k: round(v, 2) for k, v in by_cat.items()},
        "category_breakdown": {
            cat: {"total": round(by_cat.get(cat, 0), 2), "count": cat_counts.get(cat, 0)}
            for cat in ["PD", "RD", "CS"]
        },
        "by_model": {k: round(v, 2) for k, v in by_model.items()},
        "per_doctor_category": per_doctor_category,
    }


@router.get("/concentration-risk")
def concentration_risk(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(
        Investment.doctor_id,
        func.sum(Investment.amount).label("total"),
    )
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    rows = q.group_by(Investment.doctor_id).all()
    if not rows:
        return {"risk": "low", "top_doctor_pct": 0, "top3_pct": 0, "doctors": []}

    grand = sum(r.total for r in rows)
    sorted_rows = sorted(rows, key=lambda r: r.total, reverse=True)
    top1_pct  = round((sorted_rows[0].total / grand) * 100, 1) if grand else 0
    top3_total = sum(r.total for r in sorted_rows[:3])
    top3_pct  = round((top3_total / grand) * 100, 1) if grand else 0

    risk = "low"
    if top1_pct > 40:
        risk = "high"
    elif top1_pct > 25:
        risk = "medium"

    doc_ids = [r.doctor_id for r in sorted_rows[:10]]
    doc_map = {}
    for d in db.query(Doctor).filter(Doctor.id.in_(doc_ids)).all():
        doc_map[d.id] = d.name

    return {
        "risk": risk,
        "top_doctor_pct": top1_pct,
        "top3_pct": top3_pct,
        "grand_total": round(grand, 2),
        "doctors": [{"doctor_id": r.doctor_id, "doctor_name": doc_map.get(r.doctor_id, "?"),
                     "amount": round(r.total, 2), "pct": round((r.total / grand) * 100, 1)}
                    for r in sorted_rows[:10]],
    }
