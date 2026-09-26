"""Conservative bill screening for expense uploads.

Automatic checks never reject a claim. Unreadable files, non-bill documents, and
amount mismatches are routed to the employee's reporting manager for review.
"""

import io
import re


BILL_WORDS = re.compile(
    r"\b(invoice|receipt|cash\s*memo|tax\s*invoice|bill|grand\s*total|amount\s*payable|gst|total)\b",
    re.IGNORECASE,
)
AMOUNT_RE = re.compile(r"(?<![A-Za-z0-9])(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE)


def _extract_text(raw: bytes, content_type: str) -> str:
    if content_type == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        if not reader.pages:
            raise ValueError("The PDF has no pages")
        return "\n".join((page.extract_text() or "") for page in reader.pages[:10])

    from PIL import Image
    import pytesseract

    image = Image.open(io.BytesIO(raw))
    image.verify()
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    if image.width * image.height > 25_000_000:
        raise ValueError("Image dimensions are too large")
    if image.width < 1600:
        scale = min(3, max(2, round(1600 / image.width)))
        image = image.resize((image.width * scale, image.height * scale))
    return pytesseract.image_to_string(image, config="--psm 6")


def _amounts(text: str) -> list[float]:
    values = []
    for token in AMOUNT_RE.findall(text or ""):
        try:
            value = round(float(token.replace(",", "")), 2)
        except ValueError:
            continue
        if value > 0:
            values.append(value)
    return sorted(set(values))


def validate_expense_bill(raw: bytes, content_type: str, claimed_amount: float) -> dict:
    try:
        text = _extract_text(raw, content_type)
    except Exception:
        return {
            "status": "review_required",
            "reason": "The uploaded file could not be read as a bill. Your reporting manager must validate it.",
            "detected_amount": None,
        }

    compact_text = " ".join((text or "").split())
    if len(compact_text) < 15:
        return {
            "status": "review_required",
            "reason": "No readable bill details were found. Your reporting manager must validate the upload.",
            "detected_amount": None,
        }

    values = _amounts(compact_text)
    claimed = round(float(claimed_amount or 0), 2)
    tolerance = max(1.0, round(abs(claimed) * 0.001, 2))
    amount_match = next((value for value in values if abs(value - claimed) <= tolerance), None)
    if amount_match is None:
        return {
            "status": "review_required",
            "reason": f"The uploaded bill does not show the reported expense amount of ₹{claimed:,.2f}. Your reporting manager must validate it.",
            "detected_amount": max(values) if values else None,
        }
    if not BILL_WORDS.search(compact_text):
        return {
            "status": "review_required",
            "reason": "The uploaded document contains the amount but could not be confirmed as a bill. Your reporting manager must validate it.",
            "detected_amount": amount_match,
        }
    return {
        "status": "auto_validated",
        "reason": "Bill details and the reported amount were found.",
        "detected_amount": amount_match,
    }
