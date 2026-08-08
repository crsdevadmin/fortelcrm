"""Idempotent production schema cleanup for the authentication hardening release."""

from sqlalchemy import text

from ..database import engine


def run():
    if engine.dialect.name != "postgresql":
        print("Security migration skipped: PostgreSQL-only schema change")
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS plain_password"))
        connection.execute(text(
            "ALTER TABLE regional_sales_week_pdfs "
            "ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20) NOT NULL DEFAULT 'unverified'"
        ))
        connection.execute(text(
            "ALTER TABLE regional_sales_week_pdfs "
            "ADD COLUMN IF NOT EXISTS total_label VARCHAR(50)"
        ))
        connection.execute(text(
            "UPDATE regional_sales_week_pdfs "
            "SET validation_status = 'unverified', matches = FALSE "
            "WHERE total_label IS NULL"
        ))
        connection.execute(text(
            "ALTER TABLE weekly_management_reports "
            "ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1"
        ))
        connection.execute(text(
            "ALTER TABLE weekly_management_reports "
            "DROP CONSTRAINT IF EXISTS uq_weekly_management_report_viewer_scope_period"
        ))
        connection.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_weekly_management_report_viewer_scope_period_version'
                ) THEN
                    ALTER TABLE weekly_management_reports
                    ADD CONSTRAINT uq_weekly_management_report_viewer_scope_period_version
                    UNIQUE (viewer_id, scope, year, month, week, version);
                END IF;
            END $$
        """))
    print("Security/reporting migration complete")


if __name__ == "__main__":
    run()
