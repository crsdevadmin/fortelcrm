import calendar
import io
import json
from datetime import date as date_type, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth.auth import decode_token
from ..models.models import (
    DailyTask,
    Doctor,
    Investment,
    Product,
    RegionalSalesEntry,
    SalesEntry,
    User,
    VisitLog,
    WeeklyManagementReport,
)
from ..utils.hierarchy import get_dashboard_scope_ids
from ..utils.regional_territories import REGIONAL_TERRITORIES, TERRITORY_STATES, territory_for_city
from ..services.report_scoring import score_people
from .dashboard import _regional_mtd_entries, _regional_week_value, get_rep_scorecard
from .roi import get_commitment_recovery


router = APIRouter(prefix="/reports", tags=["Weekly Reports"])


def _require_report_viewer(authorization: Optional[str], viewer_id: int, db: Session) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    token = authorization.split(" ", 1)[1].strip()
    token_data = decode_token(token)
    try:
        authenticated_id = int(token_data.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid login token")
    if authenticated_id != viewer_id:
        raise HTTPException(status_code=403, detail="Report viewer does not match the logged-in user")
    viewer = db.query(User).filter(User.id == authenticated_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=401, detail="User account is not active")
    return viewer


def _week_dates(year: int, month: int, week: int):
    if month < 1 or month > 12 or week < 1 or week > 4:
        raise HTTPException(status_code=400, detail="Select a valid month and week")
    start_day = (week - 1) * 7 + 1
    end_day = calendar.monthrange(year, month)[1] if week == 4 else min(start_day + 6, calendar.monthrange(year, month)[1])
    return date_type(year, month, start_day), date_type(year, month, end_day)


def _fmt_money(value) -> str:
    amount = float(value or 0)
    if abs(amount) >= 10000000:
        return f"Rs.{amount / 10000000:.1f}Cr"
    if abs(amount) >= 100000:
        return f"Rs.{amount / 100000:.1f}L"
    if abs(amount) >= 1000:
        return f"Rs.{amount / 1000:.1f}K"
    return f"Rs.{amount:,.0f}"


def _pct_change(current, previous):
    current_value = float(current or 0)
    previous_value = float(previous or 0)
    if previous_value == 0:
        return None
    return round((current_value - previous_value) / abs(previous_value) * 100, 1)


def _attach_snapshot_comparisons(payload, viewer_id: int, scope: str, db: Session):
    records = db.query(WeeklyManagementReport).filter(
        WeeklyManagementReport.viewer_id == viewer_id,
        WeeklyManagementReport.scope == scope,
    ).order_by(
        WeeklyManagementReport.year.desc(),
        WeeklyManagementReport.month.desc(),
        WeeklyManagementReport.week.desc(),
        WeeklyManagementReport.version.desc(),
    ).limit(64).all()
    current_period = (int(payload["year"]), int(payload["month"]), int(payload["week"]))
    prior_payloads = []
    seen_periods = set()
    for record in records:
        record_period = (record.year, record.month, record.week)
        if record_period >= current_period or record_period in seen_periods:
            continue
        seen_periods.add(record_period)
        try:
            prior_payloads.append(json.loads(record.payload_json))
        except (TypeError, ValueError):
            continue

    summary = payload["summary"]
    metrics = (
        "regional_week", "doctor_week", "investment_week", "visits_week",
        "regional_sales_per_day", "doctor_sales_per_day",
    )
    previous = prior_payloads[0] if prior_payloads else None
    previous_summary = previous.get("summary", {}) if previous else {}
    current_days = max(int(summary.get("covered_days") or 1), 1)
    previous_days = max(int(previous_summary.get("covered_days") or 7), 1) if previous else None
    trends = {}
    for metric in metrics:
        current_value = float(summary.get(metric) or 0)
        prior_value = float(previous_summary.get(metric) or 0) if previous else None
        trailing = [current_value] + [float(item.get("summary", {}).get(metric) or 0) for item in prior_payloads[:3]]
        comparison_basis = "total"
        change_current = current_value
        change_previous = prior_value
        if (
            prior_value is not None
            and current_days != previous_days
            and metric in {"regional_week", "doctor_week", "investment_week", "visits_week"}
        ):
            comparison_basis = "per_day"
            change_current = current_value / current_days
            change_previous = prior_value / previous_days
        trends[metric] = {
            "current": round(current_value, 2),
            "previous": round(prior_value, 2) if prior_value is not None else None,
            "change_pct": _pct_change(change_current, change_previous) if prior_value is not None else None,
            "comparison_basis": comparison_basis,
            "four_week_average": round(sum(trailing) / len(trailing), 2),
        }
    total_business = float(summary.get("regional_week") or 0) + float(summary.get("doctor_week") or 0)
    prior_totals = [
        float(item.get("summary", {}).get("regional_week") or 0)
        + float(item.get("summary", {}).get("doctor_week") or 0)
        for item in prior_payloads[:11]
    ]
    summary["trends"] = trends
    summary["best_week_last_12"] = bool(prior_totals) and not payload.get("is_partial") and total_business >= max(prior_totals)
    payload["comparison"] = {
        "available": previous is not None,
        "previous_period": ({
            "year": previous.get("year"),
            "month": previous.get("month"),
            "week": previous.get("week"),
        } if previous else None),
        "basis": "stored_snapshot",
    }

    previous_people = {int(item["user_id"]): item for item in (previous.get("people", []) if previous else [])}
    movers = []
    newly_red = []
    for person in payload.get("people", []):
        prior = previous_people.get(int(person["user_id"]))
        if not prior or person.get("score") is None or prior.get("score") is None:
            continue
        delta = int(person["score"]) - int(prior["score"])
        movers.append({
            "user_id": person["user_id"], "name": person["name"],
            "score": person["score"], "previous_score": prior["score"], "change": delta,
        })
        if person.get("status") == "red" and prior.get("status") != "red":
            newly_red.append({"user_id": person["user_id"], "name": person["name"], "previous_status": prior.get("status")})
    payload["movers"] = sorted(movers, key=lambda item: abs(item["change"]), reverse=True)[:5]
    payload["newly_red"] = newly_red


def build_weekly_payload(viewer_id: int, year: int, month: int, week: int, scope: str, db: Session):
    start, end = _week_dates(year, month, week)
    today = date_type.today()
    if start > today:
        raise HTTPException(status_code=400, detail="This week has not started yet")
    report_end = min(end, today)
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    scope_ids = get_dashboard_scope_ids(viewer_id, scope, db)

    scorecard = get_rep_scorecard(
        viewer_id=viewer_id, year=year, month=month, scope=scope,
        as_of=report_end.isoformat(), submission_year=year,
        submission_month=month, submission_week=week, db=db,
    )
    recovery = get_commitment_recovery(
        viewer_id=viewer_id,
        as_of=report_end.isoformat(),
        current_user=viewer,
        db=db,
    )
    people = score_people(scorecard.get("rows", []), recovery.get("doctor_summary", []))

    doctors = db.query(Doctor).filter(Doctor.manager_id.in_(scope_ids), Doctor.is_active != False).all() if scope_ids else []
    doctor_map = {doctor.id: doctor for doctor in doctors}
    doctor_ids = list(doctor_map)
    territories = {
        territory: {
            "territory": territory,
            "state_code": TERRITORY_STATES[territory],
            "regional_week": 0.0,
            "regional_mtd": 0.0,
            "doctor_week": 0.0,
            "doctor_mtd": 0.0,
            "investment_week": 0.0,
            "visits_week": 0,
            "active_doctors": 0,
        }
        for territory in REGIONAL_TERRITORIES
    }
    for doctor in doctors:
        territory = territory_for_city(doctor.city, doctor.manager_id)
        if territory:
            territories[territory]["active_doctors"] += 1

    sales_q = db.query(SalesEntry).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
        SalesEntry.sale_date.isnot(None),
        SalesEntry.sale_date >= start.isoformat(),
        SalesEntry.sale_date <= report_end.isoformat(),
    ) if doctor_ids else None
    week_sales = sales_q.all() if sales_q is not None else []
    mtd_sales = db.query(SalesEntry).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
        or_(SalesEntry.sale_date <= report_end.isoformat(), SalesEntry.sale_date.is_(None)),
    ).all() if doctor_ids else []
    legacy_monthly_sales = [sale for sale in mtd_sales if not sale.sale_date]
    for sale in week_sales:
        doctor = doctor_map.get(sale.doctor_id)
        territory = territory_for_city(doctor.city, doctor.manager_id) if doctor else None
        if territory:
            territories[territory]["doctor_week"] += float(sale.value or 0)
    for sale in mtd_sales:
        doctor = doctor_map.get(sale.doctor_id)
        territory = territory_for_city(doctor.city, doctor.manager_id) if doctor else None
        if territory:
            territories[territory]["doctor_mtd"] += float(sale.value or 0)

    regional_entries = db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id.in_(scope_ids),
        RegionalSalesEntry.year == year,
        RegionalSalesEntry.month == month,
        RegionalSalesEntry.week <= week,
    ).all() if scope_ids else []
    for territory in REGIONAL_TERRITORIES:
        territory_entries = [
            entry for entry in regional_entries
            if territory_for_city(entry.city, entry.associate_id) == territory
        ]
        territories[territory]["regional_week"] = _regional_week_value(territory_entries, year, month, week)
        territories[territory]["regional_mtd"] = sum(
            float(entry.value or 0)
            for entry in _regional_mtd_entries(territory_entries, year, month, week)
        )

    week_investments = db.query(Investment).filter(
        Investment.doctor_id.in_(doctor_ids),
        Investment.year == year,
        Investment.month == month,
        Investment.week == week,
    ).all() if doctor_ids else []
    for investment in week_investments:
        doctor = doctor_map.get(investment.doctor_id)
        territory = territory_for_city(doctor.city, doctor.manager_id) if doctor else None
        if territory:
            territories[territory]["investment_week"] += float(investment.amount or 0)

    visits = db.query(VisitLog).filter(
        VisitLog.doctor_id.in_(doctor_ids),
        VisitLog.visit_time >= datetime.combine(start, datetime.min.time()),
        VisitLog.visit_time <= datetime.combine(report_end, datetime.max.time()),
    ).all() if doctor_ids else []
    for visit in visits:
        doctor = doctor_map.get(visit.doctor_id)
        territory = territory_for_city(doctor.city, doctor.manager_id) if doctor else None
        if territory:
            territories[territory]["visits_week"] += 1

    territory_rows = []
    for row in territories.values():
        if any(float(row[key] or 0) > 0 for key in ("regional_week", "regional_mtd", "doctor_week", "doctor_mtd", "investment_week", "visits_week", "active_doctors")) or viewer.role in {"admin", "md"}:
            for key in ("regional_week", "regional_mtd", "doctor_week", "doctor_mtd", "investment_week"):
                row[key] = round(float(row[key]), 2)
            row["roi_week"] = round(row["doctor_week"] / row["investment_week"], 2) if row["investment_week"] else None
            territory_rows.append(row)

    task_rows = db.query(DailyTask).filter(
        DailyTask.assigned_to_id.in_(scope_ids),
        DailyTask.task_date >= start.isoformat(),
        DailyTask.task_date <= report_end.isoformat(),
    ).all() if scope_ids else []
    completed_tasks = sum(1 for task in task_rows if task.status == "completed")
    overdue_tasks = sum(1 for task in task_rows if task.status != "completed" and task.task_date < today.isoformat())

    top_doctor_rows = db.query(
        Doctor.id, Doctor.name, Doctor.city, func.sum(SalesEntry.value).label("sales")
    ).join(SalesEntry, SalesEntry.doctor_id == Doctor.id).filter(
        Doctor.id.in_(doctor_ids),
        SalesEntry.id.in_([sale.id for sale in week_sales]),
    ).group_by(Doctor.id, Doctor.name, Doctor.city).order_by(func.sum(SalesEntry.value).desc()).limit(5).all() if week_sales else []
    top_product_rows = db.query(
        Product.id, Product.name, func.sum(SalesEntry.value).label("sales"), func.sum(SalesEntry.qty).label("qty")
    ).join(SalesEntry, SalesEntry.product_id == Product.id).filter(
        SalesEntry.id.in_([sale.id for sale in week_sales]),
    ).group_by(Product.id, Product.name).order_by(func.sum(SalesEntry.value).desc()).limit(5).all() if week_sales else []

    actions = []
    for person in people:
        for detail in person.get("reason_details", []):
            actions.append({
                "person": person["name"],
                "user_id": person["user_id"],
                "reason": detail["reason"],
                "metric": detail["metric"],
                "gap_value": detail["gap_value"],
                "gap_unit": detail.get("gap_unit"),
                "current_value": detail.get("current_value"),
                "target_value": detail.get("target_value"),
                "status": person["status"],
            })
    action_status_priority = {"red": 0, "amber": 1, "green": 2, "unassigned": 3}
    actions.sort(key=lambda item: (
        0 if item.get("gap_unit") == "currency" else 1,
        -float(item["gap_value"] or 0),
        action_status_priority.get(item["status"], 9),
        item["person"],
    ))
    status_counts = {
        "green": sum(1 for person in people if person["status"] == "green"),
        "amber": sum(1 for person in people if person["status"] == "amber"),
        "red": sum(1 for person in people if person["status"] == "red"),
        "unassigned": sum(1 for person in people if person["status"] == "unassigned"),
    }
    target_value = sum(
        (float(person.get("doctor_target") or 0) if person.get("doctor_target_available") else 0)
        + (float(person.get("regional_target") or 0) if person.get("regional_target_available") else 0)
        for person in people
    )
    target_sales = sum(
        (float(person.get("doctor_sales") or 0) if person.get("doctor_target_available") else 0)
        + (float(person.get("regional_sales") or 0) if person.get("regional_target_available") else 0)
        for person in people
    )
    summary = {
        "regional_week": round(sum(row["regional_week"] for row in territory_rows), 2),
        "regional_mtd": round(sum(row["regional_mtd"] for row in territory_rows), 2),
        "doctor_week": round(sum(float(sale.value or 0) for sale in week_sales), 2),
        "doctor_mtd": round(sum(float(sale.value or 0) for sale in mtd_sales), 2),
        "legacy_monthly_unallocated": round(sum(float(sale.value or 0) for sale in legacy_monthly_sales), 2),
        "investment_week": round(sum(float(inv.amount or 0) for inv in week_investments), 2),
        "visits_week": len(visits),
        "tasks_completed": completed_tasks,
        "tasks_total": len(task_rows),
        "overdue_tasks": overdue_tasks,
        "people": len(people),
        "actions": len(actions),
        "value_at_risk": round(sum(
            float(action["gap_value"] or 0)
            for action in actions if action.get("gap_unit") == "currency"
        ), 2),
        "target_value": round(target_value, 2),
        "sales_against_target": round(target_sales, 2),
        "target_attainment_pct": round(target_sales / target_value * 100, 1) if target_value else None,
        "status_counts": status_counts,
    }
    covered_days = max((report_end - start).days + 1, 1)
    summary["covered_days"] = covered_days
    summary["regional_sales_per_day"] = round(summary["regional_week"] / covered_days, 2)
    summary["doctor_sales_per_day"] = round(summary["doctor_week"] / covered_days, 2)
    summary["roi_week"] = round(summary["doctor_week"] / summary["investment_week"], 2) if summary["investment_week"] else None
    return {
        "title": "Weekly Management Report",
        "viewer": {"id": viewer.id, "name": viewer.name, "role": viewer.display_role},
        "scope": scope,
        "year": year,
        "month": month,
        "week": week,
        "week_start": start.isoformat(),
        "week_end": report_end.isoformat(),
        "period_end": end.isoformat(),
        "covers_through": report_end.isoformat(),
        "is_partial": report_end < end,
        "data_warnings": ([{
            "code": "legacy_monthly_unallocated",
            "message": "Legacy doctor sales without a sale date are included in MTD only and cannot be allocated to a week.",
            "value": summary["legacy_monthly_unallocated"],
        }] if legacy_monthly_sales else []),
        "generated_at": datetime.utcnow().isoformat(),
        "report_schema_version": 2,
        "summary": summary,
        "territories": territory_rows,
        "people": people,
        "actions": actions,
        "top_doctors": [{"name": row.name, "city": row.city, "sales": round(float(row.sales or 0), 2)} for row in top_doctor_rows],
        "top_products": [{"name": row.name, "sales": round(float(row.sales or 0), 2), "qty": round(float(row.qty or 0), 2)} for row in top_product_rows],
    }


def save_weekly_report(viewer_id: int, year: int, month: int, week: int, scope: str, db: Session, refresh: bool = False):
    normalized_scope = (scope or "overall").strip().lower()
    if normalized_scope not in {"overall", "mine", "team"}:
        raise HTTPException(status_code=400, detail="Invalid report scope")
    record = db.query(WeeklyManagementReport).filter(
        WeeklyManagementReport.viewer_id == viewer_id,
        WeeklyManagementReport.scope == normalized_scope,
        WeeklyManagementReport.year == year,
        WeeklyManagementReport.month == month,
        WeeklyManagementReport.week == week,
    ).order_by(WeeklyManagementReport.version.desc(), WeeklyManagementReport.id.desc()).first()
    payload = json.loads(record.payload_json) if record and not refresh else None
    if payload and payload.get("is_partial"):
        _, true_period_end = _week_dates(year, month, week)
        expected_cover = min(true_period_end, date_type.today()).isoformat()
        if (payload.get("covers_through") or payload.get("week_end") or "") < expected_cover:
            refresh = True
    if payload is None or refresh:
        payload = build_weekly_payload(viewer_id, year, month, week, normalized_scope, db)
        _attach_snapshot_comparisons(payload, viewer_id, normalized_scope, db)
        next_version = int(record.version or 1) + 1 if record else 1
        record = WeeklyManagementReport(
            viewer_id=viewer_id,
            scope=normalized_scope,
            year=year,
            month=month,
            week=week,
            version=next_version,
            week_start=payload["week_start"],
            week_end=payload["week_end"],
            payload_json=json.dumps(payload),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    return {"report_id": record.id, "version": record.version, "saved_at": record.updated_at.isoformat(), **payload}


@router.get("/weekly")
def get_weekly_report(
    viewer_id: int,
    year: int,
    month: int,
    week: int,
    scope: str = "overall",
    refresh: bool = False,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _require_report_viewer(authorization, viewer_id, db)
    return save_weekly_report(viewer_id, year, month, week, scope, db, refresh=refresh)


@router.get("/weekly/history")
def get_weekly_report_history(
    viewer_id: int,
    scope: str = "overall",
    limit: int = 24,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _require_report_viewer(authorization, viewer_id, db)
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    records = db.query(WeeklyManagementReport).filter(
        WeeklyManagementReport.viewer_id == viewer_id,
        WeeklyManagementReport.scope == scope,
    ).order_by(
        WeeklyManagementReport.year.desc(),
        WeeklyManagementReport.month.desc(),
        WeeklyManagementReport.week.desc(),
        WeeklyManagementReport.version.desc(),
    ).limit(min(max(limit * 4, 4), 400)).all()
    output = []
    seen_periods = set()
    for record in records:
        period = (record.year, record.month, record.week)
        if period in seen_periods:
            continue
        seen_periods.add(period)
        payload = json.loads(record.payload_json)
        output.append({
            "report_id": record.id,
            "year": record.year,
            "month": record.month,
            "week": record.week,
            "version": record.version,
            "scope": record.scope,
            "week_start": record.week_start,
            "week_end": record.week_end,
            "saved_at": record.updated_at.isoformat(),
            "summary": payload.get("summary", {}),
        })
        if len(output) >= min(max(limit, 1), 100):
            break
    return output


def build_report_pdf(payload: dict) -> io.BytesIO:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        raise HTTPException(status_code=503, detail="PDF generator is not installed")

    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], textColor=colors.HexColor("#0F5132"), fontSize=22, leading=26, alignment=TA_CENTER))
    styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], textColor=colors.HexColor("#0F5132"), fontSize=13, leading=16, spaceBefore=8, spaceAfter=7))
    styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontSize=8, leading=10))
    styles.add(ParagraphStyle(name="SmallRight", parent=styles["BodyText"], fontSize=8, leading=10, alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name="Warning", parent=styles["BodyText"], fontSize=9, leading=12, textColor=colors.HexColor("#92400E"), backColor=colors.HexColor("#FFFBEB"), borderColor=colors.HexColor("#FDE68A"), borderWidth=.5, borderPadding=6))
    page_size = landscape(A4)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D1D5DB"))
        canvas.line(15 * mm, 11 * mm, page_size[0] - 15 * mm, 11 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#6B7280"))
        canvas.drawString(15 * mm, 7 * mm, "Fortel Life Sciences - Confidential")
        canvas.drawRightString(page_size[0] - 15 * mm, 7 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buffer, pagesize=page_size, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=13 * mm, bottomMargin=16 * mm)
    story = [
        Paragraph("FORTEL LIFE SCIENCES", styles["ReportTitle"]),
        Paragraph("Weekly Management Report", ParagraphStyle(name="Subtitle", parent=styles["Heading2"], alignment=TA_CENTER, textColor=colors.HexColor("#374151"))),
        Paragraph(
            f"{payload['week_start']} to {payload['week_end']} | Week {payload['week']} | {payload['scope'].title()} | Prepared for {payload['viewer']['name']}",
            ParagraphStyle(name="Meta", parent=styles["Small"], alignment=TA_CENTER, textColor=colors.HexColor("#6B7280")),
        ),
        Spacer(1, 8),
    ]
    if payload.get("is_partial"):
        story.extend([
            Paragraph(f"PARTIAL REPORT - covers through {payload.get('covers_through')}; full period ends {payload.get('period_end')}", styles["Warning"]),
            Spacer(1, 6),
        ])
    summary = payload["summary"]
    summary_data = [
        ["Regional Sales - Week", "Regional Sales - MTD", "Doctor Sales - Week", "Doctor Sales - MTD"],
        [_fmt_money(summary["regional_week"]), _fmt_money(summary["regional_mtd"]), _fmt_money(summary["doctor_week"]), _fmt_money(summary["doctor_mtd"])],
        ["Investment - Week", "Visits", "Tasks Completed", "Actions Required"],
        [_fmt_money(summary["investment_week"]), str(summary["visits_week"]), f"{summary['tasks_completed']} / {summary['tasks_total']}", str(summary["actions"])],
    ]
    summary_table = Table(summary_data, colWidths=[65 * mm] * 4)
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F5E9")),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#E8F5E9")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1F2937")),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([summary_table, Spacer(1, 10), Paragraph("Territory Performance", styles["Section"])])
    trend_rows = [["Metric", "Current", "Previous", "Change", "4-week average"]]
    trend_labels = {"regional_week": "Regional sales", "doctor_week": "Doctor sales", "investment_week": "Investment", "visits_week": "Visits"}
    for metric, label in trend_labels.items():
        trend = summary.get("trends", {}).get(metric, {})
        if not trend:
            continue
        money_metric = metric != "visits_week"
        trend_rows.append([
            label,
            _fmt_money(trend.get("current")) if money_metric else str(round(float(trend.get("current") or 0))),
            "N/A" if trend.get("previous") is None else _fmt_money(trend.get("previous")) if money_metric else str(round(float(trend.get("previous") or 0))),
            "N/A" if trend.get("change_pct") is None else f"{trend['change_pct']:+.1f}%",
            _fmt_money(trend.get("four_week_average")) if money_metric else str(round(float(trend.get("four_week_average") or 0), 1)),
        ])
    if len(trend_rows) > 1:
        trend_table = Table(trend_rows, repeatRows=1, colWidths=[52 * mm, 42 * mm, 42 * mm, 35 * mm, 45 * mm])
        trend_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F2937")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#D1D5DB")),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ]))
        story[-2:-2] = [Paragraph("Week-over-Week Comparison", styles["Section"]), trend_table, Spacer(1, 10)]

    territory_data = [["Territory", "Regional Week", "Regional MTD", "Doctor Week", "Doctor MTD", "Investment", "ROI", "Visits", "Doctors"]]
    for row in payload.get("territories", []):
        territory_data.append([
            row["territory"], _fmt_money(row["regional_week"]), _fmt_money(row["regional_mtd"]),
            _fmt_money(row["doctor_week"]), _fmt_money(row["doctor_mtd"]), _fmt_money(row["investment_week"]), "N/A" if row.get("roi_week") is None else f"{row['roi_week']}x",
            row["visits_week"], row["active_doctors"],
        ])
    territory_table = Table(territory_data, repeatRows=1, colWidths=[34 * mm, 28 * mm, 28 * mm, 28 * mm, 28 * mm, 27 * mm, 18 * mm, 18 * mm, 18 * mm])
    territory_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F5132")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#D1D5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([territory_table, Spacer(1, 10), Paragraph("Team Scorecard", styles["Section"])])

    people_data = [["Rank", "Person", "Score", "Status", "Doctor Sales", "Regional Sales", "Recovery", "Visits", "Weekly", "Tasks"]]
    for index, person in enumerate(payload.get("people", []), 1):
        people_data.append([
            "-" if person.get("score") is None else index, Paragraph(person["name"], styles["Small"]), "N/A" if person.get("score") is None else person["score"], person["status"].upper(),
            "N/A" if person.get("doctor_sales_pct") is None else f"{person['doctor_sales_pct']}%", "N/A" if person.get("regional_sales_pct") is None else f"{person['regional_sales_pct']}%",
            "N/A" if person.get("recovery_pct") is None else f"{person['recovery_pct']}%", "N/A" if person.get("visit_coverage_pct") is None else f"{person['visit_coverage_pct']}%",
            "N/A" if person.get("weekly_score") is None else f"{person['weekly_score']}%", "N/A" if person.get("task_score") is None else f"{person['task_score']}%",
        ])
    people_table = Table(people_data, repeatRows=1, colWidths=[12 * mm, 47 * mm, 17 * mm, 30 * mm, 28 * mm, 28 * mm, 24 * mm, 22 * mm, 22 * mm, 22 * mm])
    people_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#D1D5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("ALIGN", (2, 1), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([people_table, PageBreak(), Paragraph("Management Actions", styles["Section"])])
    if payload.get("actions"):
        action_data = [["Priority", "Person", "Required Action", "Gap"]]
        for action in payload["actions"]:
            gap = "-"
            if action.get("gap_value"):
                gap = _fmt_money(action["gap_value"]) if action.get("gap_unit") == "currency" else f"{action['gap_value']:g} item(s)"
            action_data.append([action["status"].upper(), Paragraph(action["person"], styles["Small"]), Paragraph(action["reason"], styles["Small"]), gap])
        action_table = Table(action_data, repeatRows=1, colWidths=[28 * mm, 55 * mm, 145 * mm, 35 * mm])
        action_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7F1D1D")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#D1D5DB")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FEF2F2")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(action_table)
    else:
        story.append(Paragraph("No immediate actions were identified for this report.", styles["BodyText"]))

    doctor_section = [Spacer(1, 12), Paragraph("Top Doctors", styles["Section"])]
    for index, row in enumerate(payload.get("top_doctors", []), 1):
        doctor_section.append(Paragraph(f"{index}. {row['name']} ({row.get('city') or '-'}) - {_fmt_money(row['sales'])}", styles["Small"]))
    story.append(KeepTogether(doctor_section))
    product_section = [Spacer(1, 8), Paragraph("Top Products", styles["Section"])]
    for index, row in enumerate(payload.get("top_products", []), 1):
        product_section.append(Paragraph(f"{index}. {row['name']} - {_fmt_money(row['sales'])} | Qty {row['qty']}", styles["Small"]))
    story.append(KeepTogether(product_section))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return buffer


@router.get("/weekly/{report_id}/pdf")
def download_weekly_report_pdf(
    report_id: int,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    record = db.query(WeeklyManagementReport).filter(WeeklyManagementReport.id == report_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Weekly report not found")
    _require_report_viewer(authorization, record.viewer_id, db)
    payload = json.loads(record.payload_json)
    filename = f"Fortel_Weekly_Report_{record.year}_{record.month:02d}_W{record.week}.pdf"
    return StreamingResponse(
        build_report_pdf(payload),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
