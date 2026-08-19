import calendar
from datetime import date as date_type, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import (
    DailyTask,
    Doctor,
    Investment,
    ProductTarget,
    RegionalProductTarget,
    RegionalSalesEntry,
    RegionalSalesWeekPDF,
    SalesEntry,
    User,
    UserRegionalTerritory,
    VisitLog,
)
from ..utils.hierarchy import get_dashboard_scope_ids
from ..utils.regional_territories import (
    REGIONAL_TERRITORIES,
    TERRITORY_STATES,
    infer_user_territory,
    territory_for_city,
)
from ..services.report_scoring import SCORING_WEIGHTS, score_people
from .roi import (
    _add_months,
    _commitment_status,
    _expected_mult,
    _safe_date,
    _sales_between_for_doctor,
    get_commitment_recovery,
)


router = APIRouter(prefix="/targets", tags=["Dashboard"])


def _week_for_day(day: int) -> int:
    return min(4, max(1, ((day - 1) // 7) + 1))


def _regional_mtd_entries(entries, year: int, month: int, through_week: int):
    eligible = [entry for entry in entries if int(entry.week or 0) <= through_week]
    if (year, month) == (2026, 7):
        return eligible
    if (year, month) < (2026, 8):
        return eligible
    latest = {}
    for entry in eligible:
        key = (entry.associate_id, entry.state_code, entry.city, entry.product_id)
        if key not in latest or int(entry.week or 0) > int(latest[key].week or 0):
            latest[key] = entry
    return list(latest.values())


def _regional_week_value(entries, year: int, month: int, week: int) -> float:
    if (year, month) == (2026, 7):
        return sum(float(entry.value or 0) for entry in entries if int(entry.week or 0) == week)
    if (year, month) < (2026, 8):
        return sum(float(entry.value or 0) for entry in entries)
    current = _regional_mtd_entries(entries, year, month, week)
    previous = _regional_mtd_entries(entries, year, month, week - 1) if week > 1 else []
    current_by_key = {
        (entry.associate_id, entry.state_code, entry.city, entry.product_id): float(entry.value or 0)
        for entry in current
    }
    previous_by_key = {
        (entry.associate_id, entry.state_code, entry.city, entry.product_id): float(entry.value or 0)
        for entry in previous
    }
    return sum(max(0.0, value - previous_by_key.get(key, 0.0)) for key, value in current_by_key.items())


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
            "rows": [{
                "label": user.name,
                "meta": " · ".join(sorted(territories_by_user.get(user.id, set()))) or user.city or "Territory not mapped",
                "value": f"Week {week_number} missing",
            } for user in missing_users[:50]],
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
        user_name = user_map.get(group.associate_id).name if user_map.get(group.associate_id) else "User"
        row = {
            "label": user_name,
            "meta": f"{group.city} · {group.state_code}",
            "value": f"Week {week_number}",
        }
        if not group_pdfs:
            missing_pdf_groups.append(row)
        elif not any(getattr(pdf, "validation_status", None) == "matched" for pdf in group_pdfs):
            mismatch_groups.append(row)
    if missing_pdf_groups:
        items.append({
            "id": "missing-week-pdf",
            "type": "weekly_pdf",
            "severity": "warning",
            "title": f"{len(missing_pdf_groups)} weekly PDF upload{'s' if len(missing_pdf_groups) != 1 else ''} missing",
            "detail": f"Regional entries exist for Week {week_number}",
            "count": len(missing_pdf_groups),
            "names": [f"{row['label']} · {row['meta'].split(' · ')[0]}" for row in missing_pdf_groups[:4]],
            "rows": [{**row, "value": "PDF missing"} for row in missing_pdf_groups[:50]],
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
            "names": [f"{row['label']} · {row['meta'].split(' · ')[0]}" for row in mismatch_groups[:4]],
            "rows": [{**row, "value": "Mismatch"} for row in mismatch_groups[:50]],
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
            "rows": [{
                "label": task.assigned_to.name if task.assigned_to else "Assignee not found",
                "meta": f"{task.doctor.name if task.doctor else 'Doctor not found'} · due {task.task_date}",
                "value": "Overdue",
            } for task in overdue_tasks[:50]],
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
            "rows": [{
                "label": task.assigned_to.name if task.assigned_to else "Assignee not found",
                "meta": f"{task.doctor.name if task.doctor else 'Doctor not found'} · due {task.task_date}",
                "value": "Not read",
            } for task in unread_tasks[:50]],
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
    pending_investment_rows = pending_investment_q.order_by(Investment.submitted_at.desc()).all()
    pending_sales_rows = pending_sales_q.order_by(SalesEntry.submitted_at.desc()).all()
    pending_investments = len(pending_investment_rows)
    pending_sales = len(pending_sales_rows)
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
            "rows": ([{
                "label": row.doctor.name if row.doctor else "Doctor not found",
                "meta": f"Investment · {row.associate.name if row.associate else 'Submitted by unknown user'}",
                "value": f"₹{float(row.amount or 0):,.0f}",
            } for row in pending_investment_rows] + [{
                "label": row.doctor.name if row.doctor else "Doctor not found",
                "meta": f"Doctor sales · {row.associate.name if row.associate else 'Submitted by unknown user'}",
                "value": f"₹{float(row.value or 0):,.0f}",
            } for row in pending_sales_rows])[:50],
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
            "rows": [{
                "label": doctor.name,
                "meta": f"{doctor.city or 'City not set'} · {doctor.manager.name if doctor.manager else 'Owner not set'}",
                "value": "Never visited" if not last_visit_map.get(doctor.id) else last_visit_map[doctor.id].strftime("%d %b %Y"),
            } for doctor in uncovered_doctors[:50]],
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


@router.get("/territory-performance")
def get_territory_performance(
    viewer_id: int,
    year: int,
    month: int,
    scope: str = "overall",
    state_code: Optional[str] = None,
    city: Optional[str] = None,
    as_of: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return one operational and commercial scorecard row per approved territory."""
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    normalized_scope = (scope or "overall").strip().lower()
    if normalized_scope not in {"overall", "mine", "team"}:
        raise HTTPException(status_code=400, detail="Invalid dashboard scope")
    try:
        ref_date = datetime.strptime(as_of, "%Y-%m-%d").date() if as_of else date_type.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="as_of must be YYYY-MM-DD")

    scope_ids = get_dashboard_scope_ids(viewer_id, normalized_scope, db)
    overall_scope_ids = get_dashboard_scope_ids(viewer_id, "overall", db)
    rows = {
        territory: {
            "territory": territory,
            "state_code": TERRITORY_STATES[territory],
            "regional_sales": 0.0,
            "regional_target": 0.0,
            "regional_achievement_pct": 0.0,
            "doctor_sales": 0.0,
            "investment": 0.0,
            "recovery_expected": 0.0,
            "recovery_sales": 0.0,
            "recovery_pct": 0.0,
            "recovery_at_risk": 0,
            "recovery_breached": 0,
            "active_doctors": 0,
            "visited_30d": 0,
            "visit_coverage_pct": 0.0,
            "missing_updates": 0,
            "missing_pdfs": 0,
            "pdf_mismatches": 0,
            "open_tasks": 0,
            "overdue_tasks": 0,
            "status": "No activity",
            "status_level": "neutral",
        }
        for territory in REGIONAL_TERRITORIES
    }
    if not scope_ids:
        return {"viewer_id": viewer_id, "scope": normalized_scope, "year": year, "month": month, "rows": []}

    users = db.query(User).filter(User.id.in_(scope_ids), User.is_active == True).all()
    territory_assignments = {}
    for user_id, territory in db.query(
        UserRegionalTerritory.user_id,
        UserRegionalTerritory.territory,
    ).filter(UserRegionalTerritory.user_id.in_(scope_ids)).all():
        territory_assignments.setdefault(user_id, set()).add(territory)

    doctors = db.query(Doctor).filter(
        Doctor.manager_id.in_(scope_ids),
        Doctor.is_active != False,
    ).all()
    doctor_map = {doctor.id: doctor for doctor in doctors}
    doctor_territory = {
        doctor.id: territory_for_city(doctor.city, doctor.manager_id)
        for doctor in doctors
    }
    for doctor in doctors:
        territory = doctor_territory.get(doctor.id)
        if territory:
            rows[territory]["active_doctors"] += 1

    doctor_ids = list(doctor_map)
    if doctor_ids:
        for doctor_id, total in db.query(
            SalesEntry.doctor_id,
            func.sum(SalesEntry.value),
        ).filter(
            SalesEntry.doctor_id.in_(doctor_ids),
            SalesEntry.year == year,
            SalesEntry.month == month,
        ).group_by(SalesEntry.doctor_id).all():
            territory = doctor_territory.get(doctor_id)
            if territory:
                rows[territory]["doctor_sales"] += float(total or 0)

        for doctor_id, total in db.query(
            Investment.doctor_id,
            func.sum(Investment.amount),
        ).filter(Investment.doctor_id.in_(doctor_ids)).group_by(Investment.doctor_id).all():
            territory = doctor_territory.get(doctor_id)
            if territory:
                rows[territory]["investment"] += float(total or 0)

        visit_cutoff = datetime.combine(ref_date - timedelta(days=30), datetime.min.time())
        visited_ids = {
            doctor_id
            for doctor_id, in db.query(VisitLog.doctor_id).filter(
                VisitLog.doctor_id.in_(doctor_ids),
                VisitLog.visit_time >= visit_cutoff,
            ).distinct().all()
        }
        for doctor_id in visited_ids:
            territory = doctor_territory.get(doctor_id)
            if territory:
                rows[territory]["visited_30d"] += 1

        investments = db.query(Investment).filter(Investment.doctor_id.in_(doctor_ids)).all()
        for investment in investments:
            investment_date = _safe_date(investment.year, investment.month, investment.week)
            if investment_date > ref_date:
                continue
            territory = doctor_territory.get(investment.doctor_id)
            if not territory:
                continue
            doctor = doctor_map[investment.doctor_id]
            amount = float(investment.amount or 0)
            expected = float(investment.expected_sales or (amount * float(investment.expected_multiple or _expected_mult(doctor))))
            deadline = _add_months(investment_date, 6)
            captured = _sales_between_for_doctor(db, doctor.id, investment_date, min(ref_date, deadline))
            recovery_status, _, _ = _commitment_status(captured, expected, investment_date, deadline, ref_date)
            row = rows[territory]
            row["recovery_expected"] += expected
            row["recovery_sales"] += captured
            if recovery_status == "At Risk":
                row["recovery_at_risk"] += 1
            elif recovery_status == "Breached":
                row["recovery_breached"] += 1

        tasks = db.query(DailyTask).filter(
            DailyTask.doctor_id.in_(doctor_ids),
            DailyTask.assigned_to_id.in_(scope_ids),
            DailyTask.status != "completed",
        ).all()
        for task in tasks:
            territory = doctor_territory.get(task.doctor_id)
            if not territory:
                continue
            rows[territory]["open_tasks"] += 1
            if task.task_date < ref_date.isoformat():
                rows[territory]["overdue_tasks"] += 1

    regional_entries = db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id.in_(scope_ids),
        RegionalSalesEntry.year == year,
        RegionalSalesEntry.month == month,
    ).all()
    for entry in regional_entries:
        territory = territory_for_city(entry.city, entry.associate_id)
        if territory:
            rows[territory]["regional_sales"] += float(entry.value or 0)

    # Keep manager roll-up targets from being added again to reportee targets.
    target_rows = db.query(RegionalProductTarget).filter(
        RegionalProductTarget.owner_user_id.in_(scope_ids),
        RegionalProductTarget.year == year,
        RegionalProductTarget.month == month,
    ).all()
    for territory in REGIONAL_TERRITORIES:
        territory_targets = [target for target in target_rows if territory_for_city(target.city, target.owner_user_id) == territory]
        if normalized_scope == "mine" and len(overall_scope_ids) > 1:
            territory_targets = []
        elif normalized_scope == "overall" and any(target.owner_user_id == viewer_id for target in territory_targets):
            territory_targets = [target for target in territory_targets if target.owner_user_id == viewer_id]
        rows[territory]["regional_target"] = sum(float(target.target_value or 0) for target in territory_targets)

    previous_year, previous_month, previous_week = _previous_regional_week(ref_date)
    submitted = set()
    previous_entries = db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id.in_(scope_ids),
        RegionalSalesEntry.year == previous_year,
        RegionalSalesEntry.month == previous_month,
        RegionalSalesEntry.week == previous_week,
    ).all()
    for entry in previous_entries:
        territory = territory_for_city(entry.city, entry.associate_id)
        if territory:
            submitted.add((entry.associate_id, territory))

    historical_regional_users = {entry.associate_id for entry in regional_entries + previous_entries}
    for user in users:
        if user.role in {"admin", "md"}:
            continue
        assigned = set(territory_assignments.get(user.id, set()))
        inferred = infer_user_territory(user)
        if inferred:
            assigned.add(inferred)
        if not assigned and user.id in historical_regional_users:
            assigned.update(
                territory_for_city(entry.city, user.id)
                for entry in regional_entries + previous_entries
                if entry.associate_id == user.id
            )
        for territory in assigned:
            if territory and (user.id, territory) not in submitted:
                rows[territory]["missing_updates"] += 1

    pdf_rows = db.query(RegionalSalesWeekPDF).filter(
        RegionalSalesWeekPDF.associate_id.in_(scope_ids),
        RegionalSalesWeekPDF.year == previous_year,
        RegionalSalesWeekPDF.month == previous_month,
        RegionalSalesWeekPDF.week == previous_week,
    ).all()
    pdf_groups = {}
    for pdf in pdf_rows:
        territory = territory_for_city(pdf.city, pdf.associate_id)
        if territory:
            pdf_groups.setdefault((pdf.associate_id, territory), []).append(pdf)
    for associate_id, territory in submitted:
        group = pdf_groups.get((associate_id, territory), [])
        if not group:
            rows[territory]["missing_pdfs"] += 1
        elif not any(getattr(pdf, "validation_status", None) == "matched" for pdf in group):
            rows[territory]["pdf_mismatches"] += 1

    state_filter = _state_keys(state_code)
    selected_city = (city or "").strip().lower()
    selected_territories = set(REGIONAL_TERRITORIES)
    if state_filter:
        selected_territories = {
            territory for territory in selected_territories
            if "".join(TERRITORY_STATES[territory].upper().split()) in state_filter
        }
    if selected_city:
        if selected_city == "coimbatore":
            selected_territories &= {"Coimbatore 1", "Coimbatore 2"}
        else:
            selected = territory_for_city(city)
            selected_territories &= ({selected} if selected else set())

    if viewer.role not in {"admin", "md"}:
        visible = set()
        for user_id, assigned in territory_assignments.items():
            if user_id in scope_ids:
                visible.update(assigned)
        for doctor_id, territory in doctor_territory.items():
            if territory:
                visible.add(territory)
        for entry in regional_entries + previous_entries:
            territory = territory_for_city(entry.city, entry.associate_id)
            if territory:
                visible.add(territory)
        selected_territories &= visible

    days_in_month = calendar.monthrange(year, month)[1]
    if (year, month) < (ref_date.year, ref_date.month):
        month_progress = 100.0
    elif (year, month) > (ref_date.year, ref_date.month):
        month_progress = 0.0
    else:
        month_progress = min(ref_date.day, days_in_month) / days_in_month * 100

    output = []
    for territory in REGIONAL_TERRITORIES:
        if territory not in selected_territories:
            continue
        row = rows[territory]
        row["regional_achievement_pct"] = round(
            row["regional_sales"] / row["regional_target"] * 100, 1
        ) if row["regional_target"] > 0 else 0.0
        row["recovery_pct"] = round(
            row["recovery_sales"] / row["recovery_expected"] * 100, 1
        ) if row["recovery_expected"] > 0 else 0.0
        row["visit_coverage_pct"] = round(
            row["visited_30d"] / row["active_doctors"] * 100, 1
        ) if row["active_doctors"] > 0 else 0.0

        critical = row["pdf_mismatches"] + row["overdue_tasks"] + row["recovery_breached"]
        below_pace = row["regional_target"] > 0 and row["regional_achievement_pct"] + 10 < month_progress
        warning = (
            row["missing_updates"] + row["missing_pdfs"] + row["recovery_at_risk"] > 0
            or below_pace
            or (row["active_doctors"] > 0 and row["visit_coverage_pct"] < 60)
        )
        has_activity = row["regional_sales"] > 0 or row["doctor_sales"] > 0 or row["investment"] > 0 or row["active_doctors"] > 0
        if critical:
            row["status"], row["status_level"] = "Needs action", "critical"
        elif warning:
            row["status"], row["status_level"] = "Watch", "warning"
        elif has_activity:
            row["status"], row["status_level"] = "On track", "good"

        for key in (
            "regional_sales", "regional_target", "doctor_sales", "investment",
            "recovery_expected", "recovery_sales",
        ):
            row[key] = round(row[key], 2)
        output.append(row)

    return {
        "viewer_id": viewer_id,
        "scope": normalized_scope,
        "year": year,
        "month": month,
        "as_of": ref_date.isoformat(),
        "regional_week": {"year": previous_year, "month": previous_month, "week": previous_week},
        "rows": output,
    }


@router.get("/rep-scorecard")
def get_rep_scorecard(
    viewer_id: int,
    year: int,
    month: int,
    scope: str = "overall",
    state_code: Optional[str] = None,
    city: Optional[str] = None,
    as_of: Optional[str] = None,
    submission_year: Optional[int] = None,
    submission_month: Optional[int] = None,
    submission_week: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Return centrally scored person performance with only applicable metrics weighted."""
    viewer = db.query(User).filter(User.id == viewer_id, User.is_active == True).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    normalized_scope = (scope or "overall").strip().lower()
    if normalized_scope not in {"overall", "mine", "team"}:
        raise HTTPException(status_code=400, detail="Invalid dashboard scope")
    try:
        ref_date = datetime.strptime(as_of, "%Y-%m-%d").date() if as_of else date_type.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="as_of must be YYYY-MM-DD")

    scope_ids = get_dashboard_scope_ids(viewer_id, normalized_scope, db)
    users = db.query(User).filter(
        User.id.in_(scope_ids),
        User.is_active == True,
        User.role.notin_(["admin", "md"]),
    ).order_by(User.name).all() if scope_ids else []
    if not users:
        return {"viewer_id": viewer_id, "scope": normalized_scope, "year": year, "month": month, "rows": []}

    user_ids = {user.id for user in users}
    rows = {
        user.id: {
            "user_id": user.id,
            "name": user.name,
            "role": user.role,
            "display_role": user.display_role,
            "city": user.city,
            "reports_to_id": user.reports_to_id,
            "has_reportees": False,
            "doctor_count": 0,
            "doctor_sales": 0.0,
            "doctor_target": 0.0,
            "doctor_target_available": False,
            "regional_sales": 0.0,
            "regional_target": 0.0,
            "regional_target_available": False,
            "regional_required": False,
            "visited_30d": 0,
            "visit_coverage_pct": 0.0,
            "weekly_expected": 0,
            "weekly_submitted": 0,
            "weekly_pdf_uploaded": 0,
            "weekly_pdf_matched": 0,
            "weekly_pdf_unverified": 0,
            "task_total": 0,
            "task_completed": 0,
            "overdue_tasks": 0,
            "pending_investments": 0,
            "pending_sales": 0,
        }
        for user in users
    }
    manager_ids = {
        reports_to_id
        for reports_to_id, in db.query(User.reports_to_id).filter(
            User.reports_to_id.in_(user_ids),
            User.is_active == True,
        ).distinct().all()
        if reports_to_id
    }
    for manager_id in manager_ids:
        rows[manager_id]["has_reportees"] = True

    state_keys = _state_keys(state_code)
    doctor_q = db.query(Doctor).filter(
        Doctor.manager_id.in_(user_ids),
        Doctor.is_active != False,
    )
    if state_keys:
        doctor_q = doctor_q.filter(func.upper(func.replace(Doctor.state_code, " ", "")).in_(state_keys))
    if city:
        doctor_q = doctor_q.filter(Doctor.city.ilike(city.strip()))
    doctors = doctor_q.all()
    doctor_map = {doctor.id: doctor for doctor in doctors}
    doctor_ids = list(doctor_map)
    for doctor in doctors:
        rows[doctor.manager_id]["doctor_count"] += 1

    if doctor_ids:
        doctor_sales_q = db.query(
            Doctor.manager_id,
            func.sum(SalesEntry.value),
        ).join(SalesEntry, SalesEntry.doctor_id == Doctor.id).filter(
            Doctor.id.in_(doctor_ids),
            SalesEntry.year == year,
            SalesEntry.month == month,
        )
        if (year, month) == (ref_date.year, ref_date.month):
            doctor_sales_q = doctor_sales_q.filter(or_(
                SalesEntry.sale_date <= ref_date.isoformat(),
                SalesEntry.sale_date.is_(None),
            ))
        for owner_id, total in doctor_sales_q.group_by(Doctor.manager_id).all():
            rows[owner_id]["doctor_sales"] = float(total or 0)

        visit_cutoff = datetime.combine(ref_date - timedelta(days=30), datetime.min.time())
        for owner_id, count in db.query(
            Doctor.manager_id,
            func.count(func.distinct(VisitLog.doctor_id)),
        ).join(VisitLog, VisitLog.doctor_id == Doctor.id).filter(
            Doctor.id.in_(doctor_ids),
            VisitLog.visit_time >= visit_cutoff,
        ).group_by(Doctor.manager_id).all():
            rows[owner_id]["visited_30d"] = int(count or 0)

        pending_investments = db.query(
            Doctor.manager_id,
            func.count(Investment.id),
        ).join(Investment, Investment.doctor_id == Doctor.id).filter(
            Doctor.id.in_(doctor_ids),
            Investment.is_approved == False,
        ).group_by(Doctor.manager_id).all()
        for owner_id, count in pending_investments:
            rows[owner_id]["pending_investments"] = int(count or 0)

        pending_sales = db.query(
            Doctor.manager_id,
            func.count(SalesEntry.id),
        ).join(SalesEntry, SalesEntry.doctor_id == Doctor.id).filter(
            Doctor.id.in_(doctor_ids),
            SalesEntry.year == year,
            SalesEntry.month == month,
            SalesEntry.approved_by_id.is_(None),
        ).group_by(Doctor.manager_id).all()
        for owner_id, count in pending_sales:
            rows[owner_id]["pending_sales"] = int(count or 0)

    doctor_targets = db.query(
        ProductTarget.owner_user_id,
        func.sum(ProductTarget.target_value),
    ).filter(
        ProductTarget.owner_user_id.in_(user_ids),
        ProductTarget.year == year,
        ProductTarget.month == month,
    ).group_by(ProductTarget.owner_user_id).all()
    for owner_id, target in doctor_targets:
        rows[owner_id]["doctor_target"] = float(target or 0)
        rows[owner_id]["doctor_target_available"] = float(target or 0) > 0

    selected_territory = territory_for_city(city) if city else None
    regional_entries = db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id.in_(user_ids),
        RegionalSalesEntry.year == year,
        RegionalSalesEntry.month == month,
    ).all()
    through_week = _week_for_day(ref_date.day) if (year, month) == (ref_date.year, ref_date.month) else 4
    regional_mtd_entries = _regional_mtd_entries(regional_entries, year, month, through_week)
    for entry in regional_mtd_entries:
        territory = territory_for_city(entry.city, entry.associate_id)
        if state_keys and "".join((entry.state_code or "").upper().split()) not in state_keys:
            continue
        if selected_territory and territory != selected_territory:
            continue
        rows[entry.associate_id]["regional_sales"] += float(entry.value or 0)

    regional_targets = db.query(RegionalProductTarget).filter(
        RegionalProductTarget.owner_user_id.in_(user_ids),
        RegionalProductTarget.year == year,
        RegionalProductTarget.month == month,
    ).all()
    for target in regional_targets:
        territory = territory_for_city(target.city, target.owner_user_id)
        if state_keys and "".join((target.state_code or "").upper().split()) not in state_keys:
            continue
        if selected_territory and territory != selected_territory:
            continue
        rows[target.owner_user_id]["regional_target"] += float(target.target_value or 0)
    for user_id, row in rows.items():
        row["regional_target_available"] = row["regional_target"] > 0

    assignments = {}
    for user_id, territory in db.query(
        UserRegionalTerritory.user_id,
        UserRegionalTerritory.territory,
    ).filter(UserRegionalTerritory.user_id.in_(user_ids)).all():
        assignments.setdefault(user_id, set()).add(territory)
    historical_users = {
        associate_id
        for associate_id, in db.query(RegionalSalesEntry.associate_id).filter(
            RegionalSalesEntry.associate_id.in_(user_ids)
        ).distinct().all()
    }
    user_map = {user.id: user for user in users}
    expected_groups = set()
    for user_id in user_ids:
        territories = set(assignments.get(user_id, set()))
        inferred = infer_user_territory(user_map[user_id])
        if inferred:
            territories.add(inferred)
        if not territories and user_id in historical_users:
            territories.update(
                territory_for_city(entry.city, user_id)
                for entry in regional_mtd_entries
                if entry.associate_id == user_id
            )
        territories.discard(None)
        if state_keys:
            territories = {
                territory for territory in territories
                if "".join(TERRITORY_STATES.get(territory, "").upper().split()) in state_keys
            }
        if selected_territory:
            territories &= {selected_territory}
        for territory in territories:
            expected_groups.add((user_id, territory))
        rows[user_id]["regional_required"] = bool(territories)
        rows[user_id]["weekly_expected"] = len(territories)

    if submission_year is not None and submission_month is not None and submission_week is not None:
        if submission_month < 1 or submission_month > 12 or submission_week < 1 or submission_week > 4:
            raise HTTPException(status_code=400, detail="Invalid weekly submission period")
        week_year, week_month, week_number = submission_year, submission_month, submission_week
    else:
        week_year, week_month, week_number = _previous_regional_week(ref_date)
    week_entries = db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id.in_(user_ids),
        RegionalSalesEntry.year == week_year,
        RegionalSalesEntry.month == week_month,
        RegionalSalesEntry.week == week_number,
    ).all()
    submitted_groups = {
        (entry.associate_id, territory_for_city(entry.city, entry.associate_id))
        for entry in week_entries
    } & expected_groups
    for user_id, _ in submitted_groups:
        rows[user_id]["weekly_submitted"] += 1

    pdf_rows = db.query(RegionalSalesWeekPDF).filter(
        RegionalSalesWeekPDF.associate_id.in_(user_ids),
        RegionalSalesWeekPDF.year == week_year,
        RegionalSalesWeekPDF.month == week_month,
        RegionalSalesWeekPDF.week == week_number,
    ).all()
    pdf_groups = {}
    for pdf in pdf_rows:
        key = (pdf.associate_id, territory_for_city(pdf.city, pdf.associate_id))
        if key in expected_groups:
            pdf_groups.setdefault(key, []).append(pdf)
    for (user_id, _), group in pdf_groups.items():
        rows[user_id]["weekly_pdf_uploaded"] += 1
        if any(getattr(pdf, "validation_status", None) == "matched" for pdf in group):
            rows[user_id]["weekly_pdf_matched"] += 1
        elif any(getattr(pdf, "validation_status", None) == "unverified" or pdf.pdf_total is None for pdf in group):
            rows[user_id]["weekly_pdf_unverified"] += 1

    month_start = date_type(year, month, 1)
    month_end = date_type(year, month, calendar.monthrange(year, month)[1])
    score_end = min(ref_date, month_end) if (year, month) <= (ref_date.year, ref_date.month) else month_end
    tasks = db.query(DailyTask).filter(
        DailyTask.assigned_to_id.in_(user_ids),
        DailyTask.task_date >= month_start.isoformat(),
        DailyTask.task_date <= score_end.isoformat(),
    ).all()
    for task in tasks:
        if task.doctor_id in doctor_map or not (state_code or city):
            row = rows[task.assigned_to_id]
            row["task_total"] += 1
            if task.status == "completed":
                row["task_completed"] += 1
            elif task.task_date < ref_date.isoformat():
                row["overdue_tasks"] += 1

    output = []
    for row in rows.values():
        if state_code or city:
            relevant = row["doctor_count"] > 0 or row["regional_required"] or row["regional_sales"] > 0
            if not relevant:
                continue
        row["visit_coverage_pct"] = round(
            row["visited_30d"] / row["doctor_count"] * 100, 1
        ) if row["doctor_count"] else 0.0
        for key in ("doctor_sales", "doctor_target", "regional_sales", "regional_target"):
            row[key] = round(row[key], 2)
        output.append(row)

    recovery = get_commitment_recovery(
        viewer_id=viewer_id,
        as_of=ref_date.isoformat(),
        manager_id=None,
        commercial_model=None,
        status=None,
        search=None,
        current_user=viewer,
        db=db,
    )
    recovery_rows = recovery.get("doctor_summary", [])
    if state_keys:
        recovery_rows = [
            row for row in recovery_rows
            if "".join((row.get("state_code") or "").upper().split()) in state_keys
        ]
    if city:
        recovery_rows = [
            row for row in recovery_rows
            if (row.get("city") or "").strip().lower() == city.strip().lower()
        ]
    scored_rows = score_people(output, recovery_rows)

    return {
        "viewer_id": viewer_id,
        "scope": normalized_scope,
        "year": year,
        "month": month,
        "as_of": ref_date.isoformat(),
        "regional_week": {"year": week_year, "month": week_month, "week": week_number},
        "weights": dict(SCORING_WEIGHTS),
        "rows": scored_rows,
    }
