# backend/routers/roi.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from pydantic import BaseModel

from ..database import get_db
from ..models.models import Doctor, SalesEntry, Investment, ROIGrade, CommercialModel, Product
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
    """Return compact Indian number string."""
    if val >= 100000:
        return f"₹{val/100000:.1f}L"
    elif val >= 1000:
        return f"₹{val/1000:.1f}K"
    return f"₹{val:.0f}"


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

    expected_sales = total_invested * (doctor.expected_multiple or 5.0)
    roi_multiple, grade = compute_roi_grade(actual, total_invested)
    ca_percent = compute_ca_percent(actual, expected_sales)

    doctor.roi_grade = grade
    db.commit()

    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "hospital": doctor.hospital,
        "city": doctor.city,
        "state_code": doctor.state_code,
        "client_code": doctor.client_code,
        "category": doctor.category,
        "commercial_model": doctor.commercial_model.value if doctor.commercial_model else None,
        "commercial_label": COMMERCIAL_LABELS.get(doctor.commercial_model.value if doctor.commercial_model else "", ""),
        "expected_multiple": doctor.expected_multiple or 5.0,
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
    """Full drill-down: basic ROI + investment breakdown by category + product-wise sales + monthly trend."""
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # ── Basic ROI ────────────────────────────────
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

    expected_sales = total_invested * (doctor.expected_multiple or 5.0)
    roi_multiple, grade = compute_roi_grade(actual, total_invested)
    ca_percent = compute_ca_percent(actual, expected_sales)

    doctor.roi_grade = grade
    db.commit()

    # ── Investment breakdown by commercial model (U1-R1) ────────
    inv_rows = db.query(
        Investment.commercial_model_type,
        Investment.category,
        Investment.sub_category,
        func.sum(Investment.amount).label("total"),
        func.count(Investment.id).label("count"),
    ).filter(Investment.doctor_id == doctor_id)\
     .group_by(Investment.commercial_model_type, Investment.category, Investment.sub_category).all()

    inv_by_cat = {}      # legacy PD/RD/CS grouping (kept for backward compat)
    inv_by_model = {}    # new U1-R1 grouping
    for r in inv_rows:
        # legacy category grouping
        cat = r.category.value if r.category else "PD"
        if cat not in inv_by_cat:
            inv_by_cat[cat] = {"total": 0, "items": []}
        inv_by_cat[cat]["total"] += r.total
        inv_by_cat[cat]["items"].append({
            "sub_category": r.sub_category.value if r.sub_category else "Other",
            "amount": round(r.total, 2),
            "count": r.count,
        })
        # new commercial model grouping
        model = r.commercial_model_type or "—"
        if model not in inv_by_model:
            inv_by_model[model] = {
                "total": 0,
                "label": COMMERCIAL_LABELS.get(model, model),
                "items": [],
            }
        inv_by_model[model]["total"] += r.total
        inv_by_model[model]["items"].append({
            "sub_category": r.sub_category.value if r.sub_category else "Other",
            "category": cat,
            "amount": round(r.total, 2),
            "count": r.count,
        })

    # ── Product-wise sales (this month) ─────────
    prod_rows = db.query(
        SalesEntry.product_id,
        func.sum(SalesEntry.value).label("total_value"),
        func.sum(SalesEntry.quantity).label("total_qty"),
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

    products_sales = []
    for r in prod_rows:
        products_sales.append({
            "product_id": r.product_id,
            "product_name": prod_name_map.get(r.product_id, f"Product {r.product_id}"),
            "total_sales": round(r.total_value or 0, 2),
            "total_qty": round(r.total_qty or 0, 2),
        })
    products_sales.sort(key=lambda x: x["total_sales"], reverse=True)

    # ── Monthly trend (last 6 months) ──────────
    trend_rows = db.query(
        SalesEntry.year,
        SalesEntry.month,
        func.sum(SalesEntry.value).label("total"),
    ).filter(SalesEntry.doctor_id == doctor_id)\
     .group_by(SalesEntry.year, SalesEntry.month)\
     .order_by(SalesEntry.year.desc(), SalesEntry.month.desc())\
     .limit(6).all()

    trend = [
        {"year": r.year, "month": r.month, "label": MONTHS[r.month], "sales": round(r.total or 0, 2)}
        for r in reversed(trend_rows)
    ]

    # ── All investments (list) ──────────────────
    inv_list = db.query(Investment).filter(Investment.doctor_id == doctor_id)\
                 .order_by(Investment.submitted_at.desc()).all()

    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "hospital": doctor.hospital,
        "city": doctor.city,
        "state_code": doctor.state_code,
        "client_code": doctor.client_code,
        "category": doctor.category,
        "commercial_model": doctor.commercial_model.value if doctor.commercial_model else None,
        "commercial_label": COMMERCIAL_LABELS.get(doctor.commercial_model.value if doctor.commercial_model else "", ""),
        "expected_multiple": doctor.expected_multiple or 5.0,
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
        "investments": [
            {
                "id": i.id,
                "commercial_model_type": i.commercial_model_type,
                "commercial_model_label": COMMERCIAL_LABELS.get(i.commercial_model_type or "", ""),
                "category": i.category.value if i.category else None,
                "sub_category": i.sub_category.value if i.sub_category else None,
                "amount": i.amount,
                "purpose": i.purpose,
                "is_approved": i.is_approved,
                "submitted_at": str(i.submitted_at)[:10],
                "year": i.year, "month": i.month,
            }
            for i in inv_list
        ],
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
        try:
            doctor.commercial_model = CommercialModel(payload.commercial_model)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid commercial model: {payload.commercial_model}")

    if payload.expected_multiple is not None:
        doctor.expected_multiple = payload.expected_multiple

    db.commit()
    return {
        "doctor_id": doctor_id,
        "commercial_model": doctor.commercial_model.value if doctor.commercial_model else None,
        "expected_multiple": doctor.expected_multiple,
    }


@router.get("/all-doctors")
def get_all_doctors_roi(
    year: int,
    month: int,
    start_date: Optional[str] = None,   # 'YYYY-MM-DD' — overrides year/month when provided
    end_date:   Optional[str] = None,   # 'YYYY-MM-DD'
    viewer_id: Optional[int] = None,
    manager_id: Optional[int] = None,
    commercial_model: Optional[str] = None,
    grade: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Doctor).filter(Doctor.is_active != False)

    # Role-scoped filtering
    if viewer_id and not manager_id:
        subtree = get_subtree_ids(viewer_id, db)
        if subtree is not None:          # None = admin/md, sees all
            q = q.filter(Doctor.manager_id.in_(subtree))

    if manager_id:
        q = q.filter(Doctor.manager_id == manager_id)
    if commercial_model:
        try:
            q = q.filter(Doctor.commercial_model == CommercialModel(commercial_model))
        except ValueError:
            pass
    doctors = q.all()
    if not doctors:
        return []

    doctor_ids = [d.id for d in doctors]
    use_date_range = bool(start_date and end_date)

    # ── Bulk fetch sales (1 query instead of N) ────────────────────────────────
    sales_q = db.query(
        SalesEntry.doctor_id,
        func.sum(SalesEntry.value).label("total"),
    ).filter(SalesEntry.doctor_id.in_(doctor_ids))
    if use_date_range:
        sales_q = sales_q.filter(SalesEntry.sale_date >= start_date, SalesEntry.sale_date <= end_date)
    else:
        sales_q = sales_q.filter(SalesEntry.year == year, SalesEntry.month == month)
    sales_map = {r.doctor_id: float(r.total or 0) for r in sales_q.group_by(SalesEntry.doctor_id).all()}

    # ── Bulk fetch investments (1 query instead of N) ──────────────────────────
    inv_rows = db.query(
        Investment.doctor_id,
        func.sum(Investment.amount).label("total"),
    ).filter(Investment.doctor_id.in_(doctor_ids))\
     .group_by(Investment.doctor_id).all()
    inv_map = {r.doctor_id: float(r.total or 0) for r in inv_rows}

    # ── Bulk fetch manager names (1 query) ─────────────────────────────────────
    from ..models.models import User as UserModel
    mgr_ids = list({d.manager_id for d in doctors if d.manager_id})
    if mgr_ids:
        mgr_rows = db.query(UserModel.id, UserModel.name).filter(UserModel.id.in_(mgr_ids)).all()
        mgr_map = {r.id: r.name for r in mgr_rows}
    else:
        mgr_map = {}

    # ── Build result in Python (no more per-doctor queries) ───────────────────
    search_lower = search.lower() if search else None
    result = []
    for doc in doctors:
        if search_lower and search_lower not in (doc.name or "").lower() \
                        and search_lower not in (doc.hospital or "").lower() \
                        and search_lower not in (doc.city or "").lower():
            continue

        actual        = sales_map.get(doc.id, 0.0)
        total_invested = inv_map.get(doc.id, 0.0)
        expected      = total_invested * (doc.expected_multiple or 5.0)
        roi_multiple, roi_grade = compute_roi_grade(actual, total_invested)
        ca_pct        = compute_ca_percent(actual, expected)

        if grade and roi_grade.value.lower() != grade.lower():
            continue

        result.append({
            "doctor_id":       doc.id,
            "doctor_name":     doc.name,
            "specialty":       doc.specialty,
            "hospital":        doc.hospital,
            "city":            doc.city,
            "state_code":      doc.state_code,
            "client_code":     doc.client_code,
            "category":        doc.category,
            "commercial_model": doc.commercial_model.value if doc.commercial_model else None,
            "commercial_label": COMMERCIAL_LABELS.get(doc.commercial_model.value if doc.commercial_model else "", ""),
            "expected_multiple": doc.expected_multiple or 5.0,
            "actual_sales":    round(actual, 2),
            "total_invested":  round(total_invested, 2),
            "expected_sales":  round(expected, 2),
            "roi_multiple":    roi_multiple,
            "roi_grade":       roi_grade.value,
            "ca_percent":      ca_pct,
            "ca_status":       "green" if ca_pct >= 100 else "yellow" if ca_pct >= 80 else "red",
            "is_at_risk":      roi_grade == ROIGrade.bronze or ca_pct < 60,
            "manager_id":      doc.manager_id,
            "manager_name":    mgr_map.get(doc.manager_id),
        })

    return sorted(result, key=lambda x: x["roi_multiple"], reverse=True)


@router.get("/grade-summary")
def get_grade_summary(year: int, month: int, viewer_id: Optional[int] = None, db: Session = Depends(get_db)):
    all_doctors = get_all_doctors_roi(year, month, viewer_id=viewer_id, db=db)
    summary = {"Platinum": 0, "Gold": 0, "Silver": 0, "Bronze": 0}
    for d in all_doctors:
        if d["roi_grade"] in summary:
            summary[d["roi_grade"]] += 1
    total_sales = sum(d["actual_sales"] for d in all_doctors)
    total_invested = sum(d["total_invested"] for d in all_doctors)
    overall_roi, overall_grade = compute_roi_grade(total_sales, total_invested)
    total_expected = sum(d["expected_sales"] for d in all_doctors)
    overall_ca = compute_ca_percent(total_sales, total_expected)
    return {
        "grade_counts": summary,
        "total_doctors": len(all_doctors),
        "total_sales": round(total_sales, 2),
        "total_invested": round(total_invested, 2),
        "total_expected": round(total_expected, 2),
        "overall_roi_multiple": overall_roi,
        "overall_grade": overall_grade.value,
        "overall_ca_percent": overall_ca,
        "overall_ca_status": "green" if overall_ca >= 100 else "yellow" if overall_ca >= 80 else "red",
    }


@router.get("/at-risk")
def get_at_risk_doctors(year: int, month: int, db: Session = Depends(get_db)):
    return [d for d in get_all_doctors_roi(year, month, db=db) if d["is_at_risk"]]


# ── PD / RD / CS category mapping ─────────────────────────────────────────────
CATEGORY_TO_PD_RD_CS = {
    "Conference Registration": "PD",
    "Travel Support":          "PD",
    "Hotel / Stay":            "PD",
    "CME Sponsorship":         "PD",
    "Speaker Program":         "PD",
    "Workshop Sponsorship":    "PD",
    "Advisory Board":          "RD",
    "Round Table":             "RD",
    "Doctor Meeting":          "RD",
    "Scientific Discussion":   "RD",
    "Commercial Support":      "CS",
    "Sample":                  "CS",
    "Gift":                    "CS",
}

SUB_ACTIVITY_LABELS = [
    "Conference Registration", "Travel Support", "Hotel / Stay",
    "CME Sponsorship", "Speaker Program",
    "Advisory Board", "Round Table", "Doctor Meeting",
    "Commercial Support", "Sample", "Gift",
]


@router.get("/spend-analysis")
def get_spend_analysis(
    year: int, month: int,
    viewer_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Returns:
      - category_breakdown: { PD, RD, CS } totals + counts
      - sub_activity_breakdown: per sub-activity totals
      - per_doctor_category: list of { doctor_id, name, PD, RD, CS, total, sales, roi_multiple, roi_grade }
    """
    q = db.query(Investment).filter(Investment.year == year, Investment.month == month)
    invs = q.all()

    # ── Category totals
    cat_totals = {"PD": 0.0, "RD": 0.0, "CS": 0.0}
    cat_counts = {"PD": 0,   "RD": 0,   "CS": 0}
    sub_totals = {}

    for i in invs:
        # Resolve category
        if i.category:
            cat = i.category.value
        elif i.sub_category:
            cat = CATEGORY_TO_PD_RD_CS.get(i.sub_category.value, "CS")
        else:
            cat = "CS"

        cat_totals[cat] = cat_totals.get(cat, 0.0) + (i.amount or 0)
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

        if i.sub_category:
            label = i.sub_category.value
            sub_totals[label] = sub_totals.get(label, 0.0) + (i.amount or 0)

    # ── Per-doctor breakdown
    doctor_ids = list({i.doctor_id for i in invs})
    doc_map = {}
    for inv in invs:
        did = inv.doctor_id
        if did not in doc_map:
            doc_map[did] = {"PD": 0.0, "RD": 0.0, "CS": 0.0}
        if inv.category:
            cat = inv.category.value
        elif inv.sub_category:
            cat = CATEGORY_TO_PD_RD_CS.get(inv.sub_category.value, "CS")
        else:
            cat = "CS"
        doc_map[did][cat] += inv.amount or 0

    # Bulk fetch doctors + sales for spend analysis
    spend_doc_ids = list(doc_map.keys())
    spend_docs = {d.id: d for d in db.query(Doctor).filter(Doctor.id.in_(spend_doc_ids)).all()}
    spend_sales_rows = db.query(
        SalesEntry.doctor_id,
        func.sum(SalesEntry.value).label("total"),
    ).filter(
        SalesEntry.doctor_id.in_(spend_doc_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).group_by(SalesEntry.doctor_id).all()
    spend_sales_map = {r.doctor_id: float(r.total or 0) for r in spend_sales_rows}

    per_doctor = []
    for did, cats in doc_map.items():
        doc = spend_docs.get(did)
        actual = spend_sales_map.get(did, 0.0)
        total_inv = cats["PD"] + cats["RD"] + cats["CS"]
        roi_multiple, grade = compute_roi_grade(actual, total_inv)
        per_doctor.append({
            "doctor_id":   did,
            "doctor_name": doc.name if doc else f"Doctor {did}",
            "commercial_model": doc.commercial_model.value if doc and doc.commercial_model else None,
            "PD":          round(cats["PD"], 2),
            "RD":          round(cats["RD"], 2),
            "CS":          round(cats["CS"], 2),
            "total":       round(total_inv, 2),
            "sales":       round(actual, 2),
            "roi_multiple": roi_multiple,
            "roi_grade":   grade.value,
        })

    per_doctor.sort(key=lambda x: x["total"], reverse=True)

    return {
        "category_breakdown": {
            k: {"total": round(cat_totals[k], 2), "count": cat_counts[k]}
            for k in ("PD", "RD", "CS")
        },
        "sub_activity_breakdown": [
            {"activity": act, "total": round(sub_totals.get(act, 0), 2)}
            for act in SUB_ACTIVITY_LABELS
        ],
        "per_doctor_category": per_doctor,
    }


@router.get("/concentration-risk")
def get_concentration_risk(
    year: int, month: int,
    viewer_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Returns total business, top-N doctor breakdown, and Herfindahl concentration index.
    """
    rows = db.query(
        SalesEntry.doctor_id,
        func.sum(SalesEntry.value).label("sales"),
    ).filter(SalesEntry.year == year, SalesEntry.month == month)\
     .group_by(SalesEntry.doctor_id)\
     .order_by(func.sum(SalesEntry.value).desc()).all()

    total = sum(r.sales or 0 for r in rows)
    if total == 0:
        return {"total_sales": 0, "doctor_count": 0, "top_doctors": [], "top5_pct": 0, "top10_pct": 0}

    doctors = []
    cumulative = 0.0
    for r in rows:
        doc = db.query(Doctor).filter(Doctor.id == r.doctor_id).first()
        pct = round((r.sales / total) * 100, 1)
        cumulative += pct
        doctors.append({
            "doctor_id":   r.doctor_id,
            "doctor_name": doc.name if doc else f"Doctor {r.doctor_id}",
            "commercial_model": doc.commercial_model.value if doc and doc.commercial_model else None,
            "roi_grade":   doc.roi_grade.value if doc and doc.roi_grade else "Bronze",
            "sales":       round(r.sales, 2),
            "pct_of_total": pct,
            "cumulative_pct": round(cumulative, 1),
        })

    top5_pct  = round(sum(d["pct_of_total"] for d in doctors[:5]),  1)
    top10_pct = round(sum(d["pct_of_total"] for d in doctors[:10]), 1)

    return {
        "total_sales":   round(total, 2),
        "doctor_count":  len(doctors),
        "top5_pct":      top5_pct,
        "top10_pct":     top10_pct,
        "top_doctors":   doctors[:20],   # top 20 for the table
    }


@router.get("/products-summary")
def get_products_summary(year: int, month: int, db: Session = Depends(get_db)):
    rows = db.query(
        SalesEntry.product_id,
        func.sum(SalesEntry.value).label("total_value"),
        func.sum(SalesEntry.quantity).label("total_qty"),
        func.count(SalesEntry.doctor_id.distinct()).label("doctor_count"),
    ).filter(SalesEntry.year == year, SalesEntry.month == month)\
     .group_by(SalesEntry.product_id).all()

    result = []
    for r in rows:
        prod = db.query(Product).filter(Product.id == r.product_id).first()
        result.append({
            "product_id": r.product_id,
            "product_name": prod.name if prod else f"Product {r.product_id}",
            "total_sales": round(r.total_value or 0, 2),
            "total_qty": round(r.total_qty or 0, 2),
            "doctor_count": r.doctor_count,
        })
    return sorted(result, key=lambda x: x["total_sales"], reverse=True)
