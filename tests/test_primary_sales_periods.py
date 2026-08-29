import unittest

from backend.services.primary_sales_import import primary_sales_week_bounds


class PrimarySalesPeriodTests(unittest.TestCase):
    def test_first_three_weeks_use_seven_day_ranges(self):
        self.assertEqual(("2026-08-01", "2026-08-07"), primary_sales_week_bounds(2026, 8, 1))
        self.assertEqual(("2026-08-08", "2026-08-14"), primary_sales_week_bounds(2026, 8, 2))
        self.assertEqual(("2026-08-15", "2026-08-21"), primary_sales_week_bounds(2026, 8, 3))

    def test_week_four_includes_rest_of_month(self):
        self.assertEqual(("2026-08-22", "2026-08-31"), primary_sales_week_bounds(2026, 8, 4))
        self.assertEqual(("2028-02-22", "2028-02-29"), primary_sales_week_bounds(2028, 2, 4))

    def test_invalid_week_is_rejected(self):
        with self.assertRaises(ValueError):
            primary_sales_week_bounds(2026, 8, 5)


if __name__ == "__main__":
    unittest.main()
