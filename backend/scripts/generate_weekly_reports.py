from datetime import date, timedelta

from ..database import SessionLocal
from ..models.models import User
from ..routers.reports import save_weekly_report


MANAGEMENT_ROLES = {"md", "director", "senior_manager", "manager"}


def main():
    today = date.today()
    current_week = min(4, max(1, ((today.day - 1) // 7) + 1))
    if current_week > 1:
        completed_day = today.replace(day=(current_week - 1) * 7)
        week = current_week - 1
    else:
        completed_day = (today.replace(day=1) - timedelta(days=1))
        week = 4
    db = SessionLocal()
    generated = 0
    failed = 0
    try:
        active_users = db.query(User).filter(User.is_active == True).all()
        reportees_by_manager = {user.reports_to_id for user in active_users if user.reports_to_id}
        managers = [
            user for user in active_users
            if user.role in MANAGEMENT_ROLES or (user.role == "custom" and user.id in reportees_by_manager)
        ]
        for manager in managers:
            try:
                save_weekly_report(
                    viewer_id=manager.id,
                    year=completed_day.year,
                    month=completed_day.month,
                    week=week,
                    scope="overall",
                    db=db,
                    refresh=True,
                )
                generated += 1
            except Exception as exc:
                db.rollback()
                failed += 1
                print(f"Weekly report failed for user {manager.id}: {exc}")
        print(f"Weekly reports complete: {generated} generated, {failed} failed")
    finally:
        db.close()


if __name__ == "__main__":
    main()
