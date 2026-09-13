from types import SimpleNamespace

from backend.services.regional_sales_pdf import extract_regional_sales_rows


def product(product_id, name, rate):
    return SimpleNamespace(id=product_id, name=name, price=rate, rate=rate)


def test_extracts_quantity_and_rate_using_master_rate_anchor():
    products = [product(1, "Fortel 500 MG Tablet", 82.50)]
    text = "1 Fortel 500 MG Tablet 300490 10 82.50 825.00"
    result = extract_regional_sales_rows(text, products)
    assert result["entries"] == [{
        "product_id": 1,
        "product_name": "Fortel 500 MG Tablet",
        "quantity": 10.0,
        "price": 82.5,
    }]


def test_accumulates_repeated_product_rows():
    products = [product(7, "Sample Syrup", 45)]
    text = "Sample Syrup 2 45.00 90.00\nSample Syrup 3 45.00 135.00"
    result = extract_regional_sales_rows(text, products)
    assert result["entries"][0]["quantity"] == 5
    assert result["entries"][0]["price"] == 45


def test_does_not_treat_strength_in_product_name_as_quantity():
    products = [product(3, "Medicine 250 MG", 120)]
    result = extract_regional_sales_rows("Medicine 250 MG 4 120.00 480.00", products)
    assert result["entries"][0]["quantity"] == 4


def test_reads_a_product_row_wrapped_across_two_lines():
    products = [product(4, "Sample Syrup", 45)]
    result = extract_regional_sales_rows("Sample Syrup\n2 45.00 90.00", products)
    assert result["entries"][0]["quantity"] == 2
    assert result["entries"][0]["price"] == 45
