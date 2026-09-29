import io
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl


def _text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _key(value):
    return re.sub(r"[^a-z0-9]", "", _text(value).lower())


def _number(value):
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    try:
        return float(cleaned) if cleaned not in {"", "-", "."} else 0.0
    except ValueError:
        return 0.0


def _date(value, datemode=0):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        try:
            import xlrd
            return xlrd.xldate_as_datetime(value, datemode).date().isoformat()
        except (ImportError, ValueError, TypeError, OverflowError):
            try:
                return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
            except (ValueError, TypeError, OverflowError):
                return None
    text = _text(value)
    for fmt in ("%d/%m/%y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _rows(content, filename):
    suffix = Path(filename).suffix.lower()
    if suffix == ".xlsx":
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = workbook.active
        return [list(row) for row in sheet.iter_rows(values_only=True)], 0
    if suffix == ".xls":
        import xlrd
        workbook = xlrd.open_workbook(file_contents=content)
        sheet = workbook.sheet_by_index(0)
        return [sheet.row_values(index) for index in range(sheet.nrows)], workbook.datemode
    raise ValueError("Only Excel .xls and .xlsx files are supported")


def _period(rows, datemode):
    pattern = re.compile(r"from\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+to\s+(\d{1,2}/\d{1,2}/\d{2,4})", re.I)
    for row in rows[:10]:
        for cell in row:
            match = pattern.search(_text(cell))
            if match:
                return _date(match.group(1), datemode), _date(match.group(2), datemode)
    return None, None


def _header(rows, required):
    for index, row in enumerate(rows[:30]):
        mapping = {_key(value): position for position, value in enumerate(row) if _key(value)}
        if required.issubset(mapping):
            return index, mapping
    raise ValueError("The selected file does not contain the expected report columns")


def _cell(row, mapping, name):
    index = mapping.get(name)
    return row[index] if index is not None and index < len(row) else None


def parse_collection_report(content, filename, report_type):
    rows, datemode = _rows(content, filename)
    period_start, period_end = _period(rows, datemode)

    if report_type == "receipt":
        header_index, columns = _header(rows, {"date", "receiptno", "customername", "amount"})
        entries = []
        for row in rows[header_index + 1:]:
            receipt_date = _date(_cell(row, columns, "date"), datemode)
            receipt_no = _text(_cell(row, columns, "receiptno"))
            customer_name = _text(_cell(row, columns, "customername"))
            if not receipt_date or not receipt_no or not customer_name:
                continue
            entries.append({
                "receipt_date": receipt_date,
                "receipt_no": receipt_no,
                "mode": _text(_cell(row, columns, "mode")) or None,
                "bank_abbreviation": _text(_cell(row, columns, "bankabbrevation")) or None,
                "cheque_no": _text(_cell(row, columns, "chequeno")) or None,
                "cheque_date": _date(_cell(row, columns, "chequedate"), datemode),
                "temp_receipt_no": _text(_cell(row, columns, "temprecno")) or None,
                "customer_name": customer_name,
                "customer_code": _text(_cell(row, columns, "customercode")) or None,
                "source_user": _text(_cell(row, columns, "user")) or None,
                "excess": _number(_cell(row, columns, "excess")),
                "discount_percentage": _number(_cell(row, columns, "discountpercentage")),
                "salesman_name": _text(_cell(row, columns, "salesmanname")) or None,
                "discount": _number(_cell(row, columns, "discount")),
                "amount": _number(_cell(row, columns, "amount")),
            })
    elif report_type == "outstanding":
        header_index, columns = _header(rows, {"customercode", "customername", "balance"})
        entries = []
        for row in rows[header_index + 1:]:
            customer_code = _text(_cell(row, columns, "customercode"))
            customer_name = _text(_cell(row, columns, "customername"))
            if not customer_name or customer_name.lower() in {"grand total", "total"}:
                continue
            balance = _number(_cell(row, columns, "balance"))
            if not customer_code and not balance:
                continue
            entries.append({
                "customer_code": customer_code or None,
                "customer_name": customer_name,
                "address1": _text(_cell(row, columns, "address1")) or None,
                "area_name": _text(_cell(row, columns, "areaname")) or None,
                "address2": _text(_cell(row, columns, "address2")) or None,
                "city_name": _text(_cell(row, columns, "cityname")) or None,
                "pincode": _text(_cell(row, columns, "pincode")) or None,
                "balance": balance,
            })
    else:
        raise ValueError("Invalid report type")

    if not entries:
        raise ValueError(f"No valid {report_type} rows were found in this file")
    return {
        "period_start": period_start,
        "period_end": period_end,
        "entries": entries,
        "total_amount": round(sum(entry["amount" if report_type == "receipt" else "balance"] for entry in entries), 2),
    }
