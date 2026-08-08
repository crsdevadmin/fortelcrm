import calendar
import io
import json
from datetime import date as date_type, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
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
from .dashboard import _regional_mtd_entries, _regional_week_value, get_rep_scorecard
from .roi import get_commitment_recovery


router = APIRouter(prefix="/reports", tags=["Weekly Reports"])


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


def _score_people(base_rows, recovery_rows):
    recovery_by_owner = {}
    allowed_ids = {int(row["user_id"]) for row in base_rows}
    for recovery in recovery_rows:
        owner_id = int(recovery.get("manager_id") or 0)
        if owner_id not in allowed_ids:
            continue
        bucket = recovery_by_owner.setdefault(owner_id, {"expected": 0.0, "sales": 0.0, "at_risk": 0, "breached": 0})
        bucket["expected"] += float(recovery.get("expected_sales") or 0)
        bucket["sales"] += float(recovery.get("sales_captured") or 0)
        if recovery.get("worst_status") == "At Risk":
            bucket["at_risk"] += 1
        elif recovery.get("worst_status") == "Breached":
            bucket["breached"] += 1

    def cap100(value):
        return max(0.0, min(100.0, float(value or 0)))

    output = []
    for row in base_rows:
        doctor_pct = (
            float(row["doctor_sales"] or 0) / max(float(row["doctor_target"] or 0), 1) * 100
            if row["doctor_target_available"] else 50.0 if row["doctor_count"] else 100.0
        )
        regional_pct = (
            float(row["regional_sales"] or 0) / max(float(row["regional_target"] or 0), 1) * 100
            if row["regional_target_available"] else 50.0
        ) if row["regional_required"] else 100.0
        recovery = recovery_by_owner.get(int(row["user_id"]), {"expected": 0.0, "sales": 0.0, "at_risk": 0, "breached": 0})
        recovery_pct = recovery["sales"] / recovery["expected"] * 100 if recovery["expected"] else 100.0
        expected = int(row["weekly_expected"] or 0)
        weekly_score = (
            int(row["weekly_submitted"] or 0) / expected * 60
            + int(row["weekly_pdf_uploaded"] or 0) / expected * 20
            + int(row["weekly_pdf_matched"] or 0) / expected * 20
        ) if expected else 100.0
        task_score = (
            int(row["task_completed"] or 0) / int(row["task_total"] or 1) * 100
            if int(row["task_total"] or 0) else 100.0
        )
        score = round(
            cap100(doctor_pct) * .25 + cap100(regional_pct) * .20 + cap100(recovery_pct) * .20
            + cap100(row["visit_coverage_pct"]) * .15 + cap100(weekly_score) * .10 + cap100(task_score) * .10
        )
        reasons = []
        if row["doctor_count"] and not row["doctor_target_available"]:
            reasons.append("Doctor target not set")
        elif row["doctor_target_available"] and doctor_pct < 80:
            reasons.append("Doctor sales below target")
        if row["regional_required"] and not row["regional_target_available"]:
            reasons.append("Regional target not set")
        elif row["regional_required"] and regional_pct < 80:
            reasons.append("Regional sales below target")
        if recovery["breached"]:
            reasons.append(f"{recovery['breached']} recovery breached")
        elif recovery["at_risk"]:
            reasons.append(f"{recovery['at_risk']} recovery at risk")
        if row["doctor_count"] and float(row["visit_coverage_pct"] or 0) < 60:
            reasons.append("Low visit coverage")
        if expected > int(row["weekly_submitted"] or 0):
            reasons.append("Weekly update missing")
        if int(row["weekly_submitted"] or 0) > int(row["weekly_pdf_uploaded"] or 0):
            reasons.append("Weekly PDF missing")
        if int(row["weekly_pdf_uploaded"] or 0) > int(row["weekly_pdf_matched"] or 0):
            reasons.append("PDF mismatch")
        if int(row["overdue_tasks"] or 0):
            reasons.append(f"{row['overdue_tasks']} overdue tasks")
        pending = int(row["pending_investments"] or 0) + int(row["pending_sales"] or 0)
        if pending:
            reasons.append(f"{pending} pending approvals")
        critical = recovery["breached"] or int(row["overdue_tasks"] or 0) or score < 50
        output.append({
            **row,
            "score": score,
            "status": "red" if critical else "amber" if score < 75 or reasons else "green",
            "doctor_sales_pct": round(doctor_pct, 1),
            "regional_sales_pct": round(regional_pct, 1),
            "recovery_expected": round(recovery["expected"], 2),
            "recovery_sales": round(recovery["sales"], 2),
            "recovery_pct": round(recovery_pct, 1),
            "recovery_at_risk": recovery["at_risk"],
            "recovery_breached": recovery["breached"],
            "weekly_score": round(cap100(weekly_score)),
            "task_score": round(cap100(task_score)),
            "reasons": reasons,
        })
    return sorted(output, key=lambda row: (-row["score"], row["name"]))


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
    recovery = get_commitment_recovery(viewer_id=viewer_id, as_of=report_end.isoformat(), db=db)
    people = _score_people(scorecard.get("rows", []), recovery.get("doctor_summary", []))

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
        or_(
            (SalesEntry.sale_date >= start.isoformat()) & (SalesEntry.sale_date <= report_end.isoformat()),
            (SalesEntry.sale_date.is_(None)) & (SalesEntry.week >= start.day) & (SalesEntry.week <= report_end.day),
        ),
    ) if doctor_ids else None
    week_sales = sales_q.all() if sales_q is not None else []
    mtd_sales = db.query(SalesEntry).filter(
        SalesEntry.doctor_id.in_(doctor_ids),
        SalesEntry.year == year,
        SalesEntry.month == month,
        or_(SalesEntry.sale_date <= report_end.isoformat(), (SalesEntry.sale_date.is_(None)) & (SalesEntry.week <= report_end.day)),
    ).all() if doctor_ids else []
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
        for reason in person["reasons"]:
            actions.append({"person": person["name"], "reason": reason, "status": person["status"]})
    status_counts = {
        "green": sum(1 for person in people if person["status"] == "green"),
        "amber": sum(1 for person in people if person["status"] == "amber"),
        "red": sum(1 for person in people if person["status"] == "red"),
    }
    summary = {
        "regional_week": round(sum(row["regional_week"] for row in territory_rows), 2),
        "regional_mtd": round(sum(row["regional_mtd"] for row in territory_rows), 2),
        "doctor_week": round(sum(float(sale.value or 0) for sale in week_sales), 2),
        "doctor_mtd": round(sum(float(sale.value or 0) for sale in mtd_sales), 2),
        "investment_week": round(sum(float(inv.amount or 0) for inv in week_investments), 2),
        "visits_week": len(visits),
        "tasks_completed": completed_tasks,
        "tasks_total": len(task_rows),
        "overdue_tasks": overdue_tasks,
        "people": len(people),
        "actions": len(actions),
        "status_counts": status_counts,
    }
    return {
        "title": "Weekly Management Report",
        "viewer": {"id": viewer.id, "name": viewer.name, "role": viewer.display_role},
        "scope": scope,
        "year": year,
        "month": month,
        "week": week,
        "week_start": start.isoformat(),
        "week_end": report_end.isoformat(),
        "generated_at": datetime.utcnow().isoformat(),
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
    ).first()
    if record and not refresh:
        payload = json.loads(record.payload_json)
    else:
        payload = build_weekly_payload(viewer_id, year, month, week, normalized_scope, db)
        if record:
            record.payload_json = json.dumps(payload)
            record.week_start = payload["week_start"]
            record.week_end = payload["week_end"]
            record.updated_at = datetime.utcnow()
        else:
            record = WeeklyManagementReport(
                viewer_id=viewer_id,
                scope=normalized_scope,
                year=year,
                month=month,
                week=week,
                week_start=payload["week_start"],
                week_end=payload["week_end"],
                payload_json=json.dumps(payload),
            )
            db.add(record)
        db.commit()
        db.refresh(record)
    return {"report_id": record.id, "saved_at": record.updated_at.isoformat(), **payload}


@router.get("/weekly")
def get_weekly_report(
    viewer_id: int,
    year: int,
    month: int,
    week: int,
    scope: str = "overall",
    refresh: bool = False,
    db: Session = Depends(get_db),
):
    return save_weekly_report(viewer_id, year, month, week, scope, db, refresh=refresh)


@router.get("/weekly/history")
def get_weekly_report_history(viewer_id: int, scope: str = "overall", limit: int = 24, db: Session = Depends(get_db)):
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
    ).limit(min(max(limit, 1), 100)).all()
    output = []
    for record in records:
        payload = json.loads(record.payload_json)
        output.append({
            "report_id": record.id,
            "year": record.year,
            "month": record.month,
            "week": record.week,
            "scope": record.scope,
            "week_start": record.week_start,
            "week_end": record.week_end,
            "saved_at": record.updated_at.isoformat(),
            "summary": payload.get("summary", {}),
        })
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

    territory_data = [["Territory", "Regional Week", "Regional MTD", "Doctor Week", "Doctor MTD", "Investment", "Visits", "Doctors"]]
    for row in payload.get("territories", []):
        territory_data.append([
            row["territory"], _fmt_money(row["regional_week"]), _fmt_money(row["regional_mtd"]),
            _fmt_money(row["doctor_week"]), _fmt_money(row["doctor_mtd"]), _fmt_money(row["investment_week"]),
            row["visits_week"], row["active_doctors"],
        ])
    territory_table = Table(territory_data, repeatRows=1, colWidths=[38 * mm, 31 * mm, 31 * mm, 31 * mm, 31 * mm, 30 * mm, 20 * mm, 20 * mm])
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
            index, Paragraph(person["name"], styles["Small"]), person["score"], person["status"].upper(),
            f"{person['doctor_sales_pct']}%", "N/A" if not person["regional_required"] else f"{person['regional_sales_pct']}%",
            "N/A" if not person["recovery_expected"] else f"{person['recovery_pct']}%", f"{person['visit_coverage_pct']}%",
            f"{person['weekly_score']}%", f"{person['task_score']}%",
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
        action_data = [["Priority", "Person", "Required Action"]]
        for action in payload["actions"]:
            action_data.append([action["status"].upper(), Paragraph(action["person"], styles["Small"]), Paragraph(action["reason"], styles["Small"])])
        action_table = Table(action_data, repeatRows=1, colWidths=[30 * mm, 65 * mm, 165 * mm])
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
def download_weekly_report_pdf(report_id: int, viewer_id: int, db: Session = Depends(get_db)):
    record = db.query(WeeklyManagementReport).filter(WeeklyManagementReport.id == report_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Weekly report not found")
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    if record.viewer_id != viewer_id and viewer.role not in {"admin", "md"}:
        raise HTTPException(status_code=403, detail="You cannot download this report")
    payload = json.loads(record.payload_json)
    filename = f"Fortel_Weekly_Report_{record.year}_{record.month:02d}_W{record.week}.pdf"
    return StreamingResponse(
        build_report_pdf(payload),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
