from types import SimpleNamespace

from backend.services.regional_sales_files import _map_rows


def product(product_id, name, rate):
    return SimpleNamespace(id=product_id, name=name, price=rate, rate=rate)


def test_maps_excel_closing_stock_and_derives_rate_from_stock_value():
    rows = [
        ["ITEMCODE", "ITEMNAME", "PACKING", "CLSTOCK", "STK VAL", "SALES", "SALES VAL"],
        [1390001, "EMWET SPRAY", "PFS", 2, 1120, 1, 627],
    ]
    result = _map_rows(rows, [product(4, "EMWET SPRAY 100ML", 617.14)])
    assert result["entries"] == [{
        "product_id": 4,
        "product_name": "EMWET SPRAY 100ML",
        "source_name": "EMWET SPRAY",
        "quantity": 2.0,
        "price": 560.0,
        "value": 1120.0,
    }]
    assert result["source_total"] == 1120
    assert result["matched_total"] == 1120
    assert result["unmatched_items"] == []


def test_returns_unmatched_products_with_quantity_and_price():
    rows = [
        ["ITEMNAME", "SALES", "SALES VAL"],
        ["EMWET SPRAY", 1, 627],
        ["BRAND NOT IN MASTER", 5, 500],
    ]
    result = _map_rows(rows, [product(4, "EMWET SPRAY 100ML", 617.14)])
    assert result["unmatched_rows"] == 1
    assert result["unmatched_items"] == [{
        "source_name": "BRAND NOT IN MASTER",
        "quantity": 5.0,
        "price": 100.0,
        "value": 500.0,
    }]
    # Report total covers every line; matched total covers only mapped products.
    assert result["source_total"] == 1127
    assert result["matched_total"] == 627


def test_maps_screenshot_style_headers():
    rows = [
        ["Item name", "Pack", "OpQty", "Op Val", "PQty", "Pur Value", "SQty", "Sal Value", "ClsQty", "Cls Value", "Pur.Rate"],
        ["ONCODOL 100MG TAB", 1, 73, 14798, 100, 20200, 6, 12120, 167, 33786, 202],
    ]
    result = _map_rows(rows, [product(2, "ONCODOL 100TAB", 226.29)])
    assert result["entries"][0]["quantity"] == 167
    assert result["entries"][0]["price"] == 202.31


def test_repairs_small_ocr_value_error_from_printed_rate():
    rows = [
        ["ITEMNAME", "CLSTOCK", "STK VAL", "RATE"],
        ["NUTAMINE SACHET", 30, 2830, 96],
    ]
    result = _map_rows(rows, [product(34, "NUTAMINE SACHET", 118.63)])
    assert result["entries"][0]["quantity"] == 30
    assert result["entries"][0]["price"] == 96
    assert result["entries"][0]["value"] == 2880
