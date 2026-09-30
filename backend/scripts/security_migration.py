"""Idempotent production schema cleanup for the authentication hardening release."""

from sqlalchemy import text

from ..database import Base, engine
from ..models import models  # noqa: F401 - register all tables before create_all


def run():
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name != "postgresql":
        print("Security migration skipped: PostgreSQL-only schema change")
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS plain_password"))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS "
            "bill_validation_status VARCHAR(30) NOT NULL DEFAULT 'review_required'"
        ))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS bill_validation_reason VARCHAR(500)"
        ))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS bill_detected_amount DOUBLE PRECISION"
        ))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS bill_reviewed_by_id INTEGER REFERENCES users(id)"
        ))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS bill_reviewed_at TIMESTAMP"
        ))
        connection.execute(text(
            "ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS bill_review_notes VARCHAR(500)"
        ))
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
        connection.execute(text(
            "ALTER TABLE collection_uploads ADD COLUMN IF NOT EXISTS "
            "stockist_id INTEGER REFERENCES stockists(id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_collection_uploads_stockist_id "
            "ON collection_uploads (stockist_id)"
        ))
        connection.execute(text(
            "UPDATE collection_uploads SET stockist_id = ("
            "SELECT id FROM stockists WHERE normalized_name = 'NEXUS BIOCARE' LIMIT 1"
            ") WHERE stockist_id IS NULL"
        ))
        connection.execute(text(
            "ALTER TABLE collection_uploads "
            "DROP CONSTRAINT IF EXISTS uq_collection_upload_type_checksum"
        ))
        connection.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_collection_upload_type_checksum_stockist'
                ) THEN
                    ALTER TABLE collection_uploads
                    ADD CONSTRAINT uq_collection_upload_type_checksum_stockist
                    UNIQUE (report_type, file_checksum, stockist_id);
                END IF;
            END $$
        """))
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
