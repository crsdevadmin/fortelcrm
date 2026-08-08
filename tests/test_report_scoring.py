import unittest

from backend.services.report_scoring import score_people


def base_row(**overrides):
    row = {
        "user_id": 7,
        "name": "Rep",
        "doctor_count": 0,
        "doctor_sales": 0,
        "doctor_target": 0,
        "doctor_target_available": False,
        "regional_sales": 0,
        "regional_target": 0,
        "regional_target_available": False,
        "regional_required": False,
        "visit_coverage_pct": 0,
        "weekly_expected": 0,
        "weekly_submitted": 0,
        "weekly_pdf_uploaded": 0,
        "weekly_pdf_matched": 0,
        "weekly_pdf_unverified": 0,
        "task_total": 0,
        "task_completed": 0,
        "overdue_tasks": 0,
        "pending_investments": 0,
        "pending_sales": 0,
    }
    row.update(overrides)
    return row


class ReportScoringTests(unittest.TestCase):
    def test_empty_person_is_unassigned_instead_of_green_100(self):
        person = score_people([base_row()], [])[0]
        self.assertIsNone(person["score"])
        self.assertEqual("unassigned", person["status"])
        self.assertIn("No assigned workload or measurable activity", person["reasons"])

    def test_only_applicable_weights_are_normalised(self):
        person = score_people([base_row(
            doctor_count=10,
            doctor_sales=80000,
            doctor_target=100000,
            doctor_target_available=True,
            visit_coverage_pct=80,
        )], [])[0]
        self.assertEqual(80, person["score"])
        self.assertEqual(40, person["applicable_weight"])

    def test_missing_required_target_scores_zero_and_has_reason(self):
        person = score_people([base_row(doctor_count=3, visit_coverage_pct=100)], [])[0]
        self.assertEqual(38, person["score"])
        self.assertEqual("red", person["status"])
        self.assertIn("Doctor target not set", person["reasons"])

    def test_recovery_reason_carries_rupee_gap(self):
        recovery = [{
            "manager_id": 7,
            "expected_sales": 500000,
            "sales_captured": 100000,
            "worst_status": "At Risk",
        }]
        person = score_people([base_row()], recovery)[0]
        detail = next(item for item in person["reason_details"] if item["metric"] == "investment_recovery")
        self.assertEqual(400000, detail["gap_value"])
        self.assertEqual("currency", detail["gap_unit"])
        self.assertEqual(100000, detail["current_value"])
        self.assertEqual(500000, detail["target_value"])

    def test_incomplete_tasks_are_not_silent(self):
        person = score_people([base_row(task_total=4, task_completed=3)], [])[0]
        detail = next(item for item in person["reason_details"] if item["metric"] == "task_completion")
        self.assertEqual(1, detail["gap_value"])
        self.assertEqual("count", detail["gap_unit"])
        self.assertEqual(3, detail["current_value"])
        self.assertEqual(4, detail["target_value"])


if __name__ == "__main__":
    unittest.main()
