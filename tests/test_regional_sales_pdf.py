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
        "value": 825.0,
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


def test_tally_stock_group_summary_uses_outwards_not_opening_or_closing():
    products = [product(9, "NEUGARD CAPSULES 10's", 299.66)]
    text = """Stock Group Summary
Particulars                               Opening Balance                      Inwards                      Outwards                  Closing Balance
                                       Quantity   Rate      Value    Quantity    Rate      Value    Quantity   Rate      Value     Quantity   Rate     Value
EMWET SPRAY                              6 nos   560.00   3,360.00                                                                  6 nos   560.00   3,360.00
NEUGARD TAB                            20 nos    374.29   7,485.80    20 nos    374.29  7,485.80    20 nos    335.00   6,700.00    20 nos   374.29   7,485.80
Grand Total                            41 nos             27,129.56  20 nos             7,485.80    20 nos             6,700.00    41 nos            27,129.56
"""
    result = extract_regional_sales_rows(text, products)
    assert result["entries"] == [{
        "product_id": 9,
        "product_name": "NEUGARD CAPSULES 10's",
        "source_name": "NEUGARD TAB",
        "quantity": 20.0,
        "price": 335.0,
        "value": 6700.0,
    }]
    assert result["pdf_total"] == 6700


def test_tally_summary_without_rate_column_derives_outward_rate():
    products = [product(9, "NEUGARD CAPSULES 10's", 299.66)]
    text = """Stock Group Summary
  Particulars                                  Inwards                           Outwards                       Closing Balance
                                      Quantity           Value           Quantity           Value          Quantity           Value
NEUGARD                                   21 nos          7,350.00           20 nos          7,485.80           28 nos         9,800.00
  Grand Total                             41 nos         35,590.78           70 nos        41,260.90          287 nos        76,735.07
"""
    result = extract_regional_sales_rows(text, products)
    assert result["entries"][0]["quantity"] == 20
    assert result["entries"][0]["price"] == 374.29
    assert result["pdf_total"] == 41260.90
    # EMWET SPRAY has no Outwards figures, so it is not reported as an unmatched sale.
    assert result["unmatched_items"] == []
