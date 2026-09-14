# backend/routers/sales.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, date as date_type, timedelta
import calendar
import logging
import re

from ..database import get_db
from ..auth.auth import get_current_user, require_roles
from ..models.models import SalesEntry, RegionalSalesEntry, RegionalSalesWeekPDF, Doctor, Product
from ..utils.hierarchy import get_dashboard_scope_ids, get_subtree_ids
from ..utils.regional_territories import TERRITORY_STATES, visible_territories
from ..services.pdf_totals import validate_labeled_total
from ..services.regional_sales_pdf import extract_regional_sales_rows
from ..services.regional_sales_files import extract_excel_rows, extract_image_rows

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sales", tags=["Sales"])


def _state_keys(value: Optional[str]):
    key = "".join((value or "").upper().split())
    aliases = {
        "TAMILNADU": {"TN", "TAMILNADU"},
        "KERALA": {"KL", "KERALA"},
        "TELANGANA": {"TS", "TG", "TELANGANA"},
        "KARNATAKA": {"KA", "KARNATAKA"},
        "ANDHRAPRADESH": {"AP", "ANDHRAPRADESH"},
        "MAHARASHTRA": {"MH", "MAHARASHTRA"},
        "DELHI": {"DL", "DELHI"},
    }
    return aliases.get(key, {key}) if key else set()


def _enforce_regional_territory_access(
    user_id: int,
    city: str,
    db: Session,
    state_code: Optional[str] = None,
):
    allowed = visible_territories(user_id, db)
    if allowed is not None and city not in allowed:
        raise HTTPException(status_code=403, detail=f"You are not assigned to the {city} territory")
    expected_state = TERRITORY_STATES.get(city)
    if expected_state and state_code:
        normalized_state = "".join(state_code.upper().split())
        if normalized_state != "".join(expected_state.upper().split()):
            raise HTTPException(status_code=400, detail=f"{city} belongs to {expected_state}")


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


class SalesEntryUpdateRequest(BaseModel):
    associate_id: int
    quantity: float = 0
    value: float = 0
    remarks: Optional[str] = None


class RegionalSalesItem(BaseModel):
    id: Optional[int] = None
    product_id: int
    quantity: float = 0
    price: float = 0


class RegionalSalesRequest(BaseModel):
    associate_id: int
    state_code: Optional[str] = None
    city: Optional[str] = None
    year: int
    month: int
    week: int
    entries: List[RegionalSalesItem]
    remarks: Optional[str] = None


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


@router.delete("/{entry_id}")
def delete_sales_entry(entry_id: int, associate_id: int, db: Session = Depends(get_db)):
    entry = db.query(SalesEntry).filter(SalesEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Sales entry not found")
    if entry.associate_id != associate_id:
        raise HTTPException(status_code=403, detail="You can delete only your own sales entries")
    db.delete(entry)
    db.commit()
    return {"status": "deleted", "entry_id": entry_id}


@router.patch("/{entry_id}")
def update_sales_entry(entry_id: int, payload: SalesEntryUpdateRequest, db: Session = Depends(get_db)):
    entry = db.query(SalesEntry).filter(SalesEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Sales entry not found")
    if entry.associate_id != payload.associate_id:
        raise HTTPException(status_code=403, detail="You can edit only your own sales entries")
    if payload.quantity < 0 or payload.value < 0:
        raise HTTPException(status_code=400, detail="Quantity and value cannot be negative")
    entry.qty = payload.quantity
    entry.value = payload.value
    if payload.remarks is not None:
        entry.remarks = payload.remarks
    entry.submitted_at = datetime.utcnow()
    db.commit()
    return {"status": "updated", "entry_id": entry.id}


@router.post("/regional/submit")
def submit_regional_sales(payload: RegionalSalesRequest, db: Session = Depends(get_db)):
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    if payload.week < 0 or payload.week > 4:
        raise HTTPException(status_code=400, detail="Invalid week")
    state_code = (payload.state_code or "").strip()
    city = (payload.city or "").strip()
    if not state_code or not city:
        raise HTTPException(status_code=400, detail="State and city are required")
    _enforce_regional_territory_access(payload.associate_id, city, db, state_code)

    product_ids = {p.id for p in db.query(Product.id).filter(Product.is_active == True).all()}
    saved = 0
    for item in payload.entries:
        if item.product_id not in product_ids:
            continue
        qty = float(item.quantity or 0)
        price = float(item.price or 0)
        value = round(qty * price, 2) if qty > 0 and price > 0 else 0.0

        existing = None
        if item.id:
            existing = db.query(RegionalSalesEntry).filter(
                RegionalSalesEntry.id == item.id,
                RegionalSalesEntry.product_id == item.product_id,
            ).first()
        if not existing:
            existing = db.query(RegionalSalesEntry).filter(
                RegionalSalesEntry.associate_id == payload.associate_id,
                RegionalSalesEntry.state_code == state_code,
                RegionalSalesEntry.city == city,
                RegionalSalesEntry.product_id == item.product_id,
                RegionalSalesEntry.year == payload.year,
                RegionalSalesEntry.month == payload.month,
                RegionalSalesEntry.week == payload.week,
            ).first()
        if existing:
            if qty <= 0:
                db.delete(existing)
            else:
                existing.qty = qty
                existing.price = price
                existing.value = value
                existing.remarks = payload.remarks
                existing.submitted_at = datetime.utcnow()
        elif qty > 0 or price > 0:
            db.add(RegionalSalesEntry(
                associate_id=payload.associate_id,
                state_code=state_code,
                city=city,
                product_id=item.product_id,
                year=payload.year,
                month=payload.month,
                week=payload.week,
                qty=qty,
                price=price,
                value=value,
                remarks=payload.remarks,
                submitted_at=datetime.utcnow(),
            ))
        else:
            continue
        saved += 1

    db.commit()

    # Keep uploaded report validation in sync after an import/save. The upload
    # arrives before the sales rows, so its initial entered total is normally 0.
    cumulative_total = float(db.query(func.sum(RegionalSalesEntry.value)).filter(
        RegionalSalesEntry.associate_id == payload.associate_id,
        RegionalSalesEntry.state_code.ilike(state_code),
        RegionalSalesEntry.city.ilike(city),
        RegionalSalesEntry.year == payload.year,
        RegionalSalesEntry.month == payload.month,
        RegionalSalesEntry.week >= 1,
        RegionalSalesEntry.week <= payload.week,
    ).scalar() or 0)
    uploaded_reports = _regional_pdf_query(
        db, payload.associate_id, state_code, city, payload.year, payload.month, payload.week
    ).all()
    for report in uploaded_reports:
        report.entered_total = cumulative_total
        if report.pdf_total is None:
            report.difference = None
            report.matches = False
            report.validation_status = "unverified"
            continue
        difference = round(float(report.pdf_total) - cumulative_total, 2)
        tolerance = max(1.0, round(abs(cumulative_total) * 0.001, 2))
        report.difference = difference
        report.matches = abs(difference) <= tolerance
        report.validation_status = "matched" if report.matches else "mismatch"
    db.commit()
    return {"status": "submitted", "entries_saved": saved}


@router.get("/regional")
def get_regional_sales(
    associate_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    week: Optional[int] = None,
    state_code: Optional[str] = None,
    city: Optional[str] = None,
    db: Session = Depends(get_db),
):
    visible_ids = get_subtree_ids(associate_id, db)
    allowed_territories = visible_territories(associate_id, db)
    if city and allowed_territories is not None and city.strip() not in allowed_territories:
        raise HTTPException(status_code=403, detail=f"You are not assigned to the {city.strip()} territory")

    q = db.query(RegionalSalesEntry)
    if year is not None:
        q = q.filter(RegionalSalesEntry.year == year)
    if month is not None:
        q = q.filter(RegionalSalesEntry.month == month)
    if visible_ids is not None:
        q = q.filter(RegionalSalesEntry.associate_id.in_(visible_ids))
    if allowed_territories is not None:
        if not allowed_territories:
            return []
        q = q.filter(RegionalSalesEntry.city.in_(allowed_territories))
    if week is not None:
        q = q.filter(RegionalSalesEntry.week == week)
    if state_code:
        q = q.filter(RegionalSalesEntry.state_code.ilike(state_code.strip()))
    if city:
        q = q.filter(RegionalSalesEntry.city.ilike(city.strip()))

    rows = q.order_by(RegionalSalesEntry.year, RegionalSalesEntry.month, RegionalSalesEntry.week, RegionalSalesEntry.state_code, RegionalSalesEntry.city, RegionalSalesEntry.product_id).all()
    return [{
        "id": row.id,
        "associate_id": row.associate_id,
        "associate_name": row.associate.name if row.associate else "",
        "state_code": row.state_code or "",
        "city": row.city or "",
        "product_id": row.product_id,
        "product_name": row.product.name if row.product else f"Product {row.product_id}",
        "year": row.year,
        "month": row.month,
        "week": row.week,
        "quantity": row.qty or 0,
        "price": row.price or 0,
        "value": row.value or 0,
        "remarks": row.remarks or "",
    } for row in rows]


def _regional_pdf_query(
    db: Session,
    associate_id: int,
    state_code: str,
    city: str,
    year: int,
    month: int,
    week: int,
):
    return db.query(RegionalSalesWeekPDF).filter(
        RegionalSalesWeekPDF.associate_id == associate_id,
        RegionalSalesWeekPDF.state_code.ilike(state_code.strip()),
        RegionalSalesWeekPDF.city.ilike(city.strip()),
        RegionalSalesWeekPDF.year == year,
        RegionalSalesWeekPDF.month == month,
        RegionalSalesWeekPDF.week == week,
    )


def _regional_pdf_metadata(record: RegionalSalesWeekPDF):
    validation_status = getattr(record, "validation_status", None) or "unverified"
    return {
        "id": record.id,
        "associate_id": record.associate_id,
        "state_code": record.state_code,
        "city": record.city,
        "year": record.year,
        "month": record.month,
        "week": record.week,
        "filename": record.filename,
        "entered_total": round(float(record.entered_total or 0), 2),
        "pdf_total": round(float(record.pdf_total), 2) if record.pdf_total is not None else None,
        "difference": round(float(record.difference), 2) if record.difference is not None else None,
        "matches": validation_status == "matched",
        "validation_status": validation_status,
        "total_label": getattr(record, "total_label", None),
        "uploaded_at": record.uploaded_at.isoformat() if record.uploaded_at else None,
    }


@router.post("/regional/week-pdf")
async def upload_regional_week_pdf(
    associate_id: int = Form(...),
    state_code: str = Form(...),
    city: str = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week: int = Form(...),
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")
    state_code = state_code.strip()
    city = city.strip()
    if not state_code or not city:
        raise HTTPException(status_code=400, detail="State and city are required")
    _enforce_regional_territory_access(associate_id, city, db, state_code)
    if month < 1 or month > 12 or week < 1 or week > 4:
        raise HTTPException(status_code=400, detail="Invalid month or week")

    raw = await file.read()
    if not raw or len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Report file must be between 1 byte and 10 MB")
    filename = (file.filename or "").lower()
    is_pdf = raw.startswith(b"%PDF-")
    is_excel = filename.endswith((".xlsx", ".xls"))
    is_image = filename.endswith((".png", ".jpg", ".jpeg", ".webp"))
    if not (is_pdf or is_excel or is_image):
        raise HTTPException(status_code=400, detail="Upload a PDF, Excel workbook, JPG, PNG, or WebP image")

    entered_total = float(db.query(func.sum(RegionalSalesEntry.value)).filter(
        RegionalSalesEntry.associate_id == associate_id,
        RegionalSalesEntry.state_code.ilike(state_code),
        RegionalSalesEntry.city.ilike(city),
        RegionalSalesEntry.year == year,
        RegionalSalesEntry.month == month,
        RegionalSalesEntry.week >= 1,
        RegionalSalesEntry.week <= week,
    ).scalar() or 0)

    active_products = db.query(Product).filter(Product.is_active == True).all()
    text = ""
    try:
        if is_pdf:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(raw))
            extracted_pages = []
            for page in reader.pages:
                try:
                    extracted_pages.append(page.extract_text(extraction_mode="layout") or "")
                except (TypeError, ValueError):
                    extracted_pages.append(page.extract_text() or "")
            text = "\n".join(extracted_pages)
            parsed = extract_regional_sales_rows(text, active_products)
        elif is_excel:
            parsed = extract_excel_rows(raw, active_products, filename)
        else:
            parsed = extract_image_rows(raw, active_products)
    except Exception:
        logger.exception(
            "Regional sales report parse failed (file=%s, associate=%s, %s-%s week %s)",
            filename, associate_id, year, month, week,
        )
        raise HTTPException(status_code=400, detail="Unable to read the uploaded report. Check that it is a valid, clear PDF, spreadsheet, or image.")

    extracted_total = parsed.get("pdf_total", parsed.get("source_total"))
    validation_text = f"Grand Total {extracted_total}" if extracted_total is not None else text
    validation = validate_labeled_total(validation_text, entered_total)

    record = RegionalSalesWeekPDF(
        associate_id=associate_id,
        state_code=state_code,
        city=city,
        year=year,
        month=month,
        week=week,
        filename=(file.filename or f"regional-sales-{year}-{month}-week-{week}")[:255],
        content_type=(file.content_type or "application/octet-stream")[:100],
        file_data=raw,
        entered_total=entered_total,
        pdf_total=validation.get("total"),
        difference=validation.get("difference"),
        matches=validation["matches"],
        validation_status=validation["status"],
        total_label=validation.get("label"),
        uploaded_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    result = _regional_pdf_metadata(record)
    result["parsed_entries"] = parsed["entries"]
    result["parsed_count"] = len(parsed["entries"])
    result["unmatched_rows"] = parsed["unmatched_rows"]
    # Products read from the file that are not in the Product Master — shown so the
    # user can see every line the report contained, not just the ones we could map.
    result["unmatched_items"] = parsed.get("unmatched_items", [])
    result["matched_total"] = parsed.get("matched_total")
    result["source_total"] = extracted_total
    result["message"] = "Matched" if validation["status"] == "matched" else "Report total does not match cumulative regional sales" if validation["status"] == "mismatch" else validation.get("reason", "Report saved but could not be verified")
    return result


@router.get("/regional/week-pdf/status")
def get_regional_week_pdf_status(
    associate_id: int,
    state_code: str,
    city: str,
    year: int,
    month: int,
    week: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    viewer_id = current_user.id
    visible_ids = get_subtree_ids(viewer_id, db)
    if visible_ids is not None and associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="You cannot view this representative's report")
    _enforce_regional_territory_access(viewer_id, city.strip(), db, state_code)
    records = _regional_pdf_query(db, associate_id, state_code, city, year, month, week)\
        .order_by(RegionalSalesWeekPDF.uploaded_at.desc(), RegionalSalesWeekPDF.id.desc()).all()
    return [_regional_pdf_metadata(record) for record in records]


@router.get("/regional/week-pdf/download")
def download_regional_week_pdf(
    pdf_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    viewer_id = current_user.id
    record = db.query(RegionalSalesWeekPDF).filter(RegionalSalesWeekPDF.id == pdf_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Weekly report not found")
    visible_ids = get_subtree_ids(viewer_id, db)
    if visible_ids is not None and record.associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="You cannot download this representative's report")
    _enforce_regional_territory_access(viewer_id, record.city, db, record.state_code)
    safe_filename = (record.filename or "regional-sales.pdf").replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=record.file_data,
        media_type=record.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.delete("/regional/week-pdf/{pdf_id}")
def delete_regional_week_pdf(
    pdf_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    viewer_id = current_user.id
    record = db.query(RegionalSalesWeekPDF).filter(RegionalSalesWeekPDF.id == pdf_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Weekly report not found")
    visible_ids = get_subtree_ids(viewer_id, db)
    if visible_ids is not None and record.associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="You cannot remove this representative's report")
    _enforce_regional_territory_access(viewer_id, record.city, db, record.state_code)
    db.delete(record)
    db.commit()
    return {"status": "deleted", "pdf_id": pdf_id}


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
                          viewer_id: Optional[int] = None,
                          owner_scope: str = "overall",
                          state_code: Optional[str] = None,
                          city: Optional[str] = None,
                          current_user = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    viewer_id = current_user.id
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
    if viewer_id:
        owner_ids = get_dashboard_scope_ids(viewer_id, owner_scope, db)
        if not owner_ids:
            return []
        doctor_q = db.query(Doctor.id).filter(Doctor.manager_id.in_(owner_ids))
        state_keys = _state_keys(state_code)
        if state_keys:
            doctor_q = doctor_q.filter(func.upper(func.replace(Doctor.state_code, " ", "")).in_(state_keys))
        if city:
            doctor_q = doctor_q.filter(Doctor.city.ilike(city.strip()))
        q = q.filter(SalesEntry.doctor_id.in_(doctor_q))
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
    viewer_id: Optional[int] = None,
    owner_scope: str = "overall",
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    viewer_id = current_user.id
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

    if viewer_id:
        owner_ids = get_dashboard_scope_ids(viewer_id, owner_scope, db)
        if not owner_ids:
            return []
        owned_doctor_ids = db.query(Doctor.id).filter(Doctor.manager_id.in_(owner_ids))
        q = q.filter(SalesEntry.doctor_id.in_(owned_doctor_ids))

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
            "associate_id": r.associate_id,
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
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Validate a weekly store/manufacturing PDF against entered sales.
    The PDF parser accepts only an explicitly labelled invoice total and never uses
    the CRM value to choose which number from the document should be compared.
    """
    start_day, end_day = _week_bounds(week)
    end_day = min(end_day, calendar.monthrange(year, month)[1])
    week_start = date_type(year, month, start_day).isoformat()
    week_end = date_type(year, month, end_day).isoformat()
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")

    q = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.year == year,
        SalesEntry.month == month,
        SalesEntry.sale_date.isnot(None),
        SalesEntry.sale_date >= week_start,
        SalesEntry.sale_date <= week_end,
    )
    if visible_ids is not None:
        q = q.filter(SalesEntry.associate_id.in_(visible_ids))
    entered_total = float(q.scalar() or 0)
    legacy_q = db.query(func.sum(SalesEntry.value)).filter(
        SalesEntry.year == year,
        SalesEntry.month == month,
        SalesEntry.sale_date.is_(None),
    )
    if visible_ids is not None:
        legacy_q = legacy_q.filter(SalesEntry.associate_id.in_(visible_ids))
    legacy_unallocated_total = float(legacy_q.scalar() or 0)

    raw = await file.read()
    text = ""
    try:
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        text = raw.decode("latin-1", errors="ignore")

    validation = validate_labeled_total(text, entered_total)

    return {
        "filename": file.filename,
        "year": year,
        "month": month,
        "week": week,
        "entered_total": round(entered_total, 2),
        "legacy_unallocated_total": round(legacy_unallocated_total, 2),
        "pdf_total": validation.get("total"),
        "difference": validation.get("difference"),
        "matches": validation["matches"],
        "validation_status": validation["status"],
        "total_label": validation.get("label"),
        "message": "Matched" if validation["status"] == "matched"
                   else "PDF total does not match entered sales" if validation["status"] == "mismatch"
                   else validation.get("reason", "Could not verify the PDF total"),
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

    q = db.query(
        func.count(SalesEntry.id).label("entries"),
        func.sum(SalesEntry.value).label("value"),
    ).filter(
        SalesEntry.associate_id.in_(visible_ids),
        SalesEntry.sale_date.in_(date_keys),
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


@router.post("/{entry_id}/approve", dependencies=[Depends(require_roles("admin", "md", "director", "senior_manager", "manager", "custom"))])
def approve_entry(entry_id: int, approver_id: int, db: Session = Depends(get_db)):
    entry = db.query(SalesEntry).filter(SalesEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.is_approved = True
    entry.approved_by_id = approver_id
    entry.approved_at = datetime.utcnow()
    db.commit()
    return {"status": "approved"}
