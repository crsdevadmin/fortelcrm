"""Extract product quantities and rates from text-based regional sales PDFs."""

import re


NUMBER_RE = re.compile(r"(?<![A-Za-z])(?:Rs\.?\s*|INR\s*|₹\s*)?(-?\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)


def _normalise(value):
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _compact(value):
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _numbers(value):
    result = []
    for match in NUMBER_RE.finditer(value or ""):
        try:
            result.append(float(match.group(1).replace(",", "")))
        except ValueError:
            pass
    return result


def _rate_index(values, expected_rate):
    if expected_rate > 0:
        tolerance = max(0.5, expected_rate * 0.03)
        candidates = [
            (abs(value - expected_rate), index)
            for index, value in enumerate(values)
            if abs(value - expected_rate) <= tolerance
        ]
        if candidates:
            return min(candidates)[1]
    # In simple product/quantity/rate/amount reports, rate is the second number.
    return 1 if len(values) >= 2 else None


def extract_regional_sales_rows(text, products):
    """Return unambiguous product rows found in extracted PDF text.

    Product master rates are used as anchors because invoice rows often contain
    unrelated numeric fields (HSN, batch, pack and MRP) before quantity/rate.
    """
    if "stock group summary" in (text or "").lower():
        return _extract_tally_stock_group_summary(text, products)

    product_specs = []
    for product in products:
        name = _normalise(getattr(product, "name", ""))
        if len(name) < 3:
            continue
        rate = float(getattr(product, "price", None) or getattr(product, "rate", None) or 0)
        product_specs.append((product, name, rate))
    product_specs.sort(key=lambda item: len(item[1]), reverse=True)

    totals = {}
    unmatched = 0
    lines = [re.sub(r"\s+", " ", line).strip() for line in (text or "").splitlines()]
    # Joining adjacent lines also handles PDFs that wrap a product name before its figures.
    candidates = [(line, (index,)) for index, line in enumerate(lines)]
    candidates += [(f"{lines[i]} {lines[i + 1]}", (i, i + 1)) for i in range(len(lines) - 1)]
    consumed = set()
    for candidate, source_lines in candidates:
        normalised = _normalise(candidate)
        matches = [(product, name, rate) for product, name, rate in product_specs if name in normalised]
        if not matches:
            continue
        longest = len(matches[0][1])
        matches = [item for item in matches if len(item[1]) == longest]
        if len(matches) != 1:
            unmatched += 1
            continue
        product, normalised_name, expected_rate = matches[0]
        if any((product.id, line_number) in consumed for line_number in source_lines):
            continue

        # Take figures following the product name; figures in the product name itself
        # (for example 500 MG) must never be interpreted as quantity.
        name_pattern = r"[^A-Za-z0-9]+".join(re.escape(token) for token in normalised_name.split())
        match = re.search(name_pattern, candidate, re.IGNORECASE)
        suffix = candidate[match.end():] if match else candidate
        values = [value for value in _numbers(suffix) if value >= 0]
        rate_index = _rate_index(values, expected_rate)
        if rate_index is None or rate_index < 1:
            unmatched += 1
            continue
        rate = values[rate_index]
        # Quantity is normally immediately before rate. Prefer an integer-like value.
        before_rate = values[:rate_index]
        integer_values = [value for value in before_rate if value.is_integer()]
        quantity = integer_values[-1] if integer_values else before_rate[-1]
        if quantity <= 0 or rate <= 0:
            continue
        consumed.update((product.id, line_number) for line_number in source_lines)
        current = totals.setdefault(product.id, {
            "product_id": product.id,
            "product_name": product.name,
            "quantity": 0.0,
            "price": rate,
        })
        current["quantity"] += quantity
        current["price"] = rate

    rows = list(totals.values())
    for row in rows:
        row["quantity"] = round(row["quantity"], 3)
        row["price"] = round(row["price"], 2)
        row["value"] = round(row["quantity"] * row["price"], 2)
    return {
        "entries": rows,
        "unmatched_rows": unmatched,
        "unmatched_items": [],
        "matched_total": round(sum(row["value"] for row in rows), 2),
    }


def _tally_product(products, report_name, report_rate):
    """Match a Tally stock name to the closest Product Master row."""
    report_tokens = _normalise(report_name).split()
    report_compact = _compact(report_name)
    if not report_tokens:
        return None
    brand = report_tokens[0]
    candidates = []
    for product in products:
        name = getattr(product, "name", "") or ""
        tokens = _normalise(name).split()
        if not tokens or tokens[0] != brand:
            continue
        compact = _compact(name)
        shared = len(set(report_tokens) & set(tokens))
        containment = compact in report_compact or report_compact in compact
        expected_rate = float(getattr(product, "price", None) or getattr(product, "rate", None) or 0)
        rate_gap = abs(expected_rate - report_rate) if expected_rate else 10 ** 9
        candidates.append((0 if containment else 1, -shared, rate_gap, -len(compact), product))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[:-1])[-1]


def _extract_tally_stock_group_summary(text, products):
    """Extract the Outwards column from a Tally Stock Group Summary.

    Tally reports opening/inwards/outwards/closing figures on the same row.
    Regional secondary sales are the Outwards quantity, rate and value.
    """
    lines = (text or "").splitlines()
    quantity_columns = None
    for line in lines:
        starts = [match.start() for match in re.finditer(r"\bQuantity\b", line, re.IGNORECASE)]
        if len(starts) >= 4:
            quantity_columns = starts[:4]
            break
    if not quantity_columns:
        return {"entries": [], "unmatched_rows": 0, "unmatched_items": [], "pdf_total": None, "matched_total": 0.0}

    boundaries = [
        (quantity_columns[index] + quantity_columns[index + 1]) / 2
        for index in range(3)
    ]
    row_re = re.compile(
        r"(?P<qty>\d+(?:\.\d+)?)\s+nos\s+"
        r"(?P<rate>[\d,]+(?:\.\d+)?)\s+"
        r"(?P<value>[\d,]+(?:\.\d+)?)",
        re.IGNORECASE,
    )
    total_re = re.compile(r"(?P<qty>\d+(?:\.\d+)?)\s+nos\s+(?P<value>[\d,]+(?:\.\d+)?)", re.IGNORECASE)
    entries = {}
    unmatched = 0
    unmatched_items = []
    pdf_total = None
    for line in lines:
        is_total = bool(re.match(r"\s*Grand\s+Total\b", line, re.IGNORECASE))
        matches = list((total_re if is_total else row_re).finditer(line))
        outward = next((match for match in matches if boundaries[1] <= match.start() < boundaries[2]), None)
        if not outward:
            continue
        if is_total:
            pdf_total = float(outward.group("value").replace(",", ""))
            continue
        report_name = line[:quantity_columns[0]].strip()
        quantity = float(outward.group("qty"))
        rate = float(outward.group("rate").replace(",", ""))
        product = _tally_product(products, report_name, rate)
        if not product:
            unmatched += 1
            unmatched_items.append({
                "source_name": report_name,
                "quantity": round(quantity, 3),
                "price": round(rate, 2),
                "value": round(quantity * rate, 2),
            })
            continue
        current = entries.setdefault(product.id, {
            "product_id": product.id,
            "product_name": product.name,
            "source_name": report_name,
            "quantity": 0.0,
            "price": rate,
        })
        current["quantity"] += quantity
        current["price"] = rate

    result = list(entries.values())
    for row in result:
        row["quantity"] = round(row["quantity"], 3)
        row["price"] = round(row["price"], 2)
        row["value"] = round(row["quantity"] * row["price"], 2)
    return {
        "entries": result,
        "unmatched_rows": unmatched,
        "unmatched_items": unmatched_items,
        "pdf_total": pdf_total,
        "matched_total": round(sum(row["value"] for row in result), 2),
    }
