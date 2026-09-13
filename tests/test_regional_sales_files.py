from types import SimpleNamespace

from backend.services.regional_sales_files import _map_rows


def product(product_id, name, rate):
    return SimpleNamespace(id=product_id, name=name, price=rate, rate=rate)


def test_maps_excel_sales_and_derives_rate_from_sales_value():
    rows = [
        ["ITEMCODE", "ITEMNAME", "PACKING", "CLSTOCK", "STK VAL", "SALES", "SALES VAL"],
        [1390001, "EMWET SPRAY", "PFS", 2, 1120, 1, 627],
    ]
    result = _map_rows(rows, [product(4, "EMWET SPRAY 100ML", 617.14)])
    assert result["entries"] == [{
        "product_id": 4,
        "product_name": "EMWET SPRAY 100ML",
        "quantity": 1.0,
        "price": 627.0,
    }]
    assert result["source_total"] == 627


def test_maps_screenshot_style_headers():
    rows = [
        ["Item name", "Pack", "OpQty", "Op Val", "PQty", "Pur Value", "SQty", "Sal Value", "Pur.Rate"],
        ["ONCODOL 100MG TAB", 1, 73, 14798, 100, 20200, 6, 12120, 202],
    ]
    result = _map_rows(rows, [product(2, "ONCODOL 100TAB", 226.29)])
    assert result["entries"][0]["quantity"] == 6
    assert result["entries"][0]["price"] == 202
