import base64
import binascii
import calendar
import hashlib
import json
import math
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import CollectionUpload, OutstandingEntry, ReceiptEntry, Stockist, User
from ..services.collections_import import parse_collection_report


router = APIRouter(prefix="/collections", tags=["Receipts and outstanding"])
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 4 * 1024
UPLOAD_SESSION_ROOT = Path("/tmp/fortel-collections-upload-sessions")


class UploadStartRequest(BaseModel):
    filename: str
    file_size: int
    file_checksum: str
    report_type: str
    stockist_id: int


class UploadChunkRequest(BaseModel):
    index: int
    data: str


class UploadCompleteRequest(BaseModel):
    file_checksum: str


def _require_staff(user):
    if user.role not in {"back_office", "md"}:
        raise HTTPException(status_code=403, detail="Only back-office staff or the MD can upload these reports")


def _require_md(user):
    if user.role != "md":
        raise HTTPException(status_code=403, detail="This collections information is visible only to the MD")


def _upload_dict(upload):
    stockist = upload.stockist if upload else None
    return {
        "id": upload.id,
        "report_type": upload.report_type,
        "filename": upload.filename,
        "period_start": upload.period_start,
        "period_end": upload.period_end,
        "row_count": upload.source_row_count,
        "total_amount": upload.total_amount,
        "uploaded_at": upload.uploaded_at.isoformat() if upload.uploaded_at else None,
        "uploaded_by": upload.uploaded_by.name if upload.uploaded_by else None,
        "stockist_id": upload.stockist_id,
        "stockist_name": stockist.name if stockist else "Unassigned distributor",
        "region": stockist.region if stockist else "Unassigned",
        "territory": stockist.territory if stockist else "Unassigned",
    }


def _persist_report(content, filename, report_type, stockist_id, current_user, db):
    report_type = (report_type or "").strip().lower()
    if report_type not in {"receipt", "outstanding"}:
        raise HTTPException(status_code=400, detail="Report type must be receipt or outstanding")
    filename = Path(filename or "report").name[:255]
    if Path(filename).suffix.lower() not in {".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Upload an Excel .xls or .xlsx file")
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The file exceeds the 15 MB limit")
    stockist = db.query(Stockist).filter(Stockist.id == stockist_id, Stockist.is_active == True).first()
    if not stockist:
        raise HTTPException(status_code=400, detail="Select a valid distributor before uploading")

    checksum = hashlib.sha256(content).hexdigest()
    duplicate = db.query(CollectionUpload).filter(
        CollectionUpload.report_type == report_type,
        CollectionUpload.file_checksum == checksum,
        CollectionUpload.stockist_id == stockist.id,
    ).first()
    if duplicate:
        result = _upload_dict(duplicate)
        result["duplicate"] = True
        return result

    try:
        parsed = parse_collection_report(content, filename, report_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    upload = CollectionUpload(
        uploaded_by_id=current_user.id,
        stockist_id=stockist.id,
        report_type=report_type,
        filename=filename,
        file_checksum=checksum,
        period_start=parsed["period_start"],
        period_end=parsed["period_end"],
        source_row_count=len(parsed["entries"]),
        total_amount=parsed["total_amount"],
        uploaded_at=datetime.utcnow(),
    )
    db.add(upload)
    db.flush()
    model = ReceiptEntry if report_type == "receipt" else OutstandingEntry
    db.add_all([model(upload_id=upload.id, **entry) for entry in parsed["entries"]])
    db.commit()
    db.refresh(upload)
    result = _upload_dict(upload)
    result["duplicate"] = False
    return result


def _load_session(session_id, current_user):
    if not re.fullmatch(r"[0-9a-f]{32}", session_id or ""):
        raise HTTPException(status_code=404, detail="Upload session not found")
    session_path = UPLOAD_SESSION_ROOT / session_id
    metadata_path = session_path / "metadata.json"
    if session_path.parent != UPLOAD_SESSION_ROOT or not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Upload session is invalid")
    if int(metadata.get("user_id", 0)) != current_user.id:
        raise HTTPException(status_code=403, detail="Upload session belongs to another user")
    return session_path, metadata


@router.post("/upload")
async def upload_report(
    report_type: str = Form(...),
    stockist_id: int = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_staff(current_user)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    return _persist_report(content, file.filename, report_type, stockist_id, current_user, db)


@router.post("/upload-session/start")
def start_upload_session(
    payload: UploadStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_staff(current_user)
    filename = Path(payload.filename or "").name[:255]
    report_type = (payload.report_type or "").strip().lower()
    checksum = (payload.file_checksum or "").lower()
    if report_type not in {"receipt", "outstanding"}:
        raise HTTPException(status_code=400, detail="Report type must be receipt or outstanding")
    if Path(filename).suffix.lower() not in {".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Upload an Excel .xls or .xlsx file")
    if payload.file_size <= 0 or payload.file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be between 1 byte and 15 MB")
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise HTTPException(status_code=400, detail="Invalid file checksum")
    if not db.query(Stockist.id).filter(Stockist.id == payload.stockist_id, Stockist.is_active == True).first():
        raise HTTPException(status_code=400, detail="Select a valid distributor before uploading")
    session_id = uuid4().hex
    UPLOAD_SESSION_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    session_path = UPLOAD_SESSION_ROOT / session_id
    session_path.mkdir(mode=0o700)
    chunk_count = math.ceil(payload.file_size / UPLOAD_CHUNK_BYTES)
    metadata = {
        "user_id": current_user.id, "filename": filename, "report_type": report_type,
        "stockist_id": payload.stockist_id, "file_size": payload.file_size,
        "file_checksum": checksum, "chunk_count": chunk_count,
    }
    (session_path / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return {"session_id": session_id, "chunk_size": UPLOAD_CHUNK_BYTES, "chunk_count": chunk_count}


@router.post("/upload-session/{session_id}/chunk")
def upload_session_chunk(session_id: str, payload: UploadChunkRequest, current_user: User = Depends(get_current_user)):
    _require_staff(current_user)
    session_path, metadata = _load_session(session_id, current_user)
    chunk_count = int(metadata["chunk_count"])
    if payload.index < 0 or payload.index >= chunk_count:
        raise HTTPException(status_code=400, detail="Invalid upload chunk index")
    try:
        chunk = base64.b64decode(payload.data, validate=True)
    except (ValueError, TypeError, binascii.Error):
        raise HTTPException(status_code=400, detail="Invalid upload chunk")
    expected_size = UPLOAD_CHUNK_BYTES if payload.index < chunk_count - 1 else int(metadata["file_size"]) - payload.index * UPLOAD_CHUNK_BYTES
    if len(chunk) != expected_size:
        raise HTTPException(status_code=400, detail="Upload chunk has the wrong size")
    (session_path / f"{payload.index:06d}.part").write_bytes(chunk)
    return {"received": payload.index, "chunk_count": chunk_count}


@router.post("/upload-session/{session_id}/complete")
def complete_upload_session(
    session_id: str, payload: UploadCompleteRequest,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    _require_staff(current_user)
    session_path, metadata = _load_session(session_id, current_user)
    try:
        if payload.file_checksum.lower() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="File checksum changed during upload")
        parts = []
        for index in range(int(metadata["chunk_count"])):
            part = session_path / f"{index:06d}.part"
            if not part.exists():
                raise HTTPException(status_code=400, detail=f"Upload chunk {index + 1} is missing")
            parts.append(part.read_bytes())
        content = b"".join(parts)
        if len(content) != int(metadata["file_size"]) or hashlib.sha256(content).hexdigest() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="Uploaded file verification failed")
        return _persist_report(
            content, metadata["filename"], metadata["report_type"],
            int(metadata["stockist_id"]), current_user, db,
        )
    finally:
        shutil.rmtree(session_path, ignore_errors=True)


@router.get("/uploads")
def list_uploads(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_staff(current_user)
    response.headers["Cache-Control"] = "no-store"
    uploads = db.query(CollectionUpload).order_by(CollectionUpload.uploaded_at.desc()).limit(30).all()
    result = []
    for upload in uploads:
        model = ReceiptEntry if upload.report_type == "receipt" else OutstandingEntry
        amount_column = ReceiptEntry.amount if upload.report_type == "receipt" else OutstandingEntry.balance
        customer_rows = db.query(
            model.customer_name,
            func.sum(amount_column).label("amount"),
        ).filter(model.upload_id == upload.id).group_by(model.customer_name).order_by(model.customer_name).all()
        item = _upload_dict(upload)
        item["customer_amounts"] = [
            {"customer_name": row.customer_name, "amount": round(float(row.amount or 0), 2)}
            for row in customer_rows if row.customer_name
        ]
        item["customer_names"] = [row["customer_name"] for row in item["customer_amounts"]]
        item["customer_count"] = len(item["customer_amounts"])
        result.append(item)
    return result


@router.get("/md-summary")
def md_summary(
    response: Response,
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_md(current_user)
    response.headers["Cache-Control"] = "no-store"
    if (year is None) != (month is None):
        raise HTTPException(status_code=400, detail="Year and month must be supplied together")
    if year is not None and (year < 2000 or year > 2100 or month < 1 or month > 12):
        raise HTTPException(status_code=400, detail="Invalid collection period")
    period_start = None
    period_end = None
    if year is not None:
        period_start = f"{year:04d}-{month:02d}-01"
        period_end = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"

    def uploads_for_period():
        query = db.query(CollectionUpload)
        if period_start and period_end:
            query = query.filter(
                CollectionUpload.period_start <= period_end,
                CollectionUpload.period_end >= period_start,
            )
        return query

    period_uploads = uploads_for_period().order_by(CollectionUpload.uploaded_at.desc()).all()
    latest_by_distributor = {}
    for upload in period_uploads:
        key = (upload.stockist_id or 0, upload.report_type)
        if key not in latest_by_distributor:
            latest_by_distributor[key] = upload

    selected_uploads = list(latest_by_distributor.values())
    receipt_uploads = [row for row in selected_uploads if row.report_type == "receipt"]
    outstanding_uploads = [row for row in selected_uploads if row.report_type == "outstanding"]
    receipt_ids = [row.id for row in receipt_uploads]
    outstanding_ids = [row.id for row in outstanding_uploads]
    receipt_sources = {row.id: row for row in receipt_uploads}
    outstanding_sources = {row.id: row for row in outstanding_uploads}

    receipts = [] if not receipt_ids else db.query(ReceiptEntry).filter(
        ReceiptEntry.upload_id.in_(receipt_ids)
    ).order_by(ReceiptEntry.receipt_date.desc(), ReceiptEntry.id.desc()).all()
    outstanding = [] if not outstanding_ids else db.query(OutstandingEntry).filter(
        OutstandingEntry.upload_id.in_(outstanding_ids)
    ).order_by(OutstandingEntry.balance.desc()).all()

    def aggregate_uploads(rows, report_type):
        if not rows:
            return None
        starts = [row.period_start for row in rows if row.period_start]
        ends = [row.period_end for row in rows if row.period_end]
        newest = max(rows, key=lambda row: row.uploaded_at)
        return {
            "id": None,
            "report_type": report_type,
            "filename": f"{len(rows)} distributor report{'s' if len(rows) != 1 else ''}",
            "period_start": min(starts) if starts else None,
            "period_end": max(ends) if ends else None,
            "row_count": sum(row.source_row_count or 0 for row in rows),
            "total_amount": round(sum(float(row.total_amount or 0) for row in rows), 2),
            "uploaded_at": newest.uploaded_at.isoformat() if newest.uploaded_at else None,
            "uploaded_by": newest.uploaded_by.name if len(rows) == 1 and newest.uploaded_by else "Multiple uploads",
            "distributor_count": len(rows),
        }

    distributor_ids = sorted({key[0] for key in latest_by_distributor})
    by_distributor = []
    for stockist_id in distributor_ids:
        receipt_upload = latest_by_distributor.get((stockist_id, "receipt"))
        outstanding_upload = latest_by_distributor.get((stockist_id, "outstanding"))
        source = receipt_upload or outstanding_upload
        received = float(receipt_upload.total_amount or 0) if receipt_upload else 0
        pending = float(outstanding_upload.total_amount or 0) if outstanding_upload else 0
        total = received + pending
        by_distributor.append({
            "stockist_id": source.stockist_id,
            "stockist_name": source.stockist.name if source.stockist else "Unassigned distributor",
            "region": source.stockist.region if source.stockist else "Unassigned",
            "territory": source.stockist.territory if source.stockist else "Unassigned",
            "received_amount": round(received, 2),
            "pending_amount": round(pending, 2),
            "total_amount": round(total, 2),
            "recovery_pct": round((received / total) * 100, 1) if total else 0,
            "receipt_upload": _upload_dict(receipt_upload) if receipt_upload else None,
            "outstanding_upload": _upload_dict(outstanding_upload) if outstanding_upload else None,
        })
    by_distributor.sort(key=lambda row: (-row["total_amount"], row["stockist_name"]))
    history = period_uploads[:30]

    return {
        "year": year,
        "month": month,
        "period_start": period_start,
        "period_end": period_end,
        "receipt_upload": aggregate_uploads(receipt_uploads, "receipt"),
        "outstanding_upload": aggregate_uploads(outstanding_uploads, "outstanding"),
        "by_distributor": by_distributor,
        "receipts": [{
            "id": row.id,
            "receipt_date": row.receipt_date,
            "receipt_no": row.receipt_no,
            "mode": row.mode,
            "customer_name": row.customer_name,
            "customer_code": row.customer_code,
            "salesman_name": row.salesman_name,
            "amount": row.amount,
            "stockist_id": receipt_sources[row.upload_id].stockist_id,
            "stockist_name": receipt_sources[row.upload_id].stockist.name if receipt_sources[row.upload_id].stockist else "Unassigned distributor",
            "region": receipt_sources[row.upload_id].stockist.region if receipt_sources[row.upload_id].stockist else "Unassigned",
        } for row in receipts],
        "outstanding": [{
            "id": row.id,
            "customer_code": row.customer_code,
            "customer_name": row.customer_name,
            "area_name": row.area_name,
            "city_name": row.city_name,
            "balance": row.balance,
            "stockist_id": outstanding_sources[row.upload_id].stockist_id,
            "stockist_name": outstanding_sources[row.upload_id].stockist.name if outstanding_sources[row.upload_id].stockist else "Unassigned distributor",
            "region": outstanding_sources[row.upload_id].stockist.region if outstanding_sources[row.upload_id].stockist else "Unassigned",
        } for row in outstanding],
        "recent_uploads": [_upload_dict(upload) for upload in history],
    }
