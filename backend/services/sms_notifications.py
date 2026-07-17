import re
from dataclasses import dataclass
from datetime import date as date_type, datetime, timedelta
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.models import SalesEntry, User
from ..utils.hierarchy import get_subtree_ids


REMINDER_ROLES = {"director", "senior_manager", "manager", "rep", "custom"}


@dataclass
class SmsResult:
    user_id: int
    name: str
    phone: Optional[str]
    status: str
    reason: Optional[str] = None
    message_id: Optional[str] = None


def previous_sales_week(ref_date: Optional[date_type] = None) -> tuple[date_type, date_type]:
    ref = ref_date or date_type.today()
    this_monday = ref - timedelta(days=ref.weekday())
    week_start = this_monday - timedelta(days=7)
    return week_start, week_start + timedelta(days=6)


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None

    raw = phone.strip()
    if raw.startswith("+"):
        digits = "+" + re.sub(r"\D", "", raw)
    else:
        digits_only = re.sub(r"\D", "", raw)
        if not digits_only:
            return None
        if len(digits_only) == 10:
            digits = f"{settings.SMS_DEFAULT_COUNTRY_CODE}{digits_only}"
        elif digits_only.startswith("91") and len(digits_only) == 12:
            digits = f"+{digits_only}"
        else:
            digits = f"+{digits_only}"

    return digits if re.fullmatch(r"\+\d{10,15}", digits) else None


def has_sales_for_previous_week(db: Session, user_id: int, week_start: date_type, week_end: date_type) -> bool:
    visible_ids = get_subtree_ids(user_id, db)
    if visible_ids is None:
        visible_ids = {user_id}

    dates = [week_start + timedelta(days=i) for i in range((week_end - week_start).days + 1)]
    date_keys = [d.isoformat() for d in dates]
    date_conditions = [
        (SalesEntry.year == d.year) & (SalesEntry.month == d.month) & (SalesEntry.week == d.day)
        for d in dates
    ]

    count = db.query(func.count(SalesEntry.id)).filter(
        SalesEntry.associate_id.in_(visible_ids),
        or_(SalesEntry.sale_date.in_(date_keys), *date_conditions),
    ).scalar()
    return int(count or 0) > 0


def build_weekly_sales_message(user: User, week_start: date_type, week_end: date_type) -> str:
    return (
        f"Fortel CRM reminder: Hi {user.name}, please update last week sales "
        f"({week_start.strftime('%d %b')} to {week_end.strftime('%d %b')}) in Fortel CRM."
    )


def send_sms(phone: str, message: str) -> tuple[str, Optional[str]]:
    if not settings.SMS_ENABLED or settings.SMS_DRY_RUN:
        return "dry_run", None

    attrs = {
        "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
    }
    if settings.SMS_SENDER_ID:
        attrs["AWS.SNS.SMS.SenderID"] = {"DataType": "String", "StringValue": settings.SMS_SENDER_ID}

    try:
        client = boto3.client("sns", region_name=settings.AWS_REGION)
        res = client.publish(PhoneNumber=phone, Message=message, MessageAttributes=attrs)
        return "sent", res.get("MessageId")
    except (BotoCoreError, ClientError) as exc:
        return "failed", str(exc)


def send_weekly_sales_sms_reminders(db: Session, today: Optional[str] = None) -> dict:
    ref_date = datetime.strptime(today, "%Y-%m-%d").date() if today else date_type.today()
    week_start, week_end = previous_sales_week(ref_date)

    users = db.query(User).filter(
        User.is_active == True,
        User.role.in_(REMINDER_ROLES),
    ).order_by(User.name.asc()).all()

    results: list[SmsResult] = []
    for user in users:
        phone = normalize_phone(user.phone)
        if not phone:
            results.append(SmsResult(user.id, user.name, user.phone, "skipped", "missing_or_invalid_phone"))
            continue

        if has_sales_for_previous_week(db, user.id, week_start, week_end):
            results.append(SmsResult(user.id, user.name, phone, "skipped", "sales_already_entered"))
            continue

        status, detail = send_sms(phone, build_weekly_sales_message(user, week_start, week_end))
        results.append(SmsResult(
            user_id=user.id,
            name=user.name,
            phone=phone,
            status=status,
            reason=detail if status == "failed" else None,
            message_id=detail if status == "sent" else None,
        ))

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "sms_enabled": settings.SMS_ENABLED,
        "dry_run_mode": settings.SMS_DRY_RUN,
        "total_users_checked": len(users),
        "sent": sum(1 for r in results if r.status == "sent"),
        "dry_run_count": sum(1 for r in results if r.status == "dry_run"),
        "skipped": sum(1 for r in results if r.status == "skipped"),
        "failed": sum(1 for r in results if r.status == "failed"),
        "results": [r.__dict__ for r in results],
    }
