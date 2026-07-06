# backend/routers/exports.py
"""
Excel export endpoints.
  GET /exports/sales?year=&month=&associate_id=   → monthly sales by doctor
  GET /exports/rep-activity?year=&month=          → visits + sales per rep per week
  GET /exports/doctor-master                      → full doctor list with ROI data
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, timedelta
import io

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

from ..database import get_db
from ..models.models import SalesEntry, Doctor, Product, User, VisitLog

router = APIRouter(prefix="/exports", tags=["Exports"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _header_style(ws, row, cols, bg="1A3A1A", fg="FFFFFF"):
    """Apply dark header style to a row."""
    fill = PatternFill("solid", fgColor=bg)
    font = Font(bold=True, color=fg, size=10)
    for col in range(1, cols + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center")


def _auto_width(ws, padding=4):
    for col in ws.columns:
        max_len = max((len(str(c.value or "")) for c in col), default=0)
        ws.column_dimensions[get_column_letter(col[0].column)].width = max_len + padding


def _xlsx_response(wb, filename):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _subordinate_ids(db, user_id):
    result = {user_id}
    queue  = [user_id]
    while queue:
        cur = queue.pop()
        subs = db.query(User.id).filter(User.reports_to_id == cur).all()
        for (sid,) in subs:
            if sid not in result:
                result.add(sid)
                queue.append(sid)
    return result


# ── 1. Monthly Sales Export ───────────────────────────────────────────────────

@router.get("/sales")
def export_monthly_sales(
    year:         int            = Query(...),
    month:        int            = Query(...),
    associate_id: Optional[int]  = Query(None),
    viewer_id:    Optional[int]  = Query(None),
    db:           Session        = Depends(get_db),
):
    """Download monthly sales entries as Excel."""
    if not HAS_OPENPYXL:
        return {"error": "openpyxl not installed — run: pip install openpyxl"}

    q = db.query(SalesEntry).filter(
        SalesEntry.year  == year,
        SalesEntry.month == month,
    )
    if associate_id:
        q = q.filter(SalesEntry.associate_id == associate_id)
    elif viewer_id:
        visible = _subordinate_ids(db, viewer_id)
        q = q.filter(SalesEntry.associate_id.in_(visible))

    rows = q.order_by(SalesEntry.sale_date, SalesEntry.doctor_id).all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Sales {year}-{month:02d}"

    headers = ["Date", "Rep", "Doctor", "Hospital", "City", "Specialty",
               "Product", "Qty", "Value (₹)", "Approved"]
    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col, value=h)
    _header_style(ws, 1, len(headers))
    ws.row_dimensions[1].height = 20

    for r_idx, e in enumerate(rows, 2):
        doc  = e.doctor  if e.doctor  else None
        prod = e.product if e.product else None
        rep  = db.query(User).filter(User.id == e.associate_id).first()
        ws.append([
            e.sale_date or f"{year}-{month:02d}-{(e.week or 1):02d}",
            rep.name  if rep  else e.associate_id,
            doc.name  if doc  else e.doctor_id,
            doc.hospital if doc else "",
            doc.city     if doc else "",
            doc.specialty if doc else "",
            prod.name if prod else e.product_id,
            e.qty   or 0,
            round(e.value or 0, 2),
            "Yes" if e.is_approved else "No",
        ])

    # Value column as number
    for row in ws.iter_rows(min_row=2, min_col=9, max_col=9):
        for cell in row:
            cell.number_format = '#,##0.00'

    ws.freeze_panes = "A2"
    _auto_width(ws)

    from calendar import month_abbr
    mn = month_abbr[month]
    return _xlsx_response(wb, f"Fortel_Sales_{mn}{year}.xlsx")


# ── 2. Rep Activity Export ────────────────────────────────────────────────────

@router.get("/rep-activity")
def export_rep_activity(
    year:      int           = Query(...),
    month:     int           = Query(...),
    viewer_id: Optional[int] = Query(None),
    db:        Session       = Depends(get_db),
):
    """Per-rep weekly activity: visits, hospitals, doctors, sales."""
    if not HAS_OPENPYXL:
        return {"error": "openpyxl not installed"}

    visible_ids = _subordinate_ids(db, viewer_id) if viewer_id else None

    # Get all reps in scope
    q = db.query(User).filter(User.role.in_(["rep", "custom", "associate"]))
    if visible_ids:
        q = q.filter(User.id.in_(visible_ids))
    reps = q.all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Rep Activity"

    headers = ["Rep", "Role", "Week", "Visit Days", "Unique Hospitals",
               "Unique Doctors", "Sales Entries", "Sales Value (₹)"]
    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col, value=h)
    _header_style(ws, 1, len(headers))
    ws.row_dimensions[1].height = 20

    # Determine week boundaries for the month
    from calendar import monthrange
    _, days_in_month = monthrange(year, month)
    week_ranges = [
        (1,  7,  "Week 1"),
        (8,  14, "Week 2"),
        (15, 21, "Week 3"),
        (22, days_in_month, "Week 4"),
    ]

    for rep in reps:
        for wk_start, wk_end, wk_label in week_ranges:
            # Build date strings for filtering
            date_from = f"{year}-{month:02d}-{wk_start:02d}"
            date_to   = f"{year}-{month:02d}-{wk_end:02d}"

            # Visits in this week
            visits = db.query(VisitLog).filter(
                VisitLog.associate_id == rep.id,
                func.date(VisitLog.visit_time) >= date_from,
                func.date(VisitLog.visit_time) <= date_to,
            ).all()

            visit_days   = len(set(str(v.visit_time.date()) for v in visits))
            uniq_doctors = len(set(v.doctor_id for v in visits if v.doctor_id))
            uniq_hospitals = len(set(
                v.doctor.hospital for v in visits
                if v.doctor and v.doctor.hospital
            ))

            # Sales entries in this week
            sales_rows = db.query(SalesEntry).filter(
                SalesEntry.associate_id == rep.id,
                SalesEntry.year  == year,
                SalesEntry.month == month,
                SalesEntry.week  >= wk_start,
                SalesEntry.week  <= wk_end,
            ).all()

            sales_entries = len(sales_rows)
            sales_value   = round(sum(s.value or 0 for s in sales_rows), 2)

            if visit_days == 0 and sales_entries == 0:
                continue  # skip empty weeks

            ws.append([
                rep.name, rep.role, wk_label,
                visit_days, uniq_hospitals, uniq_doctors,
                sales_entries, sales_value,
            ])

    for row in ws.iter_rows(min_row=2, min_col=8, max_col=8):
        for cell in row:
            cell.number_format = '#,##0.00'

    ws.freeze_panes = "A2"
    _auto_width(ws)

    from calendar import month_abbr
    mn = month_abbr[month]
    return _xlsx_response(wb, f"Fortel_RepActivity_{mn}{year}.xlsx")


# ── 3. Doctor Master Export ───────────────────────────────────────────────────

@router.get("/doctor-master")
def export_doctor_master(
    viewer_id: Optional[int] = Query(None),
    db:        Session       = Depends(get_db),
):
    """Full doctor list with ROI data."""
    if not HAS_OPENPYXL:
        return {"error": "openpyxl not installed"}

    q = db.query(Doctor).filter(Doctor.is_active != False)
    doctors = q.order_by(Doctor.name).all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Doctor Master"

    headers = [
        "Name", "Hospital", "City", "Specialty", "Category",
        "Expected Multiple", "ROI Grade", "Commercial Model",
        "Manager", "Phone", "State"
    ]
    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col, value=h)
    _header_style(ws, 1, len(headers))
    ws.row_dimensions[1].height = 20

    for d in doctors:
        ws.append([
            d.name,
            d.hospital or "",
            d.city     or "",
            d.specialty or d.customer_type or "",
            d.category  or "",
            d.expected_multiple or "",
            d.roi_grade or "",
            d.commercial_model or "",
            d.manager.name if d.manager else "",
            d.phone or "",
            d.state_code or "",
        ])

    ws.freeze_panes = "A2"
    _auto_width(ws)

    return _xlsx_response(wb, "Fortel_DoctorMaster.xlsx")


# ── 4. Rep Activity JSON (for dashboard screen) ───────────────────────────────

@router.get("/rep-activity-data")
def get_rep_activity_data(
    year:      int           = Query(...),
    month:     int           = Query(...),
    viewer_id: Optional[int] = Query(None),
    db:        Session       = Depends(get_db),
):
    """JSON version of rep activity — used by the RepActivity dashboard screen."""
    from calendar import monthrange
    visible_ids = _subordinate_ids(db, viewer_id) if viewer_id else None

    q = db.query(User).filter(User.role.in_(["rep", "custom", "associate"]))
    if visible_ids:
        q = q.filter(User.id.in_(visible_ids))
    reps = q.order_by(User.name).all()

    _, days_in_month = monthrange(year, month)
    week_ranges = [
        (1,  7,  "Week 1"),
        (8,  14, "Week 2"),
        (15, 21, "Week 3"),
        (22, days_in_month, "Week 4"),
    ]

    result = []
    for rep in reps:
        rep_weeks = []
        total_visits = 0
        total_sales_val = 0.0

        for wk_start, wk_end, wk_label in week_ranges:
            date_from = f"{year}-{month:02d}-{wk_start:02d}"
            date_to   = f"{year}-{month:02d}-{wk_end:02d}"

            visits = db.query(VisitLog).filter(
                VisitLog.associate_id == rep.id,
                func.date(VisitLog.visit_time) >= date_from,
                func.date(VisitLog.visit_time) <= date_to,
            ).all()

            visit_days     = len(set(str(v.visit_time.date()) for v in visits))
            uniq_doctors   = len(set(v.doctor_id for v in visits if v.doctor_id))
            uniq_hospitals = len(set(
                v.doctor.hospital for v in visits
                if v.doctor and v.doctor.hospital
            ))

            sales_rows = db.query(SalesEntry).filter(
                SalesEntry.associate_id == rep.id,
                SalesEntry.year  == year,
                SalesEntry.month == month,
                SalesEntry.week  >= wk_start,
                SalesEntry.week  <= wk_end,
            ).all()

            sales_entries = len(sales_rows)
            sales_value   = round(sum(s.value or 0 for s in sales_rows), 2)

            total_visits    += visit_days
            total_sales_val += sales_value

            rep_weeks.append({
                "week":            wk_label,
                "visit_days":      visit_days,
                "unique_hospitals": uniq_hospitals,
                "unique_doctors":  uniq_doctors,
                "sales_entries":   sales_entries,
                "sales_value":     sales_value,
            })

        result.append({
            "rep_id":        rep.id,
            "rep_name":      rep.name,
            "role":          rep.role,
            "total_visits":  total_visits,
            "total_sales":   round(total_sales_val, 2),
            "weeks":         rep_weeks,
        })

    return result
