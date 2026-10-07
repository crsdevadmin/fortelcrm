import io

import pytest
from openpyxl import Workbook

from backend.services.collections_import import detect_report_type


def workbook(header):
    wb = Workbook()
    ws = wb.active
    ws.append(["NEXUS BIOCARE"])
    ws.append(["Report From 01/10/26 To 07/10/26"])
    ws.append([])
    ws.append(header)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_detects_receipt_report():
    raw = workbook(["Date", "Receipt No", "Mode", "Customer Name", "Customer Code", "Amount"])
    assert detect_report_type(raw, "receipt report.xlsx") == "receipt"


def test_detects_outstanding_report():
    raw = workbook(["Customer Code", "Customer Name", "Address1", "City Name", "Pincode", "Balance"])
    assert detect_report_type(raw, "outstanding.xlsx") == "outstanding"


def test_detects_nexus_monthly_sales():
    raw = workbook(["Customer Name", "Bill Number", "Bill Date", "Product Name", "Quantity",
                    "Gross Amount With Discount", "City Name"])
    assert detect_report_type(raw, "AUG 2026.xlsx") == "sales"


def test_rejects_unknown_file():
    with pytest.raises(ValueError):
        detect_report_type(workbook(["Name", "Value"]), "other.xlsx")
