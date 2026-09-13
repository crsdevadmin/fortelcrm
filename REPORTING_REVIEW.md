# Fortel CRM — Reporting Review

**Date:** 8 Aug 2026
**Scope:** Weekly Management Report, rep scorecard, dashboards, Excel exports
**Files:** `routers/reports.py`, `routers/dashboard.py`, `routers/exports.py`, `routers/sales.py`, `scripts/generate_weekly_reports.py`

This is separate from the security review — nothing here is a security issue. It is about whether the numbers are right, whether they mean what people think they mean, and whether the reports actually get used.

---

## Verdict

The report *structure* is genuinely good. A weighted six-factor scorecard, RAG status, per-person reasons, territory rollups, top doctors/products, snapshot persistence, scheduled generation, PDF output — that is a more thoughtful design than most CRMs of this size have.

The problem is the arithmetic underneath. **Three defects mean the weekly report currently rewards inactivity, and its main data-quality control cannot fail.** If this drives performance conversations, it is actively misinforming them.

Everything below is verified against the code, not inferred.

| Priority | Theme | Count |
|---|---|---|
| R0 — Wrong numbers | 3 |
| R1 — Meaning & trust | 4 |
| R2 — Usefulness | 5 |
| R3 — Reach & polish | 4 |

---

## R0 — The numbers are wrong

### R0-1. The scorecard scores an inactive rep 100/100, green, top of the list

Every "no data" branch in `_score_people` (`reports.py:88-135`) defaults to **100**:

| Factor | Weight | Value when there is no data | Source |
|---|---|---|---|
| Doctor sales | 25% | `100.0` if `doctor_count == 0` | `reports.py:91` |
| Regional sales | 20% | `100.0` if not `regional_required` | `reports.py:96` |
| Investment recovery | 20% | `100.0` if no expected recovery | `reports.py:98` |
| Visit coverage | 15% | `100.0` if `doctor_count == 0` | `dashboard.py:966-968` |
| Weekly compliance | 10% | `100.0` if `weekly_expected == 0` | `reports.py:101-105` |
| Task completion | 10% | `100.0` if `task_total == 0` | `reports.py:106-109` |

I ran the scoring function with an empty row. The result:

```
Inactive rep (no doctors, no territory, no tasks, no visits)
  → score: 100 | reasons: [] | status: GREEN

Rep hitting 80% of doctor target, 75% regional, 85% visit coverage
  → score: 79 | status: AMBER
```

Because `_score_people` ends with `sorted(key=lambda row: (-row["score"], ...))` (`reports.py:154`), the person doing nothing sorts **above** the person doing well. `reasons` is empty for them, so the "why" column offers no clue, and the action list skips them entirely.

This is the single most damaging thing in the codebase. The report was built to surface underperformance and it does the opposite.

**Fix.** Absence of data is not achievement. Distinguish three cases explicitly:

- **Not applicable** — factor genuinely does not apply to this role. Drop it and *renormalise the remaining weights* rather than scoring 100.
- **Applicable but missing** — score 0 and add a reason like "No doctors assigned" or "No target set".
- **Applicable and measured** — score normally.

```python
factors = []                      # (value, weight, reason_if_low)
if row["doctor_count"]:
    factors.append((doctor_pct, 25, "Doctor sales below target"))
elif viewer_expects_doctors(row):
    factors.append((0.0, 25, "No doctors assigned"))
# else: omit entirely — weight redistributes

total_weight = sum(w for _, w, _ in factors)
score = round(sum(cap100(v) * w for v, w, _ in factors) / total_weight * 100) if total_weight else None
```

A person with no applicable factors should render as **"No data"**, not as a number. Never as green.

### R0-2. Week numbers are compared against day-of-month in four places

`SalesEntry.week` holds 1-4 (confirmed by `uq_sales_entry` in `models.py:247` and by `_week_bounds`). Four queries compare it to a day-of-month value in the range 1-31:

```python
# reports.py:206
(SalesEntry.sale_date.is_(None)) & (SalesEntry.week >= start.day) & (SalesEntry.week <= report_end.day)

# reports.py:214
(SalesEntry.sale_date.is_(None)) & (SalesEntry.week <= report_end.day)

# dashboard.py:790
(SalesEntry.sale_date.is_(None)) & (SalesEntry.week <= ref_date.day)

# sales.py:646-653
start_day, end_day = _week_bounds(week)     # → (1,7) (8,14) (15,21) (22,31)
q = db.query(...).filter(SalesEntry.week >= start_day, SalesEntry.week <= end_day)
```

Working through `reports.py:206` by week:

| Report week | Day range | Filter becomes | Rows matched |
|---|---|---|---|
| 1 | 1-7 | `week BETWEEN 1 AND 7` | **all** weeks 1-4 |
| 2 | 8-14 | `week BETWEEN 8 AND 14` | **none** |
| 3 | 15-21 | `week BETWEEN 15 AND 21` | **none** |
| 4 | 22-31 | `week BETWEEN 22 AND 31` | **none** |

So every legacy sales row without a `sale_date` is counted **entirely in week 1** and vanishes from weeks 2, 3 and 4. Week 1 is inflated by up to 4×; the rest are understated.

`sales.py:646` is the worst instance because it feeds PDF validation — for weeks 2, 3 and 4 `entered_total` is always `0`, so every upload is reconciled against zero.

**Fix.** These should compare week to week:

```python
(SalesEntry.sale_date.is_(None)) & (SalesEntry.week >= week_start_no) & (SalesEntry.week <= week_no)
```

Then backfill `sale_date` for legacy rows and delete the `is_(None)` branch entirely — carrying two parallel time models is what caused this.

### R0-3. PDF validation is structurally incapable of failing

`validate_week_pdf` (`sales.py:667-690`) extracts every number from the uploaded PDF, then:

```python
closest = min(unique_amounts, key=lambda v: abs(v - entered_total))
...
"matches": closest is not None and abs(difference) <= tolerance
```

It searches the PDF for whichever number is nearest the figure the rep typed in, then checks whether that number is near the figure the rep typed in. The answer is yes by construction, provided the PDF contains any number in the vicinity — an invoice line, a page count, part of a date, a phone number.

Tolerance is `max(1.0, entered_total * 0.001)` — 0.1%. On a ₹5,00,000 week that is a ₹500 window, and a document of any length will land something in it.

Stacked with R0-2, for weeks 2-4 `entered_total` is `0`, so it selects the *smallest* number in the document and compares it to zero.

This matters beyond the check itself: `weekly_pdf_matched` is 20% of the weekly-compliance factor (`reports.py:104`), so a fifth of that score is noise.

**Fix.** Validation has to be anchored in the document, not in the expected answer:

1. Locate a labelled total — regex for `Total|Grand Total|Net Amount` and take the number on that line.
2. If no label is found, return `"unverified"`. That is a legitimate and useful outcome; silently matching is not.
3. Never let the expected value influence extraction.
4. Store the extracted value and the label matched, so disputes are reviewable.
5. Add a third state to the model. Right now `matches` is a boolean and cannot express "could not tell", which is the honest answer most of the time.

---

## R1 — Meaning and trust

### R1-1. "Week 4" is 7-10 days long, so every comparison is distorted

`_week_dates` (`reports.py:53-56`) buckets by day-of-month: 1-7, 8-14, 15-21, 22-end. Week 4 runs 7 days in February and 10 in a 31-day month — 43% longer.

Consequences: week 4 always looks like the strongest week; no week aligns to Monday-Sunday, though the SMS reminders promise "Monday 5 PM" and "Tuesday 10 AM" deadlines (`config.py:35-36`); and week-over-week comparison is not valid arithmetic.

**Fix.** Either move to ISO weeks (Mon-Sun, `date.isocalendar()`) and accept that weeks straddle months, or keep day buckets but publish a normalised per-day rate alongside the total so the comparison is fair. ISO weeks are the better answer if the business genuinely runs Monday-to-Monday, which the SMS deadlines imply it does.

### R1-2. Scoring weights are defined twice and can silently disagree

`dashboard.py:980-987` returns weights to the client:

```python
"weights": {"doctor_sales": 25, "regional_sales": 20, "investment_recovery": 20,
            "visit_coverage": 15, "weekly_compliance": 10, "task_completion": 10}
```

`reports.py:130-132` applies them as literals:

```python
cap100(doctor_pct) * .25 + cap100(regional_pct) * .20 + cap100(recovery_pct) * .20
+ cap100(row["visit_coverage_pct"]) * .15 + cap100(weekly_score) * .10 + cap100(task_score) * .10
```

Two copies of the same truth in two files. Change one and the UI documents a formula the system is not using — undetectably, because nothing tests it.

**Fix.** One `SCORING_WEIGHTS` constant, imported by both. Longer term put it in the database so the MD can retune without a deploy; scoring weights are a business rule, not a constant.

### R1-3. Regenerating a report destroys the version people were sent

`save_weekly_report` (`reports.py:344-352`) overwrites `payload_json` in place when `refresh=True`. The scheduled job passes `refresh=True` on every run (`scripts/generate_weekly_reports.py:37`), and the UI can trigger it too.

Because the unique key is `(viewer, scope, year, month, week)`, there is exactly one row per period and no history. Once a bug is fixed or data is backdated, last month's report silently changes. You cannot reconstruct the numbers that were actually circulated, which is a problem when the report drives performance discussions.

**Fix.** Make snapshots append-only: add a `version` column, insert rather than update, serve the latest by default, keep prior versions retrievable. Store the app version or git SHA in the payload so a number can be traced to the code that produced it.

### R1-4. Snapshots are served without any staleness signal

If a record exists and `refresh` is not set, the cached payload is returned unconditionally (`reports.py:330-331`). A report generated on Tuesday for a week ending Friday is served forever as that week's report, with `week_end` showing the *truncated* date (`report_end = min(end, today)`, `reports.py:165`) but nothing marking it partial.

**Fix.** Add `is_partial: bool` and `covers_through` to the payload, and render a banner: *"Partial — covers Mon-Tue only. Refresh for the full week."* Auto-refresh any snapshot whose `week_end` is before the true week end.

---

## R2 — Making the reports more useful

### R2-1. There is no comparison to anything

I searched `reports.py` for trend logic: zero occurrences of prior-period, delta, or change. Every number is an absolute with no baseline.

"₹12.4L this week" is nearly meaningless. "₹12.4L, up 8% on last week, 94% of target, best week this quarter" is a decision.

**Fix.** This is the highest-value addition and the data is already stored. For each headline metric add:

- previous week and the % change
- same week last month, and last year if available
- attainment against target (already computed per person — roll it up)
- 4-week moving average to damp weekly noise

`WeeklyManagementReport` already holds prior snapshots, so the previous week is one query, not a recomputation.

### R2-2. No exception reporting — everything is shown at once

`build_weekly_payload` returns all people, all territories, and a flat `actions` list built from every reason for every person (`reports.py:292-295`). A manager with 30 reports gets a wall of rows and has to find the problems themselves.

**Fix.** Lead with what changed and what needs a decision:

- **Movers** — biggest week-over-week swings, up and down, in both directions
- **Newly red** — people or territories that changed status this week (needs R1-3's history)
- **Streaks** — third consecutive week below target; that is the signal, not a single bad week
- **Top 3 actions** — ranked by revenue at risk, not listed alphabetically

Keep the full table below the fold.

### R2-3. Nothing quantifies the money at stake

`actions` entries are `{person, reason, status}` (`reports.py:293`). "Doctor sales below target" for a rep who is ₹2,000 short and one who is ₹4,00,000 short are the same row.

**Fix.** Attach a value to every action — target shortfall, expected recovery at risk, investment with no matching sales — and sort by it. The recovery data already carries `expected_sales` and `sales_captured` (`reports.py:78-80`), so the gap is available.

### R2-4. Investment and sales are reported side by side but never divided

The report shows `investment_week` and `doctor_week` as separate totals (`reports.py:305-307`). ROI is the product's whole premise — the app is described as a "Doctor Investment, ROI and Growth Platform" (`main.py:26`) — yet the weekly report never puts them together.

**Fix.** Add per-territory and per-doctor ROI (sales ÷ investment) with the prior period alongside, and flag the two tails: doctors with high investment and no sales response, and doctors performing well on low investment. Those two lists are the ones an MD acts on.

### R2-5. Reports cannot be exported or shared in the format managers work in

There is a PDF (`reports.py:561`) and there are Excel exports (`exports.py`), but they are separate features. The weekly report cannot be exported to Excel, so any manager who wants to sort or pivot has to retype it.

**Fix.** Reuse the `_xlsx_response` helper from `exports.py:50` to add `GET /reports/weekly/{id}/xlsx` — one sheet per section. Low effort, and it is what will actually get forwarded.

---

## R3 — Reach and polish

### R3-1. Reports are generated but never delivered

`scripts/generate_weekly_reports.py` runs on a timer and saves snapshots. There is no email, no SMS, no push. Managers only see the report if they remember to log in and navigate to it.

Meanwhile SMS reminders exist to chase people *into* the app (`services/sms_notifications.py`), so the channel is already built and DLT-registered. You are pushing hard on data entry and not at all on the output.

**Fix.** Email the PDF on generation via SES — `boto3` is already a dependency and AWS credentials are configured. An SMS saying "Your weekly report is ready — 3 reds need attention" using the existing sender ID would cost almost nothing to add.

### R3-2. Territory rollups are computed in Python, row by row

`build_weekly_payload` pulls every sale, investment and visit into memory and loops to bucket them by territory (`reports.py:216-263`), because `territory_for_city()` is Python-only. Every report scans the full month twice (week + MTD).

At current volumes this is fine. It will not survive a year of data, and the scheduled job runs it once per manager.

**Fix.** Denormalise `territory` onto `Doctor` and `RegionalSalesEntry` at write time, then aggregate with `GROUP BY` in SQL. Report generation drops from many thousands of rows in Python to a handful of grouped queries.

### R3-3. `exports.py` re-implements the hierarchy walk

`_subordinate_ids` (`exports.py:58-68`) duplicates `utils/hierarchy.get_subtree_ids`. Interestingly this copy is the *correct* one — it has the `if sid not in result` cycle guard that `hierarchy.py` lacks (see P1-2 in the security review) — but it issues one query per node instead of one query total.

**Fix.** Delete `_subordinate_ids`, use the shared helper, and port its cycle guard into `hierarchy.py`.

### R3-4. Currency formatting is inconsistent and hand-rolled

`_fmt_money` (`reports.py:59-67`) renders `Rs.12.4L`, while `exports.py:99` uses `Value (₹)`. Lakh/crore abbreviation is correct for the audience but implemented ad hoc, and PDF and Excel disagree on the symbol.

**Fix.** One shared formatter used by PDF, Excel and the API. Keep `₹` throughout — the `Rs.` fallback suggests a font issue in ReportLab, which is fixable by registering a Unicode font rather than degrading the output.

---

## Suggested order

**Fix before the next report goes out** — these three make the current output misleading:

1. R0-1 — no-data-scores-100. Highest impact, roughly an hour's work, and it changes who appears at the top of every list.
2. R0-2 — week vs day comparison in four places, plus a backfill of `sale_date`.
3. R0-3 — PDF validation, at minimum returning `"unverified"` instead of a false match.

**Then, to make the numbers trustworthy:** R1-2 (single weights constant), R1-3 (versioned snapshots), R1-4 (partial-week banner), R1-1 (week definition — schedule this one, it needs a business decision about ISO weeks).

**Then, to make the report worth opening:** R2-1 (period comparison) is the biggest single improvement to usefulness, followed by R2-2 (exception-first layout) and R3-1 (actually deliver it).

One caveat on all of this: there are no tests anywhere in the repo, and the scoring logic in `_score_people` is dense conditional arithmetic. Before changing any of it, write tests that pin the current behaviour for a handful of representative rows — including the empty one. Otherwise you will not be able to tell a fix from a regression.
