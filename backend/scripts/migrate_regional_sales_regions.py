from sqlalchemy import text

from backend.database import engine


STATEMENTS = [
    "ALTER TABLE regional_sales_entries ADD COLUMN IF NOT EXISTS state_code VARCHAR(50) NOT NULL DEFAULT ''",
    "ALTER TABLE regional_sales_entries ADD COLUMN IF NOT EXISTS city VARCHAR(100) NOT NULL DEFAULT ''",
    "UPDATE regional_sales_entries SET state_code = '' WHERE state_code IS NULL",
    "UPDATE regional_sales_entries SET city = '' WHERE city IS NULL",
    "ALTER TABLE regional_sales_entries DROP CONSTRAINT IF EXISTS uq_regional_sales_user_product_week",
    "ALTER TABLE regional_sales_entries DROP CONSTRAINT IF EXISTS uq_regional_sales_region_product_week",
    """
    ALTER TABLE regional_sales_entries
    ADD CONSTRAINT uq_regional_sales_region_product_week
    UNIQUE (associate_id, state_code, city, product_id, year, month, week)
    """,
]


def main():
    with engine.begin() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))
    print("regional sales region migration ok")


if __name__ == "__main__":
    main()
