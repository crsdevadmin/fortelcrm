import calendar
from datetime import date as date_type, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import (
    DailyTask,
    Doctor,
    Investment,
    RegionalSalesEntry,
    RegionalSalesWeekPDF,
    SalesEntry,
    User,
    UserRegionalTerritory,
    VisitLog,
)
from ..utils.hierarchy import get_dashboard_scope_ids
from ..utils.regional_territories import TERRITORY_STATES, infer_user_territory


router = APIRouter(prefix="/targets", tags=["Dashboard"])


def _previous_regional_week(ref_date: date_type):
    current_week = min(4, max(1, ((ref_date.day - 1) // 7) + 1))
    if current_week > 1:
        return ref_date.year, ref_date.month, current_week - 1
    previous_month = ref_date.month - 1
    previous_year = ref_date.year
    if previous_month == 0:
        previous_month = 12
        previous_year -= 1
    return previous_year, previous_month, 4


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


@router.get("/action-center")
def get_action_center(
    viewer_id: int,
    scope: str = "overall",
    state_code: Optional[str] = None,
    city: Optional[str] = None,
    today: Optional[str] = None,
    db: Session = Depends(get_db),
):
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    normalized_scope = (scope or "overall").strip().lower()
    if normalized_scope not in {"overall", "mine", "team"}:
        raise HTTPException(status_code=400, detail="Invalid dashboard scope")
    try:
        ref_date = datetime.strptime(today, "%Y-%m-%d").date() if today else date_type.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="today must be YYYY-MM-DD")

    scope_ids = get_dashboard_scope_ids(viewer_id, normalized_scope, db)
    state_keys = _state_keys(state_code)
    items = []
    if not scope_ids:
        return {"scope": normalized_scope, "items": [], "summary": {"urgent": 0, "attention": 0, "info": 0}}

    users = db.query(User).filter(User.id.in_(scope_ids), User.is_active == True, User.role.notin_(["admin", "md"])).all()
    user_map = {user.id: user for user in users}

    # Previous completed regional-sales week.
    week_year, week_month, week_number = _previous_regional_week(ref_date)
    territory_rows = db.query(UserRegionalTerritory.user_id, UserRegionalTerritory.territory).filter(
        UserRegionalTerritory.user_id.in_(scope_ids)
    ).all()
    territories_by_user = {}
    for user_id, territory in territory_rows:
        territories_by_user.setdefault(user_id, set()).add(territory)
    historical_regional_users = {
        row.associate_id
        for row in db.query(RegionalSalesEntry.associate_id)
        .filter(RegionalSalesEntry.associate_id.in_(scope_ids))
        .distinct().all()
    }
    candidates = []
    for user in users:
        territories = territories_by_user.get(user.id, set())
        inferred = infer_user_territory(user)
        if inferred:
            territories = set(territories) | {inferred}
        if not territories and user.id not in historical_regional_users:
            continue
        if state_keys and territories and not any(
            "".join(TERRITORY_STATES.get(territory, "").upper().split()) in state_keys
            for territory in territories
        ):
            continue
        if city and city not in territories:
            continue
        candidates.append(user)

    submitted_user_ids = {
        row.associate_id
        for row in db.query(RegionalSalesEntry.associate_id).filter(
            RegionalSalesEntry.associate_id.in_([user.id for user in candidates]),
            RegionalSalesEntry.year == week_year,
            RegionalSalesEntry.month == week_month,
            RegionalSalesEntry.week == week_number,
        ).distinct().all()
    } if candidates else set()
    missing_users = [user for user in candidates if user.id not in submitted_user_ids]
    if missing_users:
        items.append({
            "id": "missing-regional-update",
            "type": "regional_update",
            "severity": "warning",
            "title": f"{len(missing_users)} weekly regional update{'s' if len(missing_users) != 1 else ''} missing",
            "detail": f"Week {week_number} · {calendar.month_abbr[week_month]} {week_year}",
            "count": len(missing_users),
            "names": [user.name for user in missing_users[:4]],
            "action_path": "/regional-sales",
        })

    entry_groups = db.query(
        RegionalSalesEntry.associate_id,
        RegionalSalesEntry.state_code,
        RegionalSalesEntry.city,
    ).filter(
        RegionalSalesEntry.associate_id.in_(scope_ids),
        RegionalSalesEntry.year == week_year,
        RegionalSalesEntry.month == week_month,
        RegionalSalesEntry.week == week_number,
    )
    if state_keys:
        entry_groups = entry_groups.filter(
            func.upper(func.replace(RegionalSalesEntry.state_code, " ", "")).in_(state_keys)
        )
    if city:
        entry_groups = entry_groups.filter(RegionalSalesEntry.city.ilike(city.strip()))
    entry_groups = entry_groups.distinct().all()

    pdf_rows = db.query(RegionalSalesWeekPDF).filter(
        RegionalSalesWeekPDF.associate_id.in_(scope_ids),
        RegionalSalesWeekPDF.year == week_year,
        RegionalSalesWeekPDF.month == week_month,
        RegionalSalesWeekPDF.week == week_number,
    ).all()
    pdf_by_group = {}
    for pdf in pdf_rows:
        key = (pdf.associate_id, (pdf.state_code or "").strip().lower(), (pdf.city or "").strip().lower())
        pdf_by_group.setdefault(key, []).append(pdf)

    missing_pdf_groups = []
    mismatch_groups = []
    for group in entry_groups:
        key = (group.associate_id, (group.state_code or "").strip().lower(), (group.city or "").strip().lower())
        group_pdfs = pdf_by_group.get(key, [])
        label = f"{user_map.get(group.associate_id).name if user_map.get(group.associate_id) else 'User'} · {group.city}"
        if not group_pdfs:
            missing_pdf_groups.append(label)
        elif not any(pdf.matches for pdf in group_pdfs):
            mismatch_groups.append(label)
    if missing_pdf_groups:
        items.append({
            "id": "missing-week-pdf",
            "type": "weekly_pdf",
            "severity": "warning",
            "title": f"{len(missing_pdf_groups)} weekly PDF upload{'s' if len(missing_pdf_groups) != 1 else ''} missing",
            "detail": f"Regional entries exist for Week {week_number}",
            "count": len(missing_pdf_groups),
            "names": missing_pdf_groups[:4],
            "action_path": "/regional-sales",
        })
    if mismatch_groups:
        items.append({
            "id": "pdf-mismatch",
            "type": "weekly_pdf",
            "severity": "critical",
            "title": f"{len(mismatch_groups)} regional PDF mismatch{'es' if len(mismatch_groups) != 1 else ''}",
            "detail": "Entered sales and uploaded PDF totals do not match",
            "count": len(mismatch_groups),
            "names": mismatch_groups[:4],
            "action_path": "/regional-sales",
        })

    # Daily tasks assigned to people in the selected ownership scope.
    open_task_q = db.query(DailyTask).join(Doctor, DailyTask.doctor_id == Doctor.id).filter(
        DailyTask.assigned_to_id.in_(scope_ids),
        DailyTask.status != "completed",
    )
    if state_keys:
        open_task_q = open_task_q.filter(func.upper(func.replace(Doctor.state_code, " ", "")).in_(state_keys))
    if city:
        open_task_q = open_task_q.filter(Doctor.city.ilike(city.strip()))
    open_tasks = open_task_q.all()
    overdue_tasks = [task for task in open_tasks if task.task_date < ref_date.isoformat()]
    unread_tasks = [task for task in open_tasks if task.read_at is None]
    if overdue_tasks:
        names = []
        for task in overdue_tasks:
            assignee = user_map.get(task.assigned_to_id)
            if assignee and assignee.name not in names:
                names.append(assignee.name)
        items.append({
            "id": "overdue-tasks",
            "type": "task",
            "severity": "critical",
            "title": f"{len(overdue_tasks)} overdue task{'s' if len(overdue_tasks) != 1 else ''}",
            "detail": "Assigned work has passed its due date",
            "count": len(overdue_tasks),
            "names": names[:4],
            "action_path": "/tasks",
        })
    if unread_tasks:
        names = []
        for task in unread_tasks:
            assignee = user_map.get(task.assigned_to_id)
            if assignee and assignee.name not in names:
                names.append(assignee.name)
        items.append({
            "id": "unread-tasks",
            "type": "task",
            "severity": "info",
            "title": f"{len(unread_tasks)} assigned task{'s' if len(unread_tasks) != 1 else ''} not read",
            "detail": "The assignee has not opened the task yet",
            "count": len(unread_tasks),
            "names": names[:4],
            "action_path": "/tasks",
        })

    # Pending approvals follow doctor ownership so manager-entered records are
    # still attributed to the representative who owns the doctor.
    pending_investment_q = db.query(Investment).join(Doctor, Investment.doctor_id == Doctor.id).filter(
        Doctor.manager_id.in_(scope_ids),
        Investment.is_approved == False,
    )
    pending_sales_q = db.query(SalesEntry).join(Doctor, SalesEntry.doctor_id == Doctor.id).filter(
        Doctor.manager_id.in_(scope_ids),
        SalesEntry.approved_by_id.is_(None),
        SalesEntry.year == ref_date.year,
        SalesEntry.month == ref_date.month,
    )
    if state_keys:
        state_filter = func.upper(func.replace(Doctor.state_code, " ", "")).in_(state_keys)
        pending_investment_q = pending_investment_q.filter(state_filter)
        pending_sales_q = pending_sales_q.filter(state_filter)
    if city:
        pending_investment_q = pending_investment_q.filter(Doctor.city.ilike(city.strip()))
        pending_sales_q = pending_sales_q.filter(Doctor.city.ilike(city.strip()))
    pending_investments = pending_investment_q.count()
    pending_sales = pending_sales_q.count()
    if pending_investments or pending_sales:
        detail_parts = []
        if pending_investments:
            detail_parts.append(f"{pending_investments} investment")
        if pending_sales:
            detail_parts.append(f"{pending_sales} doctor-sales entries")
        items.append({
            "id": "pending-approvals",
            "type": "approval",
            "severity": "warning",
            "title": f"{pending_investments + pending_sales} record{'s' if pending_investments + pending_sales != 1 else ''} awaiting approval",
            "detail": " · ".join(detail_parts),
            "count": pending_investments + pending_sales,
            "names": [],
            "action_path": "/investment-roi",
        })

    # Doctor coverage: active doctors never visited or not visited in 30 days.
    doctor_q = db.query(Doctor).filter(Doctor.manager_id.in_(scope_ids), Doctor.is_active != False)
    if state_keys:
        doctor_q = doctor_q.filter(func.upper(func.replace(Doctor.state_code, " ", "")).in_(state_keys))
    if city:
        doctor_q = doctor_q.filter(Doctor.city.ilike(city.strip()))
    doctors = doctor_q.all()
    doctor_ids = [doctor.id for doctor in doctors]
    last_visit_map = {}
    if doctor_ids:
        last_visit_map = {
            row.doctor_id: row.last_visit
            for row in db.query(
                VisitLog.doctor_id,
                func.max(VisitLog.visit_time).label("last_visit"),
            ).filter(VisitLog.doctor_id.in_(doctor_ids)).group_by(VisitLog.doctor_id).all()
        }
    visit_cutoff = datetime.combine(ref_date - timedelta(days=30), datetime.min.time())
    uncovered_doctors = [
        doctor for doctor in doctors
        if not last_visit_map.get(doctor.id) or last_visit_map[doctor.id] < visit_cutoff
    ]
    if uncovered_doctors:
        never_visited = sum(1 for doctor in uncovered_doctors if not last_visit_map.get(doctor.id))
        items.append({
            "id": "doctor-visit-coverage",
            "type": "visit",
            "severity": "warning",
            "title": f"{len(uncovered_doctors)} doctor{'s' if len(uncovered_doctors) != 1 else ''} need a visit",
            "detail": f"No visit in 30 days · {never_visited} never visited",
            "count": len(uncovered_doctors),
            "names": [doctor.name for doctor in uncovered_doctors[:4]],
            "action_path": "/visit-log",
        })

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    items.sort(key=lambda item: (severity_order.get(item["severity"], 9), -item["count"], item["title"]))
    return {
        "viewer_id": viewer_id,
        "scope": normalized_scope,
        "generated_at": datetime.utcnow().isoformat(),
        "regional_week": {"year": week_year, "month": week_month, "week": week_number},
        "summary": {
            "urgent": sum(1 for item in items if item["severity"] == "critical"),
            "attention": sum(1 for item in items if item["severity"] == "warning"),
            "info": sum(1 for item in items if item["severity"] == "info"),
        },
        "items": items,
    }
