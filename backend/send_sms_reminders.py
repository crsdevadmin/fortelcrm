import json
import sys

from .database import SessionLocal
from .services.sms_notifications import send_weekly_sales_sms_reminders


def main() -> int:
    today = sys.argv[1] if len(sys.argv) > 1 else None
    db = SessionLocal()
    try:
        result = send_weekly_sales_sms_reminders(db, today=today)
        print(json.dumps(result, indent=2))
        return 0 if result.get("failed", 0) == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
