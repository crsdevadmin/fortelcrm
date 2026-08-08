"""Extract invoice totals without using the expected CRM value to choose a number."""

import re


TOTAL_LABELS = (
    ("grand_total", re.compile(r"\bgrand\s+total\b", re.IGNORECASE)),
    ("invoice_total", re.compile(r"\binvoice\s+total\b", re.IGNORECASE)),
    ("net_amount", re.compile(r"\bnet\s+amount\b", re.IGNORECASE)),
    ("amount_payable", re.compile(r"\b(?:amount\s+payable|payable\s+amount)\b", re.IGNORECASE)),
    ("total_value", re.compile(r"\btotal\s+value\b", re.IGNORECASE)),
    ("total_amount", re.compile(r"\btotal\s+amount\b", re.IGNORECASE)),
)
AMOUNT_RE = re.compile(r"(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE)


def extract_labeled_total(text):
    candidates = []
    for line_number, raw_line in enumerate((text or "").splitlines(), 1):
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line:
            continue
        for priority, (label, pattern) in enumerate(TOTAL_LABELS):
            match = pattern.search(line)
            if not match:
                continue
            values = []
            for token in AMOUNT_RE.findall(line[match.end():]):
                try:
                    values.append(round(float(token.replace(",", "")), 2))
                except ValueError:
                    continue
            if values:
                candidates.append({
                    "priority": priority,
                    "label": label,
                    "value": values[-1],
                    "line_number": line_number,
                })
            break

    if not candidates:
        return {"status": "unverified", "total": None, "label": None, "reason": "No labelled total found"}
    best_priority = min(item["priority"] for item in candidates)
    best = [item for item in candidates if item["priority"] == best_priority]
    distinct_values = {item["value"] for item in best}
    if len(distinct_values) != 1:
        return {
            "status": "unverified",
            "total": None,
            "label": best[0]["label"],
            "reason": "Conflicting labelled totals found",
        }
    chosen = best[-1]
    return {
        "status": "extracted",
        "total": chosen["value"],
        "label": chosen["label"],
        "line_number": chosen["line_number"],
    }


def validate_labeled_total(text, entered_total):
    extraction = extract_labeled_total(text)
    if extraction["status"] != "extracted":
        return {**extraction, "difference": None, "matches": False}
    entered = float(entered_total or 0)
    difference = round(float(extraction["total"]) - entered, 2)
    tolerance = max(1.0, round(abs(entered) * 0.001, 2))
    matches = abs(difference) <= tolerance
    return {
        **extraction,
        "status": "matched" if matches else "mismatch",
        "difference": difference,
        "matches": matches,
        "tolerance": tolerance,
    }
