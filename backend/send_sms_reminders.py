import argparse
import json

from .database import SessionLocal
from .services.sms_notifications import send_weekly_sales_sms_reminders


def main() -> int:
    parser = argparse.ArgumentParser(description="Send Fortel weekly sales SMS reminders")
    parser.add_argument("--stage", choices=("rep", "manager", "all"), default="all")
    parser.add_argument("--today", default=None, help="Optional YYYY-MM-DD date for testing")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        result = send_weekly_sales_sms_reminders(db, today=args.today, stage=args.stage)
        print(json.dumps(result, indent=2))
        return 0 if result.get("failed", 0) == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
