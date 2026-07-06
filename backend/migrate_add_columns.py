"""
Run once to add missing columns to existing tables.
Usage: python -m backend.migrate_add_columns
Each statement runs in its own transaction so one failure does not block the rest.
"""
from sqlalchemy import text
from .database import engine

MIGRATIONS = [
    # ── users ──────────────────────────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username         VARCHAR(50)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_name VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone            VARCHAR(20)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS city             VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS state            VARCHAR(200)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_to_id    INTEGER REFERENCES users(id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_id    INTEGER REFERENCES users(id)",
    "UPDATE users SET username = SPLIT_PART(email, '@', 1) WHERE username IS NULL AND email IS NOT NULL",
    "UPDATE users SET username = CONCAT('user', id::text) WHERE username IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)",

    # ── doctors ────────────────────────────────────────────────────────
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS customer_type       VARCHAR(50)  DEFAULT 'doctor'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS client_id           VARCHAR(50)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS gender              VARCHAR(10)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS dob                 VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS anniversary         VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS firm_name           VARCHAR(200)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS qualification       VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS division            VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS prescriber_type     VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS category            VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS approx_business     VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS zone                VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS pincode             VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS country             VARCHAR(100) DEFAULT 'INDIA'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS full_address        VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS address2            VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS address3            VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS latitude            VARCHAR(30)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS longitude           VARCHAR(30)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS expected_multiple   VARCHAR(10)  DEFAULT '5.0'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS roi_grade           VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS add_date            VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS status              VARCHAR(20)  DEFAULT 'Active'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_active           BOOLEAN      DEFAULT TRUE",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS manager_id          INTEGER REFERENCES users(id)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS region_id           INTEGER REFERENCES regions(id)",

    # ── cast any PG-ENUM columns to plain VARCHAR (fixes OID 1043) ────
    "ALTER TABLE doctors ALTER COLUMN commercial_model TYPE VARCHAR(5) USING commercial_model::text",
    "ALTER TABLE investments ALTER COLUMN category TYPE VARCHAR(5) USING category::text",
    "ALTER TABLE investments ALTER COLUMN sub_category TYPE VARCHAR(50) USING sub_category::text",
    "ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20) USING role::text",

    # ── products ───────────────────────────────────────────────────────
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS code     VARCHAR(50)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS price    FLOAT DEFAULT 0.0",

    # ── rep_doctor_mappings ────────────────────────────────────────────
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS associate_id   INTEGER REFERENCES users(id)",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS manager_id     INTEGER REFERENCES users(id)",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE",

    # ── sales_entries ──────────────────────────────────────────────────
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS sale_date      VARCHAR(20)",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS remarks        VARCHAR(500)",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMP",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS is_approved    BOOLEAN DEFAULT FALSE",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS approved_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMP",

    # ── investments ────────────────────────────────────────────────────
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS commercial_model_type VARCHAR(5)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS sub_category          VARCHAR(50)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS bill_url              VARCHAR(500)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS is_approved           BOOLEAN DEFAULT FALSE",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS approved_by_id        INTEGER REFERENCES users(id)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS approved_at           TIMESTAMP",

    # ── visit_logs ─────────────────────────────────────────────────────
    (
        "CREATE TABLE IF NOT EXISTS visit_logs ("
        "id           SERIAL PRIMARY KEY,"
        "associate_id INTEGER NOT NULL REFERENCES users(id),"
        "doctor_id    INTEGER REFERENCES doctors(id),"
        "latitude     FLOAT,"
        "longitude    FLOAT,"
        "address      VARCHAR(500),"
        "visit_time   TIMESTAMP NOT NULL DEFAULT NOW(),"
        "purpose      VARCHAR(100),"
        "notes        TEXT,"
        "created_at   TIMESTAMP DEFAULT NOW()"
        ")"
    ),
]


def run():
    ok = 0
    skipped = 0
    for sql in MIGRATIONS:
        sql = sql.strip()
        if not sql:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
            short = sql[:90].replace('\n', ' ').replace('  ', ' ')
            print(f"  OK  {short}")
            ok += 1
        except Exception as e:
            short = sql[:70].replace('\n', ' ').replace('  ', ' ')
            err = str(e).split('\n')[0][:100]
            print(f"  --  {short}\n      {err}")
            skipped += 1

    print(f"\nDone: {ok} applied, {skipped} skipped/already-exist. Restart uvicorn.")


if __name__ == "__main__":
    run()
