# Fortel CRM — Code Review

**Date:** 8 Aug 2026
**Scope:** Full audit of `fortel-crm` (FastAPI backend + React frontend)
**Commit reviewed:** `869220e` "Automate weekly sales SMS reminders"

---

## Verdict

The application logic is well-organised and the domain modelling is solid. The problem is that **almost none of it is protected**. The frontend sends a JWT on every request; the backend ignores it on 90 of 96 endpoints and instead trusts user IDs supplied in the query string.

Two of the findings below (P0-1, P0-2) mean that anyone who can reach the API URL — no login required — can read every user's password in plaintext and take over the MD account. If this API is publicly reachable, treat it as an active incident, not a backlog item.

The good news: `routers/notifications.py` and `routers/reports.py` already implement the correct pattern. The fix is to apply that pattern everywhere, and it does **not** require frontend changes, because the client already sends the token.

| Severity | Count |
|---|---|
| P0 — Critical | 4 |
| P1 — High | 5 |
| P2 — Medium | 6 |
| P3 — Low / hygiene | 5 |

---

## P0 — Critical

### P0-1. Every user's password is stored and served in plaintext

`models/models.py:74` defines `plain_password = Column(String(200))`. It is populated on user creation (`routers/users.py:89`), on self-service password change (`auth/auth.py:117`) and on admin reset (`auth/auth.py:134`).

`GET /users/` returns it (`routers/users.py:139`):

```python
"plain_password": getattr(u, 'plain_password', None),
```

That endpoint has no authentication (see P0-2), so an unauthenticated `curl` returns the working password for every account in the company. Because staff reuse passwords, the blast radius extends past this app.

This is not a bug — `screens/AdminUsers.jsx:412-415` deliberately renders it behind a reveal toggle. It is a product decision that needs replacing.

**Fix.** Drop the column, delete the reads, and use the flow you already have: `POST /users/create` returns `temp_password` (`routers/users.py:112`) and `POST /auth/admin/reset-password` returns `new_password`. Admins get a one-time password at the moment of reset; nothing durable is stored. Then rotate every password in the database, since they must be assumed disclosed.

### P0-2. 90 of 96 endpoints have no authentication

Only six endpoints read the `Authorization` header:

```
POST /notifications/sales-reminders/sms
GET  /notifications/sales-reminders/sms/logs
GET  /reports/weekly
GET  /reports/weekly/history
GET  /reports/weekly/{report_id}/pdf
GET  /roi/doctor/{doctor_id}/full
```

Everything else takes a caller-supplied identifier — `viewer_id`, `associate_id`, `actor_id`, `approver_id`, `manager_id` — and trusts it. Changing a number in the URL is enough to act as any user. Concretely:

- `GET /users/` — full staff directory including plaintext passwords; `viewer_id` is optional, so omitting it skips scoping entirely (`routers/users.py:120-128`)
- `DELETE /users/{user_id}`, `PATCH /users/{user_id}`, `POST /users/create` — unauthenticated user administration
- `DELETE /doctors/{doctor_id}`, `POST /doctors/create` — unauthenticated master-data writes
- `PATCH /investments/{id}/approve`, `POST /sales/{entry_id}/approve` — approval workflows bypassable, `approved_by_id` is just a number you pass in
- `GET /exports/sales`, `/exports/doctor-master` — bulk export of the entire commercial dataset

`routers/targets.py:41` looks like a guard but is not:

```python
def _require_md(actor_id: int, db: Session) -> User:
    actor = db.query(User).filter(User.id == actor_id, ...).first()
    if actor.role != "md":
        raise HTTPException(403, "Only MD can manage targets")
```

`actor_id` comes from the request. Passing the MD's user ID satisfies it. This is authorisation with no authentication underneath — the most dangerous shape, because it reads as protected in review.

**Fix.** Add one dependency in `auth/auth.py` and apply it router-wide:

```python
def get_current_user(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> User:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Login required")
    data = decode_token(authorization.split(" ", 1)[1].strip())
    user = db.query(User).filter(User.id == int(data["sub"]),
                                 User.is_active == True).first()
    if not user:
        raise HTTPException(401, "User account is not active")
    return user

def require_roles(*roles):
    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Not permitted")
        return user
    return dep
```

Then in `main.py`:

```python
app.include_router(users_router, dependencies=[Depends(get_current_user)])
```

and inside each handler, derive the actor from `current_user.id` rather than accepting it as a parameter. `viewer_id`/`actor_id`/`associate_id` query params should be deleted, not validated — as long as they exist, someone will trust one.

Router-level dependencies mean you cannot forget a new endpoint later, which is how this drifted in the first place.

### P0-3. `POST /auth/admin/reset-password` is unauthenticated and returns the new password

`auth/auth.py:124-137`:

```python
@router.post("/admin/reset-password")
def admin_reset_password(payload: AdminResetPasswordRequest, db: Session = Depends(get_db)):
    """Admin can reset any user's password. Returns the new password."""
    user = db.query(User).filter(User.id == payload.user_id).first()
    ...
    return {"status": "reset", "new_password": new_pwd, "user_email": user.email}
```

The docstring says "Admin can" but nothing checks that the caller is an admin, or logged in at all. One unauthenticated POST with `{"user_id": 1}` resets the MD's password and hands back the new value. Full account takeover in a single request, no prior knowledge needed.

**Fix.** `current_user: User = Depends(require_roles("admin", "md"))`, and refuse resets targeting a user at or above the caller's level in the hierarchy.

### P0-4. Real employee credentials are committed to git

`backend/create_new_users.py` and `backend/create_users.py` contain eight named employees with the shared password `Fortel@2025` in cleartext, printed to stdout on run. `test_login.py:6` contains `admin@fortel.in` / `admin2026`.

Worse, `create_users.py:18` sets `must_reset_password=False` for the MD account — so that password is permanent, not a first-login temporary.

Anyone with repo access, now or in the git history, has working logins.

**Fix.** Rotate all of these first — deletion does not help, the history retains them. Then remove the hardcoded values (read from env or generate), and scrub history with `git-filter-repo` if the repo has ever left your control. `.gitignore` correctly excludes `*.env`, so the discipline exists; these scripts slipped through it.

---

## P1 — High

### P1-1. `CORSMiddleware` allows every origin

`main.py:32-38` sets `allow_origins=["*"]` with `allow_methods=["*"]`. Any website a logged-in user visits can call the API. `allow_credentials=False` limits cookie-based attacks, but the app authenticates with a bearer token from `localStorage`, so that mitigation does not apply here.

**Fix.** `allow_origins=[settings.FRONTEND_URL]`. The setting already exists in `core/config.py:44`.

### P1-2. Reporting-hierarchy cycle hangs the server

`utils/hierarchy.py:30-38` walks the org tree without a visited check:

```python
while queue:
    current = queue.pop(0)
    visible.add(current)
    queue.extend(children_map.get(current, []))
```

If two users report to each other, this never terminates. I simulated it — 100,000 iterations with no exit. It pins a worker at 100% CPU and leaks memory until the process dies; a handful of requests takes the whole API down.

Nothing prevents a cycle: `PATCH /users/{user_id}/reports-to` (`routers/users.py:261`) does no ancestry check, and the presence of `fix_hierarchy.py` in the repo suggests the data has been wrong before.

**Fix.** Two lines in the loop:

```python
while queue:
    current = queue.pop(0)
    if current in visible:
        continue
    visible.add(current)
    queue.extend(children_map.get(current, []))
```

Plus reject cycles at write time in `change_reporting`.

### P1-3. JWTs are unrevocable and long-lived

Tokens last 8 hours (`config.py:9`) with no refresh, no `jti`, no denylist. Deactivating a user (`DELETE /users/{user_id}`) does not invalidate their token — they keep full access until it expires. Same after a password reset.

**Fix.** Short-lived access token plus refresh token, or a `token_version` integer on `User` embedded in the JWT and compared on each request. The latter is roughly 15 lines and enough for this app's scale.

### P1-4. Tokens travel in query strings and request bodies

`GET /auth/me?token=...` (`auth/auth.py:141`) puts the JWT in the URL, where it lands in nginx access logs, browser history and `Referer` headers. `POST /auth/change-password` takes the token in the JSON body (`auth/auth.py:52-54`).

**Fix.** Both should use the `Authorization` header via `get_current_user`. `AuthContext.jsx:38` is the only caller of change-password and already has the token available, so the client change is one line.

### P1-5. No rate limiting on login

`POST /auth/login` has no throttle, lockout or backoff. Combined with a 6-character password minimum (`auth/auth.py:114`) and a known shared default, online brute force is practical. The `@fortel.in` domain check (`auth/auth.py:78`) narrows targets rather than protecting them, and its distinct error message confirms valid domains to an attacker.

**Fix.** `slowapi` on the login route, plus a failed-attempt counter with temporary lockout. Raise the minimum to 12 characters.

---

## P2 — Medium

### P2-1. Duplicate route definition — 70 lines of dead code

`routers/investments.py` defines `DELETE /{investment_id}` twice, at lines 212 and 283, both named `delete_investment`. I verified against FastAPI: the first registration wins and the second is unreachable. The live one requires an `associate_id` query param and returns 422 without it; the dead one has no ownership check at all.

It works today by accident of ordering. Reorder the file and access control silently disappears.

**Fix.** Delete lines 283-291. (The surviving check is still client-supplied — P0-2 covers that.)

### P2-2. Schema is created with `create_all`, not migrations

`main.py:22` calls `Base.metadata.create_all(bind=engine)` on every boot. This creates missing tables but never alters existing ones, so column changes silently do not apply. `alembic` is in `requirements.txt:4` but there is no `alembic/` directory — instead there are hand-rolled scripts (`migrate_add_columns.py`, `migrate_and_import.py`, `scripts/migrate_regional_sales_regions.py`) with no ordering or record of what has run.

**Fix.** Initialise Alembic, autogenerate a baseline from the current schema, stamp production, remove the `create_all` call, and fold the ad-hoc scripts into versioned revisions.

### P2-3. N+1 queries in list and export endpoints

Per-row lookups inside loops, on paths that render dashboards:

- `routers/exports.py:113` — `db.query(User)` per sales entry
- `routers/investments.py:59` and `:244` — `db.query(Doctor)` per investment
- `routers/sales.py:522`, `:566`, `:715` — `Product` and `Doctor` per row
- `routers/users.py:150` — `direct_territories(u.id, db)` per user, so listing 50 users is 51+ queries

At a few hundred rows this is seconds of latency; the export endpoints will time out as data grows.

**Fix.** `selectinload`/`joinedload` on the relationships, or prefetch the IDs into a dict before the loop. `roi.py:311` already does the prefetch pattern correctly — reuse it.

### P2-4. No tests

There is no test suite. `test_login.py` is a manual curl-in-Python script requiring a running server. For an app computing ROI grades, target attainment and commission-adjacent numbers, the arithmetic in `roi.py` (1020 lines), `dashboard.py` (989) and `targets.py` (883) is entirely unverified.

**Fix.** `pytest` + `TestClient` + a SQLite or throwaway-Postgres fixture. Start with the access-control matrix — after P0-2 you want a test proving each role sees only its own subtree — then the ROI grade boundaries.

### P2-5. Unvalidated PDF upload and parsing

`POST /sales/regional/week-pdf` and `POST /sales/validate-week-pdf` accept uploads and run `pypdf` over them (`sales.py:361`, `:665`) with no size cap, page cap or content-type check. Malformed or deliberately nested PDFs consume worker memory and CPU. Extracted bytes are stored in a `LargeBinary` column, so the database grows unbounded.

**Fix.** Cap upload size at nginx and in the handler, cap page count before extraction, verify the magic bytes, and move storage to S3 — `AWS_S3_BUCKET` is already configured (`config.py:22`).

### P2-6. Frontend role guards are cosmetic

`App.jsx:27-31`'s `RoleGuard` reads `user.role` from `localStorage`. Editing that value in devtools unlocks `/users` and `/target-setting`. That is normal and acceptable for a UI — client-side guards are UX, not security — but here there is no server-side check behind them, so it is the only thing standing between a rep and user administration. This becomes a non-issue once P0-2 is fixed; noting it so it is not mistaken for protection in the meantime.

---

## P3 — Low / hygiene

- **Root directory is full of one-off scripts.** `fix_now.py`, `overwrite_main.py`, `apply_backend_patches.py`, `swap_main.bat` and `backend/main_updated.py` are all tracked. `overwrite_main.py` rewrites `main.py` from an embedded string and `main_updated.py` is a stale variant registering `exports` but dropping five other routers. Someone will run one of these on the wrong day. Delete them; git is the undo mechanism.

- **Two entrypoints that differ.** `backend/main.py` does not register the exports router; `run.py` imports the app and adds it. `deploy/fortel.service:11` runs `run:app`, so production is fine — but anyone starting `uvicorn backend.main:app` locally gets 404s on the whole Rep Activity screen. Register `exports` in `main.py` and make `run.py` a thin alias.

- **`python-jose==3.3.0` has known CVEs** (CVE-2024-33663 algorithm confusion, CVE-2024-33664 decompression bomb). Migrate to `pyjwt`, which is what FastAPI's own docs now use.

- **`datetime.utcnow()` is deprecated** in Python 3.12+ and used throughout (`auth/auth.py:36`, model defaults). Replace with `datetime.now(timezone.utc)`. The naive/aware mismatch will bite when comparing timestamps across timezones.

- **`backups/` is tracked in git** — a `.bundle` and a `.zip` of the repo, committed into the repo. Contributes to the 361 MB checkout. Move to object storage and add to `.gitignore`.

- **Two oversized components.** `ROIDashboard.jsx` (3,514 lines) and `Dashboard.jsx` (2,447) with all styling inline. Worth splitting when you next touch them; not urgent.

---

## Suggested order

1. **Today** — rotate every password, including those in `create_users.py`. Restrict the API to the office IP or take it off the public internet until step 2 lands.
2. **This week** — P0-2 (`get_current_user` + router-level dependencies), P0-3, P0-1 (drop `plain_password`), P1-1 (CORS).
3. **Next** — P1-2 (cycle guard, one-line fix, prevents an outage), P1-3, P1-4, P1-5.
4. **Then** — Alembic baseline, an access-control test suite, N+1 cleanup.

Step 2 is the bulk of the work but it is mechanical, and because the frontend already sends the token on every request via `api/client.js`, it should not require client changes beyond removing the now-redundant `viewer_id` params.
