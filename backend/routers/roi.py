# backend/routers/roi.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional
from pydantic import BaseModel

from ..database import get_db
from ..models.models import Doctor, SalesEntry, Investment, ROIGrade, Product
from ..utils.hierarchy import get_subtree_ids

router = APIRouter(prefix="/roi", tags=["ROI"])

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

COMMERCIAL_LABELS = {
    "U1": "Upfront Investment Account",
    "U2": "Strategic Upfront Account",
    "P1": "Performance-Linked Account",
    "P2": "Growth Incentive Account",
    "N1": "Natural Prescriber",
    "D1": "Development Account",
    "R1": "At-Risk Account",
}

COMMERCIAL_DESC = {
    "U1": "Investment made first, expected business multiple later",
    "U2": "High-value account with long-term growth potential",
    "P1": "Support linked to actual sales generated",
    "P2": "Support increases as business increases",
    "N1": "Prescribes without significant investment",
    "D1": "New doctor under evaluation",
    "R1": "Declining business or high competitor threat",
}


def apply_viewer_scope(q, viewer_id: Optional[int], db: Session, year: Optional[int] = None, month: Optional[int] = None):
    subtree = get_subtree_ids(viewer_id, db)
    if subtree is None:
        return q

    from ..models.models import RepDoctorMapping
    visible_ids = {r.doctor_id for r in db.query(RepDoctorMapping.doctor_id).filter(
        (RepDoctorMapping.associate_id.in_(subtree)) |
        (RepDoctorMapping.rep_id.in_(subtree)),
        RepDoctorMapping.is_active == True,
    ).all()}

    if year and month:
        visible_ids.update(r.doctor_id for r in db.query(SalesEntry.doctor_id).filter(
            SalesEntry.associate_id.in_(subtree),
            SalesEntry.year == year,
            SalesEntry.month == month,
        ).distinct().all())

    conditions = [Doctor.manager_id.in_(subtree)]
    if visible_ids:
        conditions.append(Doctor.id.in_(visible_ids))
    return q.filter(or_(*conditions))


class CommercialUpdateRequest(BaseModel):
    commercial_model: Optional[str] = None
    expected_multiple: Optional[float] = None


def compute_roi_grade(actual: float, invested: float):
    if invested == 0:
        return 0.0, ROIGrade.bronze
    multiple = actual / invested
    if multiple > 8:
        grade = ROIGrade.platinum
    elif multiple >= 5:
        grade = ROIGrade.gold
    elif multiple >= 3:
        grade = ROIGrade.silver
    else:
        grade = ROIGrade.bronze
    return round(multiple, 2), grade


def compute_ca_percent(actual: float, expected: float) -> float:
    if expected == 0:
        return 0.0
    return round((actual / expected) * 100, 1)


def fmt_inr(val: float) -> str:
    if val >= 100000:
        return f"Rs.{val/100000:.1f}L"
    elif val >= 1000:
        return f"Rs.{val/1000:.1f}K"
    return f"Rs.{val:.0f}"


def _expected_mult(doc) -> float:
    """Return expected_multiple as float; column is String(10) in DB."""
    try:
        return float(doc.expected_multiple or 5.0)
    except (TypeError, ValueError):
        return 5.0


def _str_val(v) -> str:
    """Return plain string from either a str or an enum."""
    if v is None:
        return ""
    return v.value if hasattr(v, "value") else str(v)


@router.get("/doctor/{doctor_id}")
def get_doctor_roi(doctor_id: int, year: int, month: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    actual = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.doctor_id == doctor_id,
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).scalar() or 0.0

    total_invested = db.query(func.sum(Investment.amount)).filter(
        Investment.doctor_id == doctor_id,
    ).scalar() or 0.0

    em = _expected_mult(doctor)
    expected_sales = total_invested * em
    roi_multiple, grade = compute_roi_grade(actual, total_invested)
    ca_percent = compute_ca_percent(actual, expected_sales)

    doctor.roi_grade = grade.value
    db.commit()

    cm = _str_val(doctor.commercial_model)
    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "hospital": doctor.hospital,
        "city": doctor.city,
        "state_code": doctor.state_code,
        "client_code": doctor.client_code,
        "category": doctor.category,
        "commercial_model": cm or None,
        "commercial_label": COMMERCIAL_LABELS.get(cm, ""),
        "expected_multiple": em,
        "year": year, "month": month,
        "actual_sales": round(actual, 2),
        "total_invested": round(total_invested, 2),
        "expected_sales": round(expected_sales, 2),
        "roi_multiple": roi_multiple,
        "roi_grade": grade.value,
        "ca_percent": ca_percent,
        "ca_status": "green" if ca_percent >= 100 else "yellow" if ca_percent >= 80 else "red",
    }


@router.get("/doctor/{doctor_id}/full")
def get_doctor_roi_full(doctor_id: int, year: int, month: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    actual = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.doctor_id == doctor_id,
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).scalar() or 0.0

    all_time_sales = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.doctor_id == doctor_id,
    ).scalar() or 0.0

    total_invested = db.query(func.sum(Investment.amount)).filter(
        Investment.doctor_id == doctor_id,
    ).scalar() or 0.0

    em = _expected_mult(doctor)
    expected_sales = total_invested * em
    roi_multiple, grade = compute_roi_grade(actual, total_invested)
    ca_percent = compute_ca_percent(actual, expected_sales)

    doctor.roi_grade = grade.value
    db.commit()

    inv_rows = db.query(
        Investment.commercial_model_type,
        Investment.category,
        Investment.sub_category,
        func.sum(Investment.amount).label("total"),
        func.count(Investment.id).label("count"),
    ).filter(Investment.doctor_id == doctor_id)\
     .group_by(Investment.commercial_model_type, Investment.category, Investment.sub_category).all()

    inv_by_cat = {}
    inv_by_model = {}
    for r in inv_rows:
        cat = _str_val(r.category) or "PD"
        sub = _str_val(r.sub_category) or "Other"
        if cat not in inv_by_cat:
            inv_by_cat[cat] = {"total": 0, "items": []}
        inv_by_cat[cat]["total"] += r.total
        inv_by_cat[cat]["items"].append({"sub_category": sub, "amount": round(r.total, 2), "count": r.count})
        model = _str_val(r.commercial_model_type) or "N/A"
        if model not in inv_by_model:
            inv_by_model[model] = {"total": 0, "label": COMMERCIAL_LABELS.get(model, model), "items": []}
        inv_by_model[model]["total"] += r.total
        inv_by_model[model]["items"].append({"sub_category": sub, "category": cat, "amount": round(r.total, 2), "count": r.count})

    prod_rows = db.query(
        SalesEntry.product_id,
        func.sum(SalesEntry.value).label("total_value"),
        func.sum(SalesEntry.qty).label("total_qty"),
    ).filter(
        SalesEntry.doctor_id == doctor_id,
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).group_by(SalesEntry.product_id).all()

    prod_ids = [r.product_id for r in prod_rows]
    prod_name_map = {}
    if prod_ids:
        for p in db.query(Product).filter(Product.id.in_(prod_ids)).all():
            prod_name_map[p.id] = p.name

    products_sales = sorted([{
        "product_id": r.product_id,
        "product_name": prod_name_map.get(r.product_id, f"Product {r.product_id}"),
        "total_sales": round(r.total_value or 0, 2),
        "total_qty": round(r.total_qty or 0, 2),
    } for r in prod_rows], key=lambda x: x["total_sales"], reverse=True)

    trend_rows = db.query(
        SalesEntry.year, SalesEntry.month,
        func.sum(SalesEntry.value).label("total"),
    ).filter(SalesEntry.doctor_id == doctor_id)\
     .group_by(SalesEntry.year, SalesEntry.month)\
     .order_by(SalesEntry.year.desc(), SalesEntry.month.desc()).limit(6).all()

    trend = [{"year": r.year, "month": r.month, "label": MONTHS[r.month], "sales": round(r.total or 0, 2)}
             for r in reversed(trend_rows)]

    inv_list = db.query(Investment).filter(Investment.doctor_id == doctor_id)\
                 .order_by(Investment.submitted_at.desc()).all()

    cm = _str_val(doctor.commercial_model)
    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "hospital": doctor.hospital,
        "city": doctor.city,
        "state_code": doctor.state_code,
        "client_code": doctor.client_code,
        "category": doctor.category,
        "commercial_model": cm or None,
        "commercial_label": COMMERCIAL_LABELS.get(cm, ""),
        "expected_multiple": em,
        "year": year, "month": month,
        "actual_sales": round(actual, 2),
        "all_time_sales": round(all_time_sales, 2),
        "total_invested": round(total_invested, 2),
        "expected_sales": round(expected_sales, 2),
        "roi_multiple": roi_multiple,
        "roi_grade": grade.value,
        "ca_percent": ca_percent,
        "ca_status": "green" if ca_percent >= 100 else "yellow" if ca_percent >= 80 else "red",
        "investment_by_category": inv_by_cat,
        "investment_by_model": inv_by_model,
        "products_sales": products_sales,
        "monthly_trend": trend,
        "investments": [{
            "id": i.id,
            "commercial_model_type": _str_val(i.commercial_model_type),
            "commercial_model_label": COMMERCIAL_LABELS.get(_str_val(i.commercial_model_type), ""),
            "category": _str_val(i.category),
            "sub_category": _str_val(i.sub_category),
            "amount": i.amount,
            "purpose": i.purpose,
            "is_approved": i.is_approved,
            "submitted_at": str(i.submitted_at)[:10] if i.submitted_at else "",
            "year": i.year, "month": i.month,
        } for i in inv_list],
    }


@router.patch("/doctor/{doctor_id}/commercial")
def update_commercial_model(
    doctor_id: int,
    payload: CommercialUpdateRequest,
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    if payload.commercial_model is not None:
        doctor.commercial_model = payload.commercial_model

    if payload.expected_multiple is not None:
        doctor.expected_multiple = str(payload.expected_multiple)

    db.commit()
    cm = _str_val(doctor.commercial_model)
    return {
        "doctor_id": doctor_id,
        "commercial_model": cm or None,
        "expected_multiple": _expected_mult(doctor),
    }


@router.get("/all-doctors")
def get_all_doctors_roi(
    year: int,
    month: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    viewer_id: Optional[int] = None,
    manager_id: Optional[int] = None,
    commercial_model: Optional[str] = None,
    grade: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Doctor).filter(Doctor.is_active != False)

    # Derive year/month: if caller sent year=0, extract from start_date
    eff_year, eff_month = year, month
    if (eff_year == 0 or eff_month == 0) and start_date:
        try:
            from datetime import datetime as _dt
            _d = _dt.strptime(start_date, "%Y-%m-%d")
            eff_year, eff_month = _d.year, _d.month
        except Exception:
            pass

    if viewer_id and not manager_id:
        q = apply_viewer_scope(q, viewer_id, db, eff_year, eff_month)

    if manager_id:
        q = q.filter(Doctor.manager_id == manager_id)
    if commercial_model:
        q = q.filter(Doctor.commercial_model == commercial_model)
    doctors = q.all()
    if not doctors:
        return []

    doctor_ids = [d.id for d in doctors]

    sales_q = db.query(
        SalesEntry.doctor_id,
        func.sum(SalesEntry.value).label("total"),
    ).filter(SalesEntry.doctor_id.in_(doctor_ids))
    if eff_year and eff_month:
        sales_q = sales_q.filter(SalesEntry.year == eff_year, SalesEntry.month == eff_month)
    sales_map = {r.doctor_id: float(r.total or 0) for r in sales_q.group_by(SalesEntry.doctor_id).all()}

    inv_rows = db.query(
        Investment.doctor_id,
        func.sum(Investment.amount).label("total"),
    ).filter(Investment.doctor_id.in_(doctor_ids)).group_by(Investment.doctor_id).all()
    inv_map = {r.doctor_id: float(r.total or 0) for r in inv_rows}

    from ..models.models import User as UserModel
    mgr_ids = list({d.manager_id for d in doctors if d.manager_id})
    mgr_map = {}
    if mgr_ids:
        for r in db.query(UserModel.id, UserModel.name).filter(UserModel.id.in_(mgr_ids)).all():
            mgr_map[r.id] = r.name

    search_lower = search.lower() if search else None
    result = []
    for doc in doctors:
        if search_lower and search_lower not in (doc.name or "").lower() \
                        and search_lower not in (doc.hospital or "").lower() \
                        and search_lower not in (doc.city or "").lower():
            continue

        actual = sales_map.get(doc.id, 0.0)
        total_invested = inv_map.get(doc.id, 0.0)
        em = _expected_mult(doc)
        expected = total_invested * em
        roi_multiple, roi_grade = compute_roi_grade(actual, total_invested)
        ca_pct = compute_ca_percent(actual, expected)

        if grade and roi_grade.value.lower() != grade.lower():
            continue

        cm = _str_val(doc.commercial_model)
        result.append({
            "doctor_id": doc.id,
            "doctor_name": doc.name,
            "specialty": doc.specialty,
            "hospital": doc.hospital,
            "city": doc.city,
            "state_code": doc.state_code,
            "client_code": doc.client_code,
            "category": doc.category,
            "commercial_model": cm or None,
            "commercial_label": COMMERCIAL_LABELS.get(cm, ""),
            "expected_multiple": em,
            "actual_sales": round(actual, 2),
            "total_invested": round(total_invested, 2),
            "expected_sales": round(expected, 2),
            "roi_multiple": roi_multiple,
            "roi_grade": roi_grade.value,
            "ca_percent": ca_pct,
            "ca_status": "green" if ca_pct >= 100 else "yellow" if ca_pct >= 80 else "red",
            "manager_id": doc.manager_id,
            "manager_name": mgr_map.get(doc.manager_id, ""),
            "is_at_risk": ca_pct < 60 or roi_grade.value == "Bronze",
        })

    return result


@router.get("/grade-summary")
def get_grade_summary(year: int, month: int, viewer_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Doctor).filter(Doctor.is_active != False)
    if viewer_id:
        q = apply_viewer_scope(q, viewer_id, db, year, month)
    doctors = q.all()
    if not doctors:
        return []

    doctor_ids = [d.id for d in doctors]
    sales_map = {r.doctor_id: float(r.total or 0) for r in db.query(
        SalesEntry.doctor_id, func.sum(SalesEntry.value).label("total")
    ).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).group_by(SalesEntry.doctor_id).all()}

    inv_map = {r.doctor_id: float(r.total or 0) for r in db.query(
        Investment.doctor_id, func.sum(Investment.amount).label("total")
    ).filter(Investment.doctor_id.in_(doctor_ids)).group_by(Investment.doctor_id).all()}

    summary = {}
    for doc in doctors:
        actual = sales_map.get(doc.id, 0.0)
        invested = inv_map.get(doc.id, 0.0)
        _, grade = compute_roi_grade(actual, invested)
        g = grade.value
        if g not in summary:
            summary[g] = {"grade": g, "count": 0, "total_sales": 0.0, "total_invested": 0.0}
        summary[g]["count"] += 1
        summary[g]["total_sales"] += actual
        summary[g]["total_invested"] += invested

    return list(summary.values())


@router.get("/client-stats")
def get_client_stats(year: int, month: int, viewer_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Returns total clients, prescribed (had sales this month), not prescribed."""
    q = db.query(Doctor).filter(Doctor.is_active != False)
    if viewer_id:
        q = apply_viewer_scope(q, viewer_id, db, year, month)
    doctor_ids = [d.id for d in q.all()]
    total = len(doctor_ids)

    prescribed_ids = {r.doctor_id for r in db.query(SalesEntry.doctor_id).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).distinct().all()}

    prescribed     = len(prescribed_ids)
    not_prescribed = total - prescribed

    return {
        "total":          total,
        "prescribed":     prescribed,
        "not_prescribed": not_prescribed,
    }


@router.get("/at-risk")
def get_at_risk(year: int, month: int, viewer_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Doctor).filter(Doctor.is_active != False)
    if viewer_id:
        q = apply_viewer_scope(q, viewer_id, db, year, month)
    doctors = q.all()
    if not doctors:
        return []

    doctor_ids = [d.id for d in doctors]
    sales_map = {r.doctor_id: float(r.total or 0) for r in db.query(
        SalesEntry.doctor_id, func.sum(SalesEntry.value).label("total")
    ).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).group_by(SalesEntry.doctor_id).all()}

    inv_map = {r.doctor_id: float(r.total or 0) for r in db.query(
        Investment.doctor_id, func.sum(Investment.amount).label("total")
    ).filter(Investment.doctor_id.in_(doctor_ids)).group_by(Investment.doctor_id).all()}

    result = []
    for doc in doctors:
        actual = sales_map.get(doc.id, 0.0)
        invested = inv_map.get(doc.id, 0.0)
        em = _expected_mult(doc)
        expected = invested * em
        roi_multiple, grade = compute_roi_grade(actual, invested)
        ca_pct = compute_ca_percent(actual, expected)
        if ca_pct < 60 or grade == ROIGrade.bronze:
            result.append({
                "doctor_id": doc.id,
                "doctor_name": doc.name,
                "city": doc.city,
                "roi_grade": grade.value,
                "roi_multiple": roi_multiple,
                "ca_percent": ca_pct,
                "actual_sales": round(actual, 2),
                "total_invested": round(invested, 2),
            })

    return sorted(result, key=lambda x: x["ca_percent"])
