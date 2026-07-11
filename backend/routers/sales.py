# backend/routers/sales.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, date as date_type, timedelta
import re

from ..database import get_db
from ..models.models import SalesEntry, Doctor, Product
from ..utils.hierarchy import get_subtree_ids

router = APIRouter(prefix="/sales", tags=["Sales"])


def _week_bounds(week: int):
    starts = {1: 1, 2: 8, 3: 15, 4: 22}
    start = starts.get(week, 1)
    end = 31 if week == 4 else start + 6
    return start, end


class DaySalesItem(BaseModel):
    product_id: int
    quantity: float = 0
    value: float = 0


class SalesEntryRequest(BaseModel):
    doctor_id:    int
    associate_id: int
    sale_date:    str              # 'YYYY-MM-DD' — actual date of visit
    entries:      List[DaySalesItem]
    remarks:      Optional[str] = None


@router.post("/submit")
def submit_sales(payload: SalesEntryRequest, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == payload.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Parse the date to derive year / month / day (stored as 'week' for compat)
    try:
        d = datetime.strptime(payload.sale_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="sale_date must be YYYY-MM-DD")

    year  = d.year
    month = d.month
    day   = d.day   # stored in the 'week' column (1-31)

    saved = 0
    for item in payload.entries:
        if item.value == 0 and item.quantity == 0:
            continue
        existing = db.query(SalesEntry).filter(
            SalesEntry.doctor_id    == payload.doctor_id,
            SalesEntry.associate_id == payload.associate_id,
            SalesEntry.product_id   == item.product_id,
            SalesEntry.year         == year,
            SalesEntry.month        == month,
            SalesEntry.week         == day,
        ).first()
        if existing:
            existing.qty     = item.quantity
            existing.value        = item.value
            existing.remarks      = payload.remarks
            existing.sale_date    = payload.sale_date
            existing.submitted_at = datetime.utcnow()
        else:
            db.add(SalesEntry(
                doctor_id    = payload.doctor_id,
                associate_id = payload.associate_id,
                product_id   = item.product_id,
                year         = year,
                month        = month,
                week         = day,
                sale_date    = payload.sale_date,
                qty          = item.quantity,
                value        = item.value,
                remarks      = payload.remarks,
            ))
        saved += 1

    db.commit()
    return {"status": "submitted", "entries_saved": saved, "sale_date": payload.sale_date}


@router.get("/doctor/{doctor_id}/monthly")
def get_doctor_monthly_sales(doctor_id: int, year: int, month: int, db: Session = Depends(get_db)):
    entries = db.query(SalesEntry).filter(
        SalesEntry.doctor_id == doctor_id,
        SalesEntry.year == year,
        SalesEntry.month == month,
    ).all()

    result = {}
    for e in entries:
        pid = e.product_id
        if pid not in result:
            result[pid] = {
                "product_id": pid,
                "product_name": e.product.name if e.product else "",
                "week1": 0, "week2": 0, "week3": 0, "week4": 0, "total": 0,
            }
        result[pid][f"week{e.week}"] = e.value
        result[pid]["total"] += e.value

    return {
        "doctor_id": doctor_id, "year": year, "month": month,
        "products": list(result.values()),
        "grand_total": sum(p["total"] for p in result.values()),
    }


@router.get("/doctor/{doctor_id}/summary")
def get_doctor_summary(doctor_id: int, db: Session = Depends(get_db)):
    rows = db.query(
        SalesEntry.year, SalesEntry.month,
        func.sum(SalesEntry.value).label("actual_sales"),
        func.sum(SalesEntry.qty).label("total_qty"),
    ).filter(SalesEntry.doctor_id == doctor_id)\
     .group_by(SalesEntry.year, SalesEntry.month)\
     .order_by(SalesEntry.year.desc(), SalesEntry.month.desc()).all()
    return [{"year": r.year, "month": r.month, "actual_sales": round(r.actual_sales, 2)} for r in rows]


@router.get("/region/{manager_id}/monthly")
def get_region_monthly_sales(manager_id: int, year: int, month: int, db: Session = Depends(get_db)):
    doctors = db.query(Doctor).filter(Doctor.manager_id == manager_id).all()
    doctor_ids = [d.id for d in doctors]
    rows = db.query(SalesEntry.doctor_id, func.sum(SalesEntry.value).label("total_value"))\
             .filter(SalesEntry.doctor_id.in_(doctor_ids), SalesEntry.year == year, SalesEntry.month == month)\
             .group_by(SalesEntry.doctor_id).all()
    return [{"doctor_id": r.doctor_id, "total_sales": round(r.total_value, 2)} for r in rows]


@router.get("/by-product")
def get_sales_by_product(year: int, month: int,
                          start_date: Optional[str] = None,
                          end_date:   Optional[str] = None,
                          db: Session = Depends(get_db)):
    q = db.query(
        SalesEntry.product_id,
        func.sum(SalesEntry.value).label("total_value"),
        func.sum(SalesEntry.qty).label("total_qty"),
    )
    if start_date and end_date:
        q = q.filter(SalesEntry.sale_date >= start_date, SalesEntry.sale_date <= end_date)
    elif year and month:
        q = q.filter(SalesEntry.year == year, SalesEntry.month == month)
    else:
        raise HTTPException(status_code=400, detail="year/month or start_date/end_date required")
    rows = q.group_by(SalesEntry.product_id).all()

    result = []
    for r in rows:
        product = db.query(Product).filter(Product.id == r.product_id).first()
        result.append({
            "product_id": r.product_id,
            "product_name": product.name if product else "",
            "total_sales": round(r.total_value, 2),
            "total_qty": round(r.total_qty, 2),
        })
    return sorted(result, key=lambda x: x["total_sales"], reverse=True)


@router.get("/product/{product_id}/doctors")
def get_doctors_by_product(
    product_id: int,
    year: int = 0,
    month: int = 0,
    start_date: Optional[str] = None,
    end_date:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Doctors who purchased a given product, sorted by value desc."""
    q = db.query(
        SalesEntry.doctor_id,
        func.sum(SalesEntry.value).label("total_value"),
        func.sum(SalesEntry.qty).label("total_qty"),
    ).filter(SalesEntry.product_id == product_id)

    if start_date and end_date:
        q = q.filter(SalesEntry.sale_date >= start_date, SalesEntry.sale_date <= end_date)
    elif year and month:
        q = q.filter(SalesEntry.year == year, SalesEntry.month == month)

    rows = q.group_by(SalesEntry.doctor_id).order_by(func.sum(SalesEntry.value).desc()).all()

    result = []
    for r in rows:
        doc = db.query(Doctor).filter(Doctor.id == r.doctor_id).first()
        result.append({
            "doctor_id":   r.doctor_id,
            "doctor_name": doc.name      if doc else f"Doctor {r.doctor_id}",
            "hospital":    doc.hospital  if doc else "",
            "city":        doc.city      if doc else "",
            "specialty":   doc.specialty if doc else "",
            "total_value": round(r.total_value or 0, 2),
            "total_qty":   round(r.total_qty   or 0, 2),
        })
    return result


@router.get("/my-sales")
def get_my_sales(associate_id: int, year: int, month: int, db: Session = Depends(get_db)):
    """All entries by this associate for a given month, grouped by date → doctor → products."""
    visible_ids = get_subtree_ids(associate_id, db)

    q = db.query(SalesEntry).filter(
        SalesEntry.year  == year,
        SalesEntry.month == month,
    )
    if visible_ids is not None:
        q = q.filter(SalesEntry.associate_id.in_(visible_ids))

    rows = q.order_by(SalesEntry.sale_date.desc(), SalesEntry.doctor_id).all()

    # Group by date → doctor
    from collections import OrderedDict
    dates_map = OrderedDict()
    for r in rows:
        date_key = r.sale_date or f"{year}-{month:02d}-{(r.week or 1):02d}"
        if date_key not in dates_map:
            dates_map[date_key] = {}
        did = r.doctor_id
        if did not in dates_map[date_key]:
            doc = db.query(Doctor).filter(Doctor.id == did).first()
            dates_map[date_key][did] = {
                "doctor_id":   did,
                "doctor_name": doc.name     if doc else f"Doctor {did}",
                "hospital":    doc.hospital if doc else "",
                "city":        doc.city     if doc else "",
                "products":    [],
                "total":       0.0,
            }
        prod = db.query(Product).filter(Product.id == r.product_id).first()
        dates_map[date_key][did]["products"].append({
            "entry_id":     r.id,
            "product_id":   r.product_id,
            "product_name": prod.name if prod else f"Product {r.product_id}",
            "quantity":     r.qty or 0,
            "value":        r.value    or 0,
        })
        dates_map[date_key][did]["total"] += r.value or 0

    result = []
    for date_key, docs in dates_map.items():
        day_total = sum(d["total"] for d in docs.values())
        result.append({
            "date":      date_key,
            "doctors":   list(docs.values()),
            "day_total": round(day_total, 2),
        })
    return result


@router.post("/validate-week-pdf")
async def validate_week_pdf(
    associate_id: int = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Validate a weekly store/manufacturing PDF against entered sales.
    The PDF parser extracts numeric values and compares the closest amount to the app total.
    """
    start_day, end_day = _week_bounds(week)
    visible_ids = get_subtree_ids(associate_id, db)

    q = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.year == year,
        SalesEntry.month == month,
        SalesEntry.week >= start_day,
        SalesEntry.week <= end_day,
    )
    if visible_ids is not None:
        q = q.filter(SalesEntry.associate_id.in_(visible_ids))
    entered_total = float(q.scalar() or 0)

    raw = await file.read()
    text = ""
    try:
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        text = raw.decode("latin-1", errors="ignore")

    amounts = []
    for token in re.findall(r"(?:Rs\.?|INR|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", text, flags=re.IGNORECASE):
        try:
            value = float(token.replace(",", ""))
            if value > 0:
                amounts.append(value)
        except ValueError:
            pass

    unique_amounts = sorted(set(round(v, 2) for v in amounts), reverse=True)
    closest = None
    if unique_amounts:
        closest = min(unique_amounts, key=lambda v: abs(v - entered_total))

    difference = round((closest or 0) - entered_total, 2) if closest is not None else None
    tolerance = max(1.0, round(entered_total * 0.001, 2))

    return {
        "filename": file.filename,
        "year": year,
        "month": month,
        "week": week,
        "entered_total": round(entered_total, 2),
        "pdf_total": closest,
        "difference": difference,
        "matches": closest is not None and abs(difference) <= tolerance,
        "candidate_totals": unique_amounts[:10],
        "message": "Matched" if closest is not None and abs(difference) <= tolerance
                   else "PDF total does not match entered sales" if closest is not None
                   else "Could not extract totals from PDF",
    }


@router.get("/my-today")
def get_my_today(associate_id: int, sale_date: str, db: Session = Depends(get_db)):
    """Return all entries submitted by this associate on the given date, grouped by doctor."""
    rows = db.query(SalesEntry).filter(
        SalesEntry.associate_id == associate_id,
        SalesEntry.sale_date    == sale_date,
    ).order_by(SalesEntry.id.desc()).all()

    # Group by doctor
    doctors_map = {}
    for r in rows:
        did = r.doctor_id
        if did not in doctors_map:
            doc = db.query(Doctor).filter(Doctor.id == did).first()
            doctors_map[did] = {
                "doctor_id":   did,
                "doctor_name": doc.name if doc else f"Doctor {did}",
                "hospital":    doc.hospital if doc else "",
                "city":        doc.city if doc else "",
                "products":    [],
                "total":       0,
            }
        prod = db.query(Product).filter(Product.id == r.product_id).first()
        doctors_map[did]["products"].append({
            "product_id":   r.product_id,
            "product_name": prod.name if prod else f"Product {r.product_id}",
            "quantity":     r.qty,
            "value":        r.value,
        })
        doctors_map[did]["total"] += r.value or 0

    return list(doctors_map.values())


@router.get("/weekly-reminder-status")
def get_weekly_reminder_status(user_id: int, today: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Checks whether the previous Monday-Sunday sales week has any submitted entries
    for the user or their visible team.
    """
    try:
        ref_date = datetime.strptime(today, "%Y-%m-%d").date() if today else date_type.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="today must be YYYY-MM-DD")

    this_monday = ref_date - timedelta(days=ref_date.weekday())
    week_start = this_monday - timedelta(days=7)
    week_end = week_start + timedelta(days=6)
    dates = [week_start + timedelta(days=i) for i in range(7)]
    date_keys = [d.isoformat() for d in dates]

    visible_ids = get_subtree_ids(user_id, db)
    if visible_ids is None:
        visible_ids = {user_id}

    date_conditions = [
        (SalesEntry.year == d.year) & (SalesEntry.month == d.month) & (SalesEntry.week == d.day)
        for d in dates
    ]

    q = db.query(
        func.count(SalesEntry.id).label("entries"),
        func.sum(SalesEntry.value).label("value"),
    ).filter(
        SalesEntry.associate_id.in_(visible_ids),
        or_(SalesEntry.sale_date.in_(date_keys), *date_conditions),
    ).first()

    entries = int(q.entries or 0)
    total_value = float(q.value or 0)
    return {
        "user_id": user_id,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "entries_count": entries,
        "total_value": round(total_value, 2),
        "completed": entries > 0,
    }


@router.post("/{entry_id}/approve")
def approve_entry(entry_id: int, approver_id: int, db: Session = Depends(get_db)):
    entry = db.query(SalesEntry).filter(SalesEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.is_approved = True
    entry.approved_by_id = approver_id
    entry.approved_at = datetime.utcnow()
    db.commit()
    return {"status": "approved"}
