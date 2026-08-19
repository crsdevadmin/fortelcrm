import re
from dataclasses import asdict, dataclass
from datetime import date as date_type, datetime
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.models import SmsNotificationLog, User
from ..routers.dashboard import get_rep_scorecard


VALID_STAGES = {"rep", "manager", "all"}


@dataclass
class SmsResult:
    notification_type: str
    recipient_user_id: int
    related_user_id: Optional[int]
    name: str
    phone: Optional[str]
    status: str
    reason: Optional[str] = None
    message_id: Optional[str] = None


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


def _dlt_value(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ]+", " ", value or "")
    cleaned = " ".join(cleaned.split())
    return cleaned[:50] or fallback


def build_rep_message(name: str, week: int) -> str:
    return (
        f"Dear {_dlt_value(name, 'Team Member')}, your weekly sales update for week {week} "
        f"is pending in Fortel CRM. Please complete it by {_dlt_value(settings.SMS_REP_DEADLINE, 'Monday 5 PM')}. "
        "- Fortel Life Sciences"
    )


def build_manager_message(manager_name: str, pending_name: str, week: int) -> str:
    return (
        f"Dear {_dlt_value(manager_name, 'Manager')}, weekly sales updates for "
        f"{_dlt_value(pending_name, 'team member')} are pending from week {week} team members. "
        f"Please follow up in Fortel CRM by {_dlt_value(settings.SMS_MANAGER_DEADLINE, 'Tuesday 10 AM')}. "
        "- Fortel Life Sciences"
    )


def build_md_summary_message(md_name: str, week: int, pending_count: int) -> str:
    return (
        f"Dear {_dlt_value(md_name, 'Management')}, weekly sales updates for week {week} "
        f"are pending from {max(int(pending_count or 0), 0)} team members. "
        f"Please follow up in Fortel CRM by {_dlt_value(settings.SMS_MANAGER_DEADLINE, 'Tuesday 10 AM')}. "
        "- Fortel Life Sciences"
    )


def _sns_client():
    kwargs = {"region_name": settings.AWS_REGION}
    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        kwargs.update({
            "aws_access_key_id": settings.AWS_ACCESS_KEY_ID,
            "aws_secret_access_key": settings.AWS_SECRET_ACCESS_KEY,
        })
    return boto3.client("sns", **kwargs)


def _sns_sandbox_status(client) -> Optional[bool]:
    try:
        return bool(client.get_sms_sandbox_account_status().get("IsInSandbox"))
    except (BotoCoreError, ClientError):
        return None


def send_sms(
    phone: str,
    message: str,
    template_id: str,
    client=None,
    is_in_sandbox: Optional[bool] = None,
) -> tuple[str, Optional[str]]:
    if not settings.SMS_ENABLED or settings.SMS_DRY_RUN:
        return "dry_run", None
    if settings.SMS_REQUIRE_PRODUCTION and is_in_sandbox is not False:
        return "blocked_sandbox", "AWS SNS SMS account is still in the sandbox"

    attrs = {
        "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
        "AWS.SNS.SMS.SenderID": {"DataType": "String", "StringValue": settings.SMS_SENDER_ID},
        "AWS.MM.SMS.EntityId": {"DataType": "String", "StringValue": settings.SMS_ENTITY_ID},
        "AWS.MM.SMS.TemplateId": {"DataType": "String", "StringValue": template_id},
    }

    try:
        sns = client or _sns_client()
        response = sns.publish(PhoneNumber=phone, Message=message, MessageAttributes=attrs)
        return "sent", response.get("MessageId")
    except (BotoCoreError, ClientError) as exc:
        return "failed", str(exc)


def _terminal_delivery_exists(db: Session, idempotency_key: str) -> bool:
    return db.query(SmsNotificationLog.id).filter(
        SmsNotificationLog.idempotency_key == idempotency_key,
        SmsNotificationLog.status == "sent",
    ).first() is not None


def _record_attempt(
    db: Session,
    *,
    idempotency_key: str,
    notification_type: str,
    recipient_user_id: int,
    related_user_id: Optional[int],
    year: int,
    month: int,
    week: int,
    phone: Optional[str],
    template_id: str,
    message: str,
    status: str,
    detail: Optional[str],
):
    record = db.query(SmsNotificationLog).filter(
        SmsNotificationLog.idempotency_key == idempotency_key,
    ).first()
    now = datetime.utcnow()
    if not record:
        record = SmsNotificationLog(
            idempotency_key=idempotency_key,
            notification_type=notification_type,
            recipient_user_id=recipient_user_id,
            related_user_id=related_user_id,
            year=year,
            month=month,
            week=week,
            phone=phone,
            template_id=template_id,
            message=message,
            status=status,
            attempt_count=0,
        )
        db.add(record)
    record.phone = phone
    record.template_id = template_id
    record.message = message
    record.status = status
    record.provider_message_id = detail if status == "sent" else None
    record.error = detail if status in {"failed", "blocked_sandbox"} else None
    record.attempt_count = int(record.attempt_count or 0) + 1
    record.last_attempt_at = now
    record.updated_at = now
    db.commit()


def _find_scorecard_viewer(db: Session) -> Optional[User]:
    viewer = db.query(User).filter(User.is_active == True, User.role == "md").order_by(User.id).first()
    if viewer:
        return viewer
    return db.query(User).filter(User.is_active == True, User.role == "admin").order_by(User.id).first()


def _pending_weekly_rows(db: Session, ref_date: date_type):
    viewer = _find_scorecard_viewer(db)
    if not viewer:
        raise ValueError("No active MD or admin account is available for the SMS compliance check")
    scorecard = get_rep_scorecard(
        viewer_id=viewer.id,
        year=ref_date.year,
        month=ref_date.month,
        scope="overall",
        as_of=ref_date.isoformat(),
        db=db,
    )
    pending = []
    for row in scorecard.get("rows", []):
        expected = int(row.get("weekly_expected") or 0)
        if not expected:
            continue
        complete = (
            int(row.get("weekly_submitted") or 0) >= expected
            and int(row.get("weekly_pdf_uploaded") or 0) >= expected
            and int(row.get("weekly_pdf_matched") or 0) >= expected
        )
        if not complete:
            pending.append(row)
    return scorecard.get("regional_week", {}), pending


def _delivery_result(
    db: Session,
    *,
    notification_type: str,
    recipient: User,
    related_user_id: Optional[int],
    period: dict,
    template_id: str,
    message: str,
    client,
    is_in_sandbox: Optional[bool],
) -> SmsResult:
    year, month, week = int(period["year"]), int(period["month"]), int(period["week"])
    relation_key = related_user_id if related_user_id is not None else recipient.id
    key = f"{notification_type}:{recipient.id}:{relation_key}:{year}:{month}:{week}"
    phone = normalize_phone(recipient.phone)
    if _terminal_delivery_exists(db, key):
        return SmsResult(notification_type, recipient.id, related_user_id, recipient.name, phone, "skipped", "already_sent")
    if not phone:
        status, detail = "skipped", "missing_or_invalid_phone"
    else:
        status, detail = send_sms(phone, message, template_id, client=client, is_in_sandbox=is_in_sandbox)
    _record_attempt(
        db,
        idempotency_key=key,
        notification_type=notification_type,
        recipient_user_id=recipient.id,
        related_user_id=related_user_id,
        year=year,
        month=month,
        week=week,
        phone=phone,
        template_id=template_id,
        message=message,
        status=status,
        detail=detail,
    )
    return SmsResult(
        notification_type=notification_type,
        recipient_user_id=recipient.id,
        related_user_id=related_user_id,
        name=recipient.name,
        phone=phone,
        status=status,
        reason=detail if status != "sent" else None,
        message_id=detail if status == "sent" else None,
    )


def send_weekly_sales_sms_reminders(
    db: Session,
    today: Optional[str] = None,
    stage: str = "all",
) -> dict:
    normalized_stage = (stage or "all").strip().lower()
    if normalized_stage not in VALID_STAGES:
        raise ValueError("stage must be rep, manager, or all")
    ref_date = datetime.strptime(today, "%Y-%m-%d").date() if today else date_type.today()
    period, pending_rows = _pending_weekly_rows(db, ref_date)
    if not period:
        raise ValueError("Unable to determine the previous regional sales week")

    user_ids = {int(row["user_id"]) for row in pending_rows}
    manager_ids = {int(row["reports_to_id"]) for row in pending_rows if row.get("reports_to_id")}
    md_summary_recipient = (
        _find_scorecard_viewer(db)
        if pending_rows and normalized_stage in {"manager", "all"}
        else None
    )
    all_ids = user_ids | manager_ids | ({md_summary_recipient.id} if md_summary_recipient else set())
    users = {
        user.id: user
        for user in db.query(User).filter(User.id.in_(all_ids), User.is_active == True).all()
    } if all_ids else {}

    client = None
    is_in_sandbox = None
    if settings.SMS_ENABLED and not settings.SMS_DRY_RUN:
        try:
            client = _sns_client()
            is_in_sandbox = _sns_sandbox_status(client)
        except (BotoCoreError, ClientError):
            is_in_sandbox = None

    results: list[SmsResult] = []
    if normalized_stage in {"rep", "all"}:
        for row in pending_rows:
            recipient = users.get(int(row["user_id"]))
            if not recipient:
                continue
            results.append(_delivery_result(
                db,
                notification_type="rep_reminder",
                recipient=recipient,
                related_user_id=None,
                period=period,
                template_id=settings.SMS_REP_TEMPLATE_ID,
                message=build_rep_message(recipient.name, int(period["week"])),
                client=client,
                is_in_sandbox=is_in_sandbox,
            ))

    if normalized_stage in {"manager", "all"}:
        if md_summary_recipient:
            results.append(_delivery_result(
                db,
                notification_type="md_escalation_summary",
                recipient=md_summary_recipient,
                related_user_id=None,
                period=period,
                template_id=settings.SMS_MANAGER_TEMPLATE_ID,
                message=build_md_summary_message(
                    md_summary_recipient.name,
                    int(period["week"]),
                    len(pending_rows),
                ),
                client=client,
                is_in_sandbox=is_in_sandbox,
            ))
        for row in pending_rows:
            manager_id = int(row.get("reports_to_id") or 0)
            manager = users.get(manager_id)
            if not manager or (md_summary_recipient and manager.id == md_summary_recipient.id):
                continue
            results.append(_delivery_result(
                db,
                notification_type="manager_escalation",
                recipient=manager,
                related_user_id=int(row["user_id"]),
                period=period,
                template_id=settings.SMS_MANAGER_TEMPLATE_ID,
                message=build_manager_message(manager.name, row["name"], int(period["week"])),
                client=client,
                is_in_sandbox=is_in_sandbox,
            ))

    statuses = [result.status for result in results]
    return {
        "stage": normalized_stage,
        "year": int(period["year"]),
        "month": int(period["month"]),
        "week": int(period["week"]),
        "sms_enabled": settings.SMS_ENABLED,
        "dry_run_mode": settings.SMS_DRY_RUN,
        "sns_sandbox": is_in_sandbox,
        "sender_id": settings.SMS_SENDER_ID,
        "pending_people": len(pending_rows),
        "sent": statuses.count("sent"),
        "dry_run_count": statuses.count("dry_run"),
        "blocked_sandbox": statuses.count("blocked_sandbox"),
        "skipped": statuses.count("skipped"),
        "failed": statuses.count("failed"),
        "results": [asdict(result) for result in results],
    }
