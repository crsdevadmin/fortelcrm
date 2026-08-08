from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..auth.auth import decode_token
from ..database import get_db
from ..models.models import SmsNotificationLog, User
from ..services.sms_notifications import send_weekly_sales_sms_reminders

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_sms_admin(authorization: Optional[str], db: Session) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    data = decode_token(authorization.split(" ", 1)[1].strip())
    try:
        user_id = int(data.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid login token")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user or user.role not in {"admin", "md"}:
        raise HTTPException(status_code=403, detail="Only MD or admin can manage SMS reminders")
    return user


@router.post("/sales-reminders/sms")
def send_sales_reminder_sms(
    today: Optional[str] = None,
    stage: str = "all",
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Sends, or dry-runs, SMS reminders for users who have not entered last week's sales.
    Use today=YYYY-MM-DD for testing a specific reminder date.
    """
    _require_sms_admin(authorization, db)
    try:
        return send_weekly_sales_sms_reminders(db, today=today, stage=stage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sales-reminders/sms/logs")
def get_sales_reminder_sms_logs(
    limit: int = 100,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _require_sms_admin(authorization, db)
    rows = db.query(SmsNotificationLog).order_by(
        SmsNotificationLog.last_attempt_at.desc(),
        SmsNotificationLog.id.desc(),
    ).limit(min(max(limit, 1), 500)).all()
    user_ids = {row.recipient_user_id for row in rows} | {row.related_user_id for row in rows if row.related_user_id}
    names = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}
    return [{
        "id": row.id,
        "notification_type": row.notification_type,
        "recipient_user_id": row.recipient_user_id,
        "recipient_name": names.get(row.recipient_user_id, ""),
        "related_user_id": row.related_user_id,
        "related_user_name": names.get(row.related_user_id, "") if row.related_user_id else None,
        "year": row.year,
        "month": row.month,
        "week": row.week,
        "phone": row.phone,
        "template_id": row.template_id,
        "status": row.status,
        "provider_message_id": row.provider_message_id,
        "error": row.error,
        "attempt_count": row.attempt_count,
        "last_attempt_at": row.last_attempt_at.isoformat(),
    } for row in rows]
