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
from passlib.context import CryptContext
ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
new_hash = ctx.hash("admin2026")

conn = psycopg2.connect(host=host, port=int(port), database=db, user=user, password=pwd)
conn.autocommit = True
cur = conn.cursor()

# Check if admin exists
cur.execute("SELECT id, email FROM users WHERE email = 'admin@fortel.in'")
row = cur.fetchone()
if row:
    cur.execute("UPDATE users SET password_hash=%s, is_active=TRUE WHERE email='admin@fortel.in'", (new_hash,))
    print(f"Updated admin password. ID={row[0]}")
else:
    cur.execute("""
        INSERT INTO users (name, email, password_hash, role, is_active)
        VALUES ('Admin', 'admin@fortel.in', %s, 'admin', TRUE)
    """, (new_hash,))
    print("Created admin user.")

conn.close()
print("Done. Login: admin@fortel.in / admin2026")
