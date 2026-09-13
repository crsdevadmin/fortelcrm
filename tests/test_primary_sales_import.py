import unittest

from backend.services.primary_sales_import import parse_primary_sales_rows, primary_sales_reconciliation


class PrimarySalesImportTests(unittest.TestCase):
    def test_uses_gross_amount_with_discount_and_skips_grand_total(self):
        rows = [
            ["FORTEL LIFE SCIENCES"],
            ["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity", "Rate", "Gross Amount With Discount", "Net Amount", "GSTNumber"],
            ["NEXUS BIOCARE", "D001", "01/08/2026", "REFILAC CAP", 10, 190, 1900, 1995, "33AAUFN5051C1ZD"],
            ["", "Grand Total", "", "", 10, "", 1900, 1995, ""],
        ]
        result = parse_primary_sales_rows(rows)
        self.assertEqual(1, len(result["rows"]))
        self.assertEqual(1, result["skipped_count"])
        self.assertEqual(1900, result["rows"][0]["gross_amount"])
        self.assertEqual(1995, result["rows"][0]["net_amount"])
        self.assertEqual("2026-08-01", result["rows"][0]["bill_date"])
        self.assertEqual("NEXUS BIOCARE", result["rows"][0]["normalized_stockist_name"])

    def test_same_invoice_line_gets_stable_source_key(self):
        rows = [
            ["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity", "Rate", "Gross Amount With Discount", "Net Amount"],
            ["NEXUS BIOCARE", "D001", "2026-08-01", "REFILAC CAP", 10, 190, 1900, 1995],
        ]
        first = parse_primary_sales_rows(rows)["rows"][0]
        second = parse_primary_sales_rows(rows)["rows"][0]
        self.assertEqual(first["source_key"], second["source_key"])

    def test_gross_amount_with_discount_column_is_required(self):
        rows = [["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity", "Bill Amount"]]
        with self.assertRaisesRegex(ValueError, "Gross Amount"):
            parse_primary_sales_rows(rows)

    def test_city_split_preserves_uploaded_gross_returns_and_city(self):
        rows = [
            ["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity", "Gross Amount With Discount", "Net Amount", "CityName", "Abberiviation"],
            ["CBE HEXACARE", "R001", "01/08/2026", "REFILAC CAP", -2, -380, -399, "COIMBATORE", "Return"],
        ]
        result = parse_primary_sales_rows(rows, require_city_column=True)
        self.assertEqual(-380, result["rows"][0]["gross_amount"])
        self.assertEqual("COIMBATORE", result["rows"][0]["city"])
        self.assertEqual("Return", result["rows"][0]["sale_type"])

    def test_city_split_requires_city_name_column(self):
        rows = [["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity", "Gross Amount With Discount"]]
        with self.assertRaisesRegex(ValueError, "City Name"):
            parse_primary_sales_rows(rows, require_city_column=True)

    def test_reconciliation_replaces_nexus_value_without_double_counting(self):
        result = primary_sales_reconciliation(3892236.92, 3018559.88, 3622716.19, True)
        self.assertEqual(604156.31, result["nexus_value_difference"])
        self.assertEqual(4496393.23, result["adjusted_primary_sales"])
        self.assertEqual(873677.04, result["fortel_excluding_nexus"])
        self.assertTrue(result["is_complete"])


if __name__ == "__main__":
    unittest.main()
