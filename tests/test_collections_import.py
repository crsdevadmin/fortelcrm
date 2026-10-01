import io
import unittest

from openpyxl import Workbook

from backend.services.collections_import import parse_collection_report


class CollectionImportTests(unittest.TestCase):
    def nexus_sales_workbook(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["NEXUS BIOCARE"])
        sheet.append(["Customerwise Purchase Report-Productwise From 01/08/26 To 31/08/26"])
        sheet.append([
            "Customer Name", "Bill Number", "Bill Date", "Product Name",
            "Quantity", "Gross Amount With Discount", "CityName",
        ])
        sheet.append(["A&A ENTERPRISES", "D01005614", "29/08/26", "NUNEXA", 2, 3036, "TRICHY"])
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    def test_nexus_sales_file_gets_specific_collection_upload_instruction(self):
        content = self.nexus_sales_workbook()
        for report_type in ("receipt", "outstanding"):
            with self.subTest(report_type=report_type):
                with self.assertRaisesRegex(ValueError, "Upload Nexus Monthly Sales"):
                    parse_collection_report(content, "AUG- 2026.xlsx", report_type)


if __name__ == "__main__":
    unittest.main()
