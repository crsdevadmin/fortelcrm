from backend.services import expense_bill_validation as validation


def test_bill_amount_and_bill_words_are_auto_validated(monkeypatch):
    monkeypatch.setattr(
        validation,
        "_extract_text",
        lambda raw, content_type: "Tax Invoice Grand Total Rs. 1,250.00",
    )

    result = validation.validate_expense_bill(b"bill", "application/pdf", 1250)

    assert result["status"] == "auto_validated"
    assert result["detected_amount"] == 1250


def test_missing_reported_amount_requires_manager_review(monkeypatch):
    monkeypatch.setattr(
        validation,
        "_extract_text",
        lambda raw, content_type: "Receipt Total Rs. 900.00",
    )

    result = validation.validate_expense_bill(b"bill", "image/jpeg", 1250)

    assert result["status"] == "review_required"
    assert "does not show the reported expense amount" in result["reason"]


def test_non_bill_document_requires_manager_review(monkeypatch):
    monkeypatch.setattr(
        validation,
        "_extract_text",
        lambda raw, content_type: "Personal document value 1250.00",
    )

    result = validation.validate_expense_bill(b"document", "image/png", 1250)

    assert result["status"] == "review_required"
    assert "could not be confirmed as a bill" in result["reason"]
