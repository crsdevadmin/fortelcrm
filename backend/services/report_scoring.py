"""Pure weekly scorecard arithmetic, kept separate so business rules are testable."""

SCORING_WEIGHTS = {
    "doctor_sales": 25,
    "regional_sales": 20,
    "investment_recovery": 20,
    "visit_coverage": 15,
    "weekly_compliance": 10,
    "task_completion": 10,
}


def _cap100(value):
    return max(0.0, min(100.0, float(value or 0)))


def score_people(base_rows, recovery_rows):
    recovery_by_owner = {}
    allowed_ids = {int(row["user_id"]) for row in base_rows}
    for recovery in recovery_rows:
        owner_id = int(recovery.get("manager_id") or 0)
        if owner_id not in allowed_ids:
            continue
        bucket = recovery_by_owner.setdefault(
            owner_id,
            {"expected": 0.0, "sales": 0.0, "at_risk": 0, "breached": 0},
        )
        bucket["expected"] += float(recovery.get("expected_sales") or 0)
        bucket["sales"] += float(recovery.get("sales_captured") or 0)
        if recovery.get("worst_status") == "At Risk":
            bucket["at_risk"] += 1
        elif recovery.get("worst_status") == "Breached":
            bucket["breached"] += 1

    output = []
    for source_row in base_rows:
        row = dict(source_row)
        factors = []
        reasons = []
        reason_details = []

        def add_reason(reason, metric, gap_value=0.0, current_value=None, target_value=None, gap_unit=None):
            reasons.append(reason)
            reason_details.append({
                "reason": reason,
                "metric": metric,
                "gap_value": round(max(float(gap_value or 0), 0.0), 2),
                "gap_unit": gap_unit,
                "current_value": round(float(current_value), 2) if current_value is not None else None,
                "target_value": round(float(target_value), 2) if target_value is not None else None,
            })

        doctor_count = int(row.get("doctor_count") or 0)
        doctor_sales = float(row.get("doctor_sales") or 0)
        doctor_target = float(row.get("doctor_target") or 0)
        doctor_pct = None
        if doctor_count:
            if row.get("doctor_target_available") and doctor_target > 0:
                doctor_pct = doctor_sales / doctor_target * 100
                if doctor_pct < 80:
                    add_reason(
                        "Doctor sales below target", "doctor_sales",
                        doctor_target - doctor_sales, doctor_sales, doctor_target, "currency",
                    )
            else:
                doctor_pct = 0.0
                add_reason("Doctor target not set", "doctor_sales")
            factors.append((doctor_pct, SCORING_WEIGHTS["doctor_sales"]))

            visit_pct = float(row.get("visit_coverage_pct") or 0)
            factors.append((visit_pct, SCORING_WEIGHTS["visit_coverage"]))
            if visit_pct < 60:
                add_reason("Low visit coverage", "visit_coverage")
        else:
            visit_pct = None

        regional_sales = float(row.get("regional_sales") or 0)
        regional_target = float(row.get("regional_target") or 0)
        regional_pct = None
        if row.get("regional_required"):
            if row.get("regional_target_available") and regional_target > 0:
                regional_pct = regional_sales / regional_target * 100
                if regional_pct < 80:
                    add_reason(
                        "Regional sales below target", "regional_sales",
                        regional_target - regional_sales, regional_sales, regional_target, "currency",
                    )
            else:
                regional_pct = 0.0
                add_reason("Regional target not set", "regional_sales")
            factors.append((regional_pct, SCORING_WEIGHTS["regional_sales"]))

        recovery = recovery_by_owner.get(
            int(row["user_id"]),
            {"expected": 0.0, "sales": 0.0, "at_risk": 0, "breached": 0},
        )
        recovery_pct = None
        if recovery["expected"] > 0:
            recovery_pct = recovery["sales"] / recovery["expected"] * 100
            factors.append((recovery_pct, SCORING_WEIGHTS["investment_recovery"]))
            recovery_gap = recovery["expected"] - recovery["sales"]
            if recovery["breached"]:
                add_reason(
                    f"{recovery['breached']} recovery breached", "investment_recovery",
                    recovery_gap, recovery["sales"], recovery["expected"], "currency",
                )
            elif recovery["at_risk"]:
                add_reason(
                    f"{recovery['at_risk']} recovery at risk", "investment_recovery",
                    recovery_gap, recovery["sales"], recovery["expected"], "currency",
                )

        expected = int(row.get("weekly_expected") or 0)
        weekly_score = None
        if expected:
            submitted = int(row.get("weekly_submitted") or 0)
            uploaded = int(row.get("weekly_pdf_uploaded") or 0)
            matched = int(row.get("weekly_pdf_matched") or 0)
            weekly_score = submitted / expected * 60 + uploaded / expected * 20 + matched / expected * 20
            factors.append((weekly_score, SCORING_WEIGHTS["weekly_compliance"]))
            if expected > submitted:
                add_reason("Weekly update missing", "weekly_compliance")
            if submitted > uploaded:
                add_reason("Weekly PDF missing", "weekly_compliance")
            if int(row.get("weekly_pdf_unverified") or 0):
                add_reason("Weekly PDF unverified", "weekly_compliance")
            elif uploaded > matched:
                add_reason("PDF mismatch", "weekly_compliance")

        task_total = int(row.get("task_total") or 0)
        task_score = None
        if task_total:
            task_score = int(row.get("task_completed") or 0) / task_total * 100
            factors.append((task_score, SCORING_WEIGHTS["task_completion"]))
            if task_score < 100:
                add_reason(
                    "Tasks incomplete", "task_completion",
                    task_total - int(row.get("task_completed") or 0),
                    int(row.get("task_completed") or 0), task_total, "count",
                )

        overdue = int(row.get("overdue_tasks") or 0)
        if overdue:
            add_reason(f"{overdue} overdue tasks", "tasks")
        pending = int(row.get("pending_investments") or 0) + int(row.get("pending_sales") or 0)
        if pending:
            add_reason(f"{pending} pending approvals", "approvals")

        total_weight = sum(weight for _, weight in factors)
        score = round(sum(_cap100(value) * weight for value, weight in factors) / total_weight) if total_weight else None
        if score is None:
            status = "unassigned"
            add_reason("No assigned workload or measurable activity", "assignment")
        else:
            critical = bool(recovery["breached"] or overdue or score < 50)
            status = "red" if critical else "amber" if score < 75 or reasons else "green"

        output.append({
            **row,
            "score": score,
            "status": status,
            "applicable_weight": total_weight,
            "doctor_sales_pct": round(doctor_pct, 1) if doctor_pct is not None else None,
            "regional_sales_pct": round(regional_pct, 1) if regional_pct is not None else None,
            "recovery_expected": round(recovery["expected"], 2),
            "recovery_sales": round(recovery["sales"], 2),
            "recovery_pct": round(recovery_pct, 1) if recovery_pct is not None else None,
            "recovery_at_risk": recovery["at_risk"],
            "recovery_breached": recovery["breached"],
            "visit_coverage_pct": round(visit_pct, 1) if visit_pct is not None else None,
            "weekly_score": round(_cap100(weekly_score)) if weekly_score is not None else None,
            "task_score": round(_cap100(task_score)) if task_score is not None else None,
            "reasons": reasons,
            "reason_details": reason_details,
        })

    return sorted(output, key=lambda item: (item["score"] is None, -(item["score"] or 0), item["name"]))
