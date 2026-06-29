FORTEL CRM — Doctor Investment, ROI & Growth Platform
======================================================

STACK
------
Backend  : Python 3.11 + FastAPI + SQLAlchemy
Database : PostgreSQL (AWS RDS)
Storage  : AWS S3 (bill/invoice uploads)
Auth     : Google OAuth 2.0 (or swap with AWS Cognito)
Frontend : React (to be built next)


FOLDER STRUCTURE
-----------------
fortel-crm/
└── backend/
    ├── main.py              ← App entry point
    ├── database.py          ← DB connection
    ├── seed.py              ← Load initial data
    ├── requirements.txt     ← Python dependencies
    ├── .env.example         ← Copy to .env and fill in
    ├── core/
    │   └── config.py        ← All environment settings
    ├── models/
    │   └── models.py        ← All database tables
    ├── auth/
    │   └── google_oauth.py  ← Login flow
    └── routers/
        ├── users.py         ← User management + approvals
        ├── sales.py         ← Week-wise sales entry
        ├── roi.py           ← ROI calculation engine
        ├── investments.py   ← PD/RD/CS investments + S3 upload
        └── regions.py       ← Indian state → manager assignment


SETUP (LOCAL)
--------------
1. Install Python 3.11 from https://python.org

2. Open terminal in this folder and run:
   pip install -r backend/requirements.txt

3. Copy .env.example to .env and fill in your values:
   - DATABASE_URL (your PostgreSQL connection string)
   - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
   - SECRET_KEY (run: python -c "import secrets; print(secrets.token_hex(32))")

4. For local database (without AWS RDS), install Docker and run:
   docker run -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=fortelcrm -p 5432:5432 postgres:15
   Then set: DATABASE_URL=postgresql://postgres:pass@localhost:5432/fortelcrm

5. Start the API:
   uvicorn backend.main:app --reload --port 8000

6. Open Swagger docs to test all endpoints:
   http://localhost:8000/docs

7. Seed initial data (products, doctors, your MD user):
   python -m backend.seed


API ENDPOINTS
--------------
POST  /auth/google/login          → Redirect to Google login
GET   /auth/google/callback       → Returns JWT token
GET   /auth/me                    → Current user info

GET   /users/                     → List all users
GET   /users/pending-approvals    → Users waiting for approval
POST  /users/{id}/approve         → Approve + assign role
POST  /users/{id}/reject          → Reject access
GET   /users/hierarchy            → Full MD→Dir→Mgr→Assoc tree
PATCH /users/{id}/change-reporting → Reassign reporting line

POST  /sales/submit               → Submit week-wise sales entry
GET   /sales/doctor/{id}/monthly  → Weekly breakdown per doctor
GET   /sales/by-product           → Sales totals per product

POST  /investments/submit         → Add PD/RD/CS investment + bill
GET   /investments/doctor/{id}    → All investments for a doctor
GET   /investments/pending-approvals → Amounts >₹25k pending

GET   /roi/doctor/{id}            → ROI for one doctor
GET   /roi/all-doctors            → ROI for all doctors (MD view)
GET   /roi/grade-summary          → Platinum/Gold/Silver/Bronze counts
GET   /roi/at-risk                → Doctors with ROI <3x or CA% <60%

GET   /regions/states             → All 27 Indian states
GET   /regions/                   → All regions with assigned managers
POST  /regions/assign             → Assign manager to states
DELETE /regions/{code}/remove-manager → Remove manager from state


AWS DEPLOYMENT
---------------
1. RDS PostgreSQL
   - AWS Console → RDS → Create database → PostgreSQL 15
   - Instance: db.t3.micro (free tier) to start
   - Region: ap-south-1 (Mumbai)

2. EC2 App Server
   - Ubuntu 22.04, t3.small
   - SSH in, install Python 3.11
   - Copy project files, pip install, set .env
   - Run: uvicorn backend.main:app --host 0.0.0.0 --port 8000
   - Use nginx as reverse proxy + certbot for SSL

3. S3 Bucket
   - Create: fortel-crm-uploads in ap-south-1
   - Private bucket, use presigned URLs

4. Domain
   - Register on Route 53 or GoDaddy
   - Point to EC2 Elastic IP
   - SSL: sudo certbot --nginx -d yourdomain.in
