import os, sys, re
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), 'backend', '.env'))

DATABASE_URL = os.getenv('DATABASE_URL', '')
m = re.match(r'postgresql://([^:]+):([^@]+)@([^/:]+)(?::(\d+))?/(.+)', DATABASE_URL)
if m:
    user, pwd, host, port, db = m.group(1), m.group(2), m.group(3), m.group(4) or '5432', m.group(5)
else:
    user, pwd, host, port, db = 'postgres', 'postgres', 'localhost', '5432', 'fortelcrm'

import psycopg2
conn = psycopg2.connect(host=host, port=int(port), database=db, user=user, password=pwd)
conn.autocommit = True
cur = conn.cursor()

fixes = [
    # doctors
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS customer_type       VARCHAR(50)  DEFAULT 'doctor'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS client_id           VARCHAR(50)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS client_code         VARCHAR(50)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS firm_name           VARCHAR(200)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS division            VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS prescriber_type     VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS category            VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS approx_business     VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS state_code          VARCHAR(10)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS zone                VARCHAR(100)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS pincode             VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS country             VARCHAR(100) DEFAULT 'INDIA'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS full_address        VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS address2            VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS address3            VARCHAR(500)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS latitude            VARCHAR(30)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS longitude           VARCHAR(30)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS expected_multiple   VARCHAR(10)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS roi_grade           VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS add_date            VARCHAR(20)",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS status              VARCHAR(20)  DEFAULT 'Active'",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS region_id           INTEGER",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS manager_id          INTEGER",
    "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP    DEFAULT NOW()",
    # products — drop NOT NULL on legacy 'rate' column, add new columns
    "ALTER TABLE products ALTER COLUMN rate DROP NOT NULL",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS code        VARCHAR(50)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS composition VARCHAR(500)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS pack        VARCHAR(50)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS price       FLOAT DEFAULT 0.0",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS gst         VARCHAR(10)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp         FLOAT",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS category    VARCHAR(100)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT TRUE",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP DEFAULT NOW()",
    # rep_doctor_mappings
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS associate_id   INTEGER",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS rep_id         INTEGER",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS manager_id     INTEGER",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE",
    "ALTER TABLE rep_doctor_mappings ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP DEFAULT NOW()",
    # investments
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS commercial_model_type VARCHAR(5)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS expected_multiple     FLOAT DEFAULT 5.0",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS expected_sales        FLOAT",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS purpose               TEXT",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS bill_url              VARCHAR(500)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS submitted_at          TIMESTAMP DEFAULT NOW()",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS is_approved           BOOLEAN DEFAULT FALSE",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS approved_by_id        INTEGER",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS approved_at           TIMESTAMP",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS sub_category          VARCHAR(50)",
    "ALTER TABLE investments ADD COLUMN IF NOT EXISTS week                  INTEGER DEFAULT 1",
    # sales_entries
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP DEFAULT NOW()",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS sale_date      VARCHAR(20)",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS remarks        VARCHAR(500)",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMP",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS is_approved    BOOLEAN DEFAULT FALSE",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS approved_by_id INTEGER",
    "ALTER TABLE sales_entries ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMP",
    # users
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_role        VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password      VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP DEFAULT NOW()",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username            VARCHAR(50)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_name    VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone               VARCHAR(20)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS city                VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS state               VARCHAR(200)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_to_id       INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_id       INTEGER",
    # cast enums to varchar
    "ALTER TABLE doctors ALTER COLUMN commercial_model TYPE VARCHAR(5) USING commercial_model::text",
    "ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20) USING role::text",
]

ok = skipped = 0
for sql in fixes:
    try:
        cur.execute(sql)
        print('OK :', sql[30:75])
        ok += 1
    except Exception as e:
        print('-- :', str(e).split('\n')[0][:80])
        skipped += 1

conn.close()
print(f'\nDone: {ok} applied, {skipped} skipped.')

# Backfill doctors.manager_id from rep_doctor_mappings
conn2 = psycopg2.connect(host=host, port=int(port), database=db, user=user, password=pwd)
conn2.autocommit = True
cur2 = conn2.cursor()
cur2.execute("""
    UPDATE doctors d
    SET manager_id = COALESCE(rdm.associate_id, rdm.rep_id)
    FROM rep_doctor_mappings rdm
    WHERE rdm.doctor_id = d.id
      AND rdm.is_active = TRUE
      AND d.manager_id IS NULL
      AND COALESCE(rdm.associate_id, rdm.rep_id) IS NOT NULL
""")
print(f'Backfilled {cur2.rowcount} doctors with manager_id')
conn2.close()
print('All done. Restart uvicorn.')
