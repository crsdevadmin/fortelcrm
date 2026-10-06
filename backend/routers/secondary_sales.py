# backend/routers/secondary_sales.py
"""Secondary sales from the weekly stockist sheet (October 2026 onward).

Each rep uploads the month's workbook for one territory. Every upload replaces
that rep's month for the territory: the stockist x product x week lines are
stored for the secondary-sales screen, and product x week totals are written
into RegionalSalesEntry so the dashboards, targets and reports keep working.
"""

import base64
import binascii
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import (
    Product, RegionalSalesEntry, SecondarySalesLine, SecondarySalesUpload,
)
from ..services.secondary_sales_sheet import SheetFormatError, parse_secondary_sheet
from ..utils.hierarchy import get_subtree_ids
from ..utils.regional_territories import visible_territories
from .sales import _enforce_regional_territory_access

router = APIRouter(prefix="/secondary-sales", tags=["Secondary sales"])

SHEET_START = (2026, 10)
UPLOAD_SESSION_ROOT = Path("/tmp/fortel-secondary-upload-sessions")
UPLOAD_CHUNK_BYTES = 4 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ROLLUP_REMARK = "Secondary sheet: "


def _stockist_key(name):
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


class UploadStartRequest(BaseModel):
    filename: str
    file_size: int
    file_checksum: str
    associate_id: int
    state_code: str
    city: str
    year: int
    month: int


class UploadChunkRequest(BaseModel):
    index: int
    data: str


class UploadCompleteRequest(BaseModel):
    file_checksum: str


def _check_scope(current_user, associate_id, state_code, city, year, month, db):
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="User is outside your reporting hierarchy")
    if not state_code.strip() or not city.strip():
        raise HTTPException(status_code=400, detail="Select a state and city before uploading")
    _enforce_regional_territory_access(associate_id, city.strip(), db, state_code.strip())
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    if (year, month) < SHEET_START:
        raise HTTPException(status_code=400, detail="The stockist sheet upload starts from October 2026")


def _session(session_id, current_user):
    if not re.fullmatch(r"[0-9a-f]{32}", session_id or ""):
        raise HTTPException(status_code=404, detail="Upload session not found")
    path = UPLOAD_SESSION_ROOT / session_id
    try:
        metadata = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Upload session not found")
    if int(metadata.get("user_id") or 0) != current_user.id:
        raise HTTPException(status_code=403, detail="This upload session belongs to another user")
    return path, metadata


def _remove_session(path):
    if path.parent != UPLOAD_SESSION_ROOT or not path.exists():
        return
    for item in path.iterdir():
        if item.is_file():
            item.unlink()
    path.rmdir()


def _upload_metadata(upload):
    try:
        warnings = json.loads(upload.warnings or "[]")
    except ValueError:
        warnings = []
    return {
        "id": upload.id,
        "associate_id": upload.associate_id,
        "associate_name": upload.associate.name if upload.associate else "",
        "state_code": upload.state_code,
        "city": upload.city,
        "year": upload.year,
        "month": upload.month,
        "filename": upload.filename,
        "sheet_name": upload.sheet_name,
        "stockist_count": upload.stockist_count,
        "total_sales_qty": round(float(upload.total_sales_qty or 0), 3),
        "total_sales_value": round(float(upload.total_sales_value or 0), 2),
        "total_closing_qty": round(float(upload.total_closing_qty or 0), 3),
        "total_closing_value": round(float(upload.total_closing_value or 0), 2),
        "warnings": warnings,
        "uploaded_at": upload.uploaded_at.isoformat() if upload.uploaded_at else None,
    }


def _clear_month(db, associate_id, state_code, city, year, month):
    """Remove the previous sheet and every regional row for this rep / territory / month."""
    old_uploads = db.query(SecondarySalesUpload).filter(
        SecondarySalesUpload.associate_id == associate_id,
        SecondarySalesUpload.state_code.ilike(state_code),
        SecondarySalesUpload.city.ilike(city),
        SecondarySalesUpload.year == year,
        SecondarySalesUpload.month == month,
    ).all()
    for upload in old_uploads:
        db.query(SecondarySalesLine).filter(SecondarySalesLine.upload_id == upload.id).delete(synchronize_session=False)
        db.delete(upload)
    db.query(RegionalSalesEntry).filter(
        RegionalSalesEntry.associate_id == associate_id,
        RegionalSalesEntry.state_code.ilike(state_code),
        RegionalSalesEntry.city.ilike(city),
        RegionalSalesEntry.year == year,
        RegionalSalesEntry.month == month,
    ).delete(synchronize_session=False)
    db.flush()


def _write_rollup(db, upload, lines):
    """Product x week totals across all stockists -> RegionalSalesEntry."""
    totals = {}
    for line in lines:
        if not line["product_id"] or line["sales_qty"] <= 0:
            continue
        key = (line["product_id"], line["week"])
        current = totals.setdefault(key, {"qty": 0.0, "value": 0.0})
        current["qty"] += line["sales_qty"]
        current["value"] += line["sales_value"]
    now = datetime.utcnow()
    for (product_id, week), total in totals.items():
        db.add(RegionalSalesEntry(
            associate_id=upload.associate_id,
            state_code=upload.state_code,
            city=upload.city,
            product_id=product_id,
            year=upload.year,
            month=upload.month,
            week=week,
            qty=round(total["qty"], 3),
            price=round(total["value"] / total["qty"], 2) if total["qty"] else 0,
            value=round(total["value"], 2),
            remarks=(ROLLUP_REMARK + upload.filename)[:500],
            submitted_at=now,
        ))
    return len(totals)


def _import_sheet(db, current_user, raw, filename, content_type, associate_id, state_code, city, year, month):
    products = db.query(Product).filter(Product.is_active == True).all()
    try:
        parsed = parse_secondary_sheet(raw, products, month=month, filename=filename)
    except SheetFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not parsed["lines"]:
        raise HTTPException(
            status_code=400,
            detail=f"No sales or closing figures were found on the '{parsed['sheet_name']}' sheet.",
        )

    _clear_month(db, associate_id, state_code, city, year, month)
    upload = SecondarySalesUpload(
        associate_id=associate_id,
        uploaded_by_id=current_user.id,
        state_code=state_code,
        city=city,
        year=year,
        month=month,
        filename=filename[:255],
        sheet_name=(parsed["sheet_name"] or "")[:100],
        content_type=(content_type or "application/octet-stream")[:100],
        file_data=raw,
        stockist_count=len({line["stockist"] for line in parsed["lines"]}),
        total_sales_qty=parsed["totals"]["sales_qty"],
        total_sales_value=parsed["totals"]["sales_value"],
        total_closing_qty=parsed["totals"]["closing_qty"],
        total_closing_value=parsed["totals"]["closing_value"],
        warnings=json.dumps(parsed["warnings"]),
        uploaded_at=datetime.utcnow(),
    )
    db.add(upload)
    db.flush()
    for line in parsed["lines"]:
        db.add(SecondarySalesLine(
            upload_id=upload.id,
            associate_id=associate_id,
            state_code=state_code,
            city=city,
            year=year,
            month=month,
            week=line["week"],
            stockist_name=line["stockist"][:200],
            stockist_key=_stockist_key(line["stockist"])[:200],
            product_id=line["product_id"],
            source_product_name=line["source_product_name"][:200],
            rate=line["rate"],
            rate_source=line["rate_source"],
            sales_qty=line["sales_qty"],
            sales_value=line["sales_value"],
            closing_qty=line["closing_qty"],
            closing_value=line["closing_value"],
        ))
    rollup_rows = _write_rollup(db, upload, parsed["lines"])
    db.commit()
    db.refresh(upload)
    result = _upload_metadata(upload)
    result["rollup_rows"] = rollup_rows
    result["weeks_with_data"] = parsed["weeks_with_data"]
    result["unmatched_products"] = parsed["unmatched_products"]
    return result


@router.post("/upload-session/start")
def start_upload(payload: UploadStartRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    state_code, city = payload.state_code.strip(), payload.city.strip()
    _check_scope(current_user, payload.associate_id, state_code, city, payload.year, payload.month, db)
    filename = Path(payload.filename or "").name[:255]
    if Path(filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=400, detail="Upload the stockist sheet as an Excel .xlsx file")
    if payload.file_size <= 0 or payload.file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The sheet must be between 1 byte and 10 MB")
    checksum = payload.file_checksum.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise HTTPException(status_code=400, detail="Invalid file checksum")

    session_id = uuid4().hex
    UPLOAD_SESSION_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = UPLOAD_SESSION_ROOT / session_id
    path.mkdir(mode=0o700)
    chunk_count = math.ceil(payload.file_size / UPLOAD_CHUNK_BYTES)
    metadata = {
        "user_id": current_user.id,
        "filename": filename,
        "file_size": payload.file_size,
        "file_checksum": checksum,
        "chunk_count": chunk_count,
        "associate_id": payload.associate_id,
        "state_code": state_code,
        "city": city,
        "year": payload.year,
        "month": payload.month,
    }
    (path / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return {"session_id": session_id, "chunk_size": UPLOAD_CHUNK_BYTES, "chunk_count": chunk_count}


@router.post("/upload-session/{session_id}/chunk")
def upload_chunk(session_id: str, payload: UploadChunkRequest, current_user=Depends(get_current_user)):
    path, metadata = _session(session_id, current_user)
    chunk_count = int(metadata["chunk_count"])
    if payload.index < 0 or payload.index >= chunk_count:
        raise HTTPException(status_code=400, detail="Invalid upload chunk index")
    try:
        chunk = base64.b64decode(payload.data, validate=True)
    except (ValueError, TypeError, binascii.Error):
        raise HTTPException(status_code=400, detail="Invalid upload chunk")
    expected = UPLOAD_CHUNK_BYTES
    if payload.index == chunk_count - 1:
        expected = int(metadata["file_size"]) - payload.index * UPLOAD_CHUNK_BYTES
    if len(chunk) != expected:
        raise HTTPException(status_code=400, detail="Upload chunk has the wrong size")
    temp = path / f"{payload.index:06d}.tmp"
    temp.write_bytes(chunk)
    temp.replace(path / f"{payload.index:06d}.part")
    return {"received": payload.index, "chunk_count": chunk_count}


@router.post("/upload-session/{session_id}/complete")
def complete_upload(
    session_id: str,
    payload: UploadCompleteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    path, metadata = _session(session_id, current_user)
    try:
        if payload.file_checksum.lower() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="File checksum changed during upload")
        parts = []
        for index in range(int(metadata["chunk_count"])):
            part = path / f"{index:06d}.part"
            if not part.exists():
                raise HTTPException(status_code=400, detail=f"Upload chunk {index + 1} is missing")
            parts.append(part.read_bytes())
        raw = b"".join(parts)
        if len(raw) != int(metadata["file_size"]) or hashlib.sha256(raw).hexdigest() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="Uploaded file does not match its checksum")
        _check_scope(current_user, int(metadata["associate_id"]), metadata["state_code"], metadata["city"],
                     int(metadata["year"]), int(metadata["month"]), db)
        return _import_sheet(
            db, current_user, raw, metadata["filename"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            int(metadata["associate_id"]), metadata["state_code"], metadata["city"],
            int(metadata["year"]), int(metadata["month"]),
        )
    finally:
        _remove_session(path)


@router.get("/summary")
def secondary_summary(
    year: int,
    month: int,
    state_code: Optional[str] = None,
    city: Optional[str] = None,
    associate_id: Optional[int] = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Uploads and stockist lines visible to the viewer for one month."""
    visible_ids = get_subtree_ids(current_user.id, db)
    allowed_territories = visible_territories(current_user.id, db)
    if city and allowed_territories is not None and city.strip() not in allowed_territories:
        raise HTTPException(status_code=403, detail=f"You are not assigned to the {city.strip()} territory")

    uploads_q = db.query(SecondarySalesUpload).filter(
        SecondarySalesUpload.year == year, SecondarySalesUpload.month == month,
    )
    lines_q = db.query(SecondarySalesLine).filter(
        SecondarySalesLine.year == year, SecondarySalesLine.month == month,
    )
    if visible_ids is not None:
        uploads_q = uploads_q.filter(SecondarySalesUpload.associate_id.in_(visible_ids))
        lines_q = lines_q.filter(SecondarySalesLine.associate_id.in_(visible_ids))
    if allowed_territories is not None:
        if not allowed_territories:
            return {"uploads": [], "lines": []}
        uploads_q = uploads_q.filter(SecondarySalesUpload.city.in_(allowed_territories))
        lines_q = lines_q.filter(SecondarySalesLine.city.in_(allowed_territories))
    if associate_id:
        uploads_q = uploads_q.filter(SecondarySalesUpload.associate_id == associate_id)
        lines_q = lines_q.filter(SecondarySalesLine.associate_id == associate_id)
    if state_code:
        uploads_q = uploads_q.filter(SecondarySalesUpload.state_code.ilike(state_code.strip()))
        lines_q = lines_q.filter(SecondarySalesLine.state_code.ilike(state_code.strip()))
    if city:
        uploads_q = uploads_q.filter(SecondarySalesUpload.city.ilike(city.strip()))
        lines_q = lines_q.filter(SecondarySalesLine.city.ilike(city.strip()))

    uploads = uploads_q.order_by(SecondarySalesUpload.uploaded_at.desc()).all()
    names = {upload.associate_id: (upload.associate.name if upload.associate else "") for upload in uploads}
    lines = lines_q.order_by(SecondarySalesLine.stockist_name, SecondarySalesLine.source_product_name, SecondarySalesLine.week).all()
    return {
        "uploads": [_upload_metadata(upload) for upload in uploads],
        "lines": [{
            "upload_id": line.upload_id,
            "associate_id": line.associate_id,
            "associate_name": names.get(line.associate_id, ""),
            "state_code": line.state_code,
            "city": line.city,
            "week": line.week,
            "stockist": line.stockist_name,
            "stockist_key": line.stockist_key,
            "product_id": line.product_id,
            "product_name": line.product.name if line.product else None,
            "source_product_name": line.source_product_name,
            "rate": line.rate,
            "rate_source": line.rate_source,
            "sales_qty": line.sales_qty,
            "sales_value": line.sales_value,
            "closing_qty": line.closing_qty,
            "closing_value": line.closing_value,
        } for line in lines],
    }


def _owned_upload(upload_id, current_user, db):
    upload = db.query(SecondarySalesUpload).filter(SecondarySalesUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    visible_ids = get_subtree_ids(current_user.id, db)
    if visible_ids is not None and upload.associate_id not in visible_ids:
        raise HTTPException(status_code=403, detail="This upload belongs to someone outside your team")
    allowed = visible_territories(current_user.id, db)
    if allowed is not None and upload.city not in allowed:
        raise HTTPException(status_code=403, detail=f"You are not assigned to the {upload.city} territory")
    return upload


@router.get("/uploads/{upload_id}/download")
def download_upload(upload_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    upload = _owned_upload(upload_id, current_user, db)
    safe = (upload.filename or "secondary-sales.xlsx").replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=upload.file_data,
        media_type=upload.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


@router.delete("/uploads/{upload_id}")
def delete_upload(upload_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    upload = _owned_upload(upload_id, current_user, db)
    _clear_month(db, upload.associate_id, upload.state_code, upload.city, upload.year, upload.month)
    db.commit()
    return {"status": "deleted", "upload_id": upload_id}
