import unittest

from backend.services.pdf_totals import extract_labeled_total, validate_labeled_total


class PdfTotalTests(unittest.TestCase):
    def test_extracts_grand_total_instead_of_nearest_unlabelled_number(self):
        text = "Item 500000\nSub total 490000\nGrand Total ₹5,25,000.00\nPhone 525001"
        result = validate_labeled_total(text, 500000)
        self.assertEqual("mismatch", result["status"])
        self.assertEqual(525000, result["total"])
        self.assertFalse(result["matches"])

    def test_returns_unverified_when_no_label_exists(self):
        result = validate_labeled_total("500000 499999 500001", 500000)
        self.assertEqual("unverified", result["status"])
        self.assertIsNone(result["total"])

    def test_matching_label_passes_with_tolerance(self):
        result = validate_labeled_total("Net Amount: INR 500,250.00", 500000)
        self.assertEqual("matched", result["status"])
        self.assertTrue(result["matches"])

    def test_conflicting_best_labels_are_unverified(self):
        result = extract_labeled_total("Grand Total 1000\nGrand Total 2000")
        self.assertEqual("unverified", result["status"])


if __name__ == "__main__":
    unittest.main()
