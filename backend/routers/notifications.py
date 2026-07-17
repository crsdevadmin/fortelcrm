from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.sms_notifications import send_weekly_sales_sms_reminders

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/sales-reminders/sms")
def send_sales_reminder_sms(today: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Sends, or dry-runs, SMS reminders for users who have not entered last week's sales.
    Use today=YYYY-MM-DD for testing a specific reminder date.
    """
    try:
        return send_weekly_sales_sms_reminders(db, today=today)
    except ValueError:
        raise HTTPException(status_code=400, detail="today must be YYYY-MM-DD")
