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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import (
    PrimaryCitySplitEntry,
    PrimaryCitySplitUpload,
    PrimarySalesEntry,
    PrimarySalesUpload,
    Stockist,
    User,
)
from ..services.primary_sales_import import (
    ensure_seed_stockists,
    infer_stockist_location,
    normalize_stockist_name,
    parse_primary_city_split_workbook,
    parse_primary_sales_workbook,
    primary_sales_reconciliation,
    primary_sales_week_bounds,
)
from ..utils.regional_territories import territory_for_city


router = APIRouter(prefix="/primary-sales", tags=["Primary Sales"])
transport_router = APIRouter(prefix="/sales/primary", tags=["Primary Sales"])

PRIMARY_SALES_UPLOADER_EMAILS = {"staff1@fortel.in", "staff2@fortel.in"}
PRIMARY_SALES_MANAGER_ROLES = {"admin", "md", "back_office"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 4 * 1024
UPLOAD_SESSION_ROOT = Path("/tmp/fortel-primary-upload-sessions")
CITY_SPLIT_UPLOAD_SESSION_ROOT = Path("/tmp/fortel-primary-city-split-upload-sessions")


class StockistUpdateRequest(BaseModel):
    region: str
    territory: str


class UploadStartRequest(BaseModel):
    filename: str
    file_size: int
    file_checksum: str


class UploadChunkRequest(BaseModel):
    index: int
    data: str


class UploadCompleteRequest(BaseModel):
    file_checksum: str


class UploadDeleteRequest(BaseModel):
    confirmation: str


def _require_uploader(user: User):
    email = (user.email or "").strip().lower()
    if user.role != "back_office" or email not in PRIMARY_SALES_UPLOADER_EMAILS:
        raise HTTPException(status_code=403, detail="Only Staff 1 and Staff 2 can upload primary sales")


def _require_stockist_manager(user: User):
    if user.role not in PRIMARY_SALES_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="You cannot update primary-sales stockist mappings")


def _upload_payload(upload: PrimarySalesUpload):
    return {
        "id": upload.id,
        "filename": upload.filename,
        "period_start": upload.period_start,
        "period_end": upload.period_end,
        "source_row_count": upload.source_row_count,
        "inserted_count": upload.inserted_count,
        "updated_count": upload.updated_count,
        "skipped_count": upload.skipped_count,
        "total_net_amount": round(upload.total_net_amount or 0, 2),
        "total_sales_amount": round(upload.total_net_amount or 0, 2),
        "uploaded_at": upload.uploaded_at,
        "uploaded_by_id": upload.uploaded_by_id,
        "uploaded_by_name": upload.uploaded_by.name if upload.uploaded_by else "",
    }


def _city_split_upload_payload(upload: PrimaryCitySplitUpload):
    return {
        "id": upload.id,
        "filename": upload.filename,
        "period_start": upload.period_start,
        "period_end": upload.period_end,
        "source_row_count": upload.source_row_count,
        "inserted_count": upload.inserted_count,
        "updated_count": upload.updated_count,
        "skipped_count": upload.skipped_count,
        "total_sales_amount": round(upload.total_gross_amount or 0, 2),
        "uploaded_at": upload.uploaded_at,
        "uploaded_by_id": upload.uploaded_by_id,
        "uploaded_by_name": upload.uploaded_by.name if upload.uploaded_by else "",
    }


def _session_path(session_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", session_id or ""):
        raise HTTPException(status_code=404, detail="Upload session not found")
    return UPLOAD_SESSION_ROOT / session_id


def _load_upload_session(session_id: str, current_user: User) -> tuple[Path, dict]:
    session_path = _session_path(session_id)
    metadata_path = session_path / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Upload session not found")
    if int(metadata.get("user_id") or 0) != current_user.id:
        raise HTTPException(status_code=403, detail="This upload session belongs to another user")
    return session_path, metadata


def _remove_upload_session(session_path: Path):
    if session_path.parent != UPLOAD_SESSION_ROOT:
        return
    if not session_path.exists():
        return
    for item in session_path.iterdir():
        if item.is_file():
            item.unlink()
    session_path.rmdir()


def _load_city_split_upload_session(session_id: str, current_user: User) -> tuple[Path, dict]:
    if not re.fullmatch(r"[0-9a-f]{32}", session_id or ""):
        raise HTTPException(status_code=404, detail="Upload session not found")
    session_path = CITY_SPLIT_UPLOAD_SESSION_ROOT / session_id
    metadata_path = session_path / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Upload session not found")
    if int(metadata.get("user_id") or 0) != current_user.id:
        raise HTTPException(status_code=403, detail="This upload session belongs to another user")
    return session_path, metadata


def _remove_city_split_upload_session(session_path: Path):
    if session_path.parent != CITY_SPLIT_UPLOAD_SESSION_ROOT or not session_path.exists():
        return
    for item in session_path.iterdir():
        if item.is_file():
            item.unlink()
    session_path.rmdir()


def _city_label(value: str) -> str:
    cleaned = " ".join((value or "").strip().split())
    return cleaned.title() if cleaned else "Unassigned"


def _persist_primary_city_split(content: bytes, filename: str, current_user: User, db: Session):
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be 15 MB or smaller")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded Excel file is empty")
    try:
        parsed = parse_primary_city_split_workbook(content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    rows = parsed["rows"]
    dates = sorted(row["bill_date"] for row in rows if row["bill_date"])
    replaced_rows = db.query(PrimaryCitySplitEntry).count()
    replaced_uploads = db.query(PrimaryCitySplitUpload).count()
    db.query(PrimaryCitySplitEntry).delete(synchronize_session=False)
    db.query(PrimaryCitySplitUpload).delete(synchronize_session=False)
    db.flush()

    upload = PrimaryCitySplitUpload(
        uploaded_by_id=current_user.id,
        filename=filename,
        file_checksum=parsed["file_checksum"],
        period_start=dates[0] if dates else None,
        period_end=dates[-1] if dates else None,
        source_row_count=len(rows),
        skipped_count=parsed["skipped_count"],
        # The sheet already includes the distributor uplift; never multiply it again.
        total_gross_amount=round(sum(row["gross_amount"] for row in rows), 2),
    )
    db.add(upload)
    db.flush()

    for row in rows:
        city = _city_label(row.get("city"))
        territory = territory_for_city(city) or "Unassigned"
        values = {
            "upload_id": upload.id,
            "uploaded_by_id": current_user.id,
            "customer_code": row.get("customer_code") or None,
            "customer_name": row["stockist_name"],
            "bill_number": row["bill_number"],
            "bill_date": row["bill_date"],
            "product_code": row.get("product_code") or None,
            "product_name": row["product_name"],
            "batch_number": row["batch_number"] or None,
            "quantity": row["quantity"],
            "free_quantity": row["free_quantity"],
            "rate": row["rate"],
            "gross_amount": row["gross_amount"],
            "net_amount": row["net_amount"],
            "sale_type": row.get("sale_type") or None,
            "source_city": city,
            "territory": territory,
            "region": "Tamil Nadu",
            "updated_at": datetime.utcnow(),
        }
        db.add(PrimaryCitySplitEntry(source_key=row["source_key"], **values))

    upload.inserted_count = len(rows)
    upload.updated_count = 0
    db.commit()
    db.refresh(upload)
    return {
        "status": "uploaded",
        "message": f"Replaced {replaced_rows} old city rows and imported {len(rows)} rows",
        "upload": _city_split_upload_payload(upload),
        "replaced_uploads": replaced_uploads,
        "replaced_rows": replaced_rows,
    }


def _persist_primary_sales(content: bytes, filename: str, current_user: User, db: Session):
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be 15 MB or smaller")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded Excel file is empty")
    try:
        parsed = parse_primary_sales_workbook(content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    rows = parsed["rows"]
    dates = sorted(row["bill_date"] for row in rows if row["bill_date"])
    replaced_rows = db.query(PrimarySalesEntry).count()
    replaced_uploads = db.query(PrimarySalesUpload).count()
    db.query(PrimarySalesEntry).delete(synchronize_session=False)
    db.query(PrimarySalesUpload).delete(synchronize_session=False)
    db.flush()

    upload = PrimarySalesUpload(
        uploaded_by_id=current_user.id,
        filename=filename,
        file_checksum=parsed["file_checksum"],
        period_start=dates[0] if dates else None,
        period_end=dates[-1] if dates else None,
        source_row_count=len(rows),
        skipped_count=parsed["skipped_count"],
        # Keep the legacy database column name, but store the selected Primary
        # Sales metric: Excel "Gross Amount with Discount".
        total_net_amount=round(sum(row["gross_amount"] for row in rows), 2),
    )
    db.add(upload)
    db.flush()

    stockists = ensure_seed_stockists(db)
    for row in rows:
        normalized = row["normalized_stockist_name"]
        if normalized in stockists:
            continue
        region, territory = infer_stockist_location(row.get("gst_number"), row["stockist_name"])
        stockist = Stockist(
            name=row["stockist_name"],
            normalized_name=normalized,
            region=region,
            territory=territory,
        )
        db.add(stockist)
        db.flush()
        stockists[normalized] = stockist

    for row in rows:
        values = {
            "upload_id": upload.id,
            "uploaded_by_id": current_user.id,
            "stockist_id": stockists[row["normalized_stockist_name"]].id,
            "bill_number": row["bill_number"],
            "bill_date": row["bill_date"],
            "product_name": row["product_name"],
            "batch_number": row["batch_number"] or None,
            "quantity": row["quantity"],
            "free_quantity": row["free_quantity"],
            "rate": row["rate"],
            "gross_amount": row["gross_amount"],
            "net_amount": row["net_amount"],
            "tax_amount": row["tax_amount"],
            "gst_number": row["gst_number"] or None,
            "updated_at": datetime.utcnow(),
        }
        db.add(PrimarySalesEntry(source_key=row["source_key"], **values))

    upload.inserted_count = len(rows)
    upload.updated_count = 0
    db.commit()
    db.refresh(upload)
    unassigned = sorted({
        stockists[row["normalized_stockist_name"]].name
        for row in rows
        if stockists[row["normalized_stockist_name"]].territory == "Unassigned"
    })
    return {
        "status": "uploaded",
        "message": f"Replaced {replaced_rows} old rows and imported {len(rows)} rows",
        "upload": _upload_payload(upload),
        "unassigned_stockists": unassigned,
        "replaced_uploads": replaced_uploads,
        "replaced_rows": replaced_rows,
    }


@router.get("/stockists")
@transport_router.get("/stockists")
def list_stockists(db: Session = Depends(get_db)):
    ensure_seed_stockists(db)
    db.commit()
    rows = db.query(Stockist).filter(Stockist.is_active == True).order_by(Stockist.region, Stockist.territory, Stockist.name).all()
    return [{
        "id": row.id,
        "name": row.name,
        "region": row.region,
        "territory": row.territory,
        "is_unassigned": row.region == "Unassigned" or row.territory == "Unassigned",
    } for row in rows]


@router.patch("/stockists/{stockist_id}")
@transport_router.patch("/stockists/{stockist_id}")
def update_stockist(
    stockist_id: int,
    payload: StockistUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_stockist_manager(current_user)
    stockist = db.query(Stockist).filter(Stockist.id == stockist_id).first()
    if not stockist:
        raise HTTPException(status_code=404, detail="Stockist not found")
    region = " ".join(payload.region.strip().split())
    territory = " ".join(payload.territory.strip().split())
    if not region or not territory:
        raise HTTPException(status_code=400, detail="Region and territory are required")
    stockist.region = region
    stockist.territory = territory
    stockist.updated_at = datetime.utcnow()
    db.commit()
    return {"id": stockist.id, "name": stockist.name, "region": stockist.region, "territory": stockist.territory}


@router.delete("/uploads/{upload_id}")
@transport_router.delete("/uploads/{upload_id}")
def delete_primary_sales_upload(
    upload_id: int,
    payload: UploadDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    if payload.confirmation.strip().upper() != "DELETE UPLOAD":
        raise HTTPException(status_code=400, detail="Type DELETE UPLOAD exactly to confirm")

    upload = db.query(PrimarySalesUpload).filter(PrimarySalesUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Primary Sales upload not found")

    filename = upload.filename
    deleted_rows = db.query(PrimarySalesEntry).filter(
        PrimarySalesEntry.upload_id == upload.id
    ).delete(synchronize_session=False)
    db.delete(upload)
    db.commit()
    return {
        "message": f"Deleted {filename}",
        "upload_id": upload_id,
        "filename": filename,
        "deleted_rows": deleted_rows,
    }


@router.post("/upload")
@transport_router.post("/upload")
async def upload_primary_sales(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    filename = (file.filename or "primary-sales.xls")[:255]
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    return _persist_primary_sales(content, filename, current_user, db)


@transport_router.post("/upload-session/start")
def start_upload_session(
    payload: UploadStartRequest,
    current_user: User = Depends(get_current_user),
):
    _require_uploader(current_user)
    filename = Path(payload.filename or "").name[:255]
    if Path(filename).suffix.lower() not in {".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Please upload an Excel .xls or .xlsx file")
    if payload.file_size <= 0 or payload.file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be between 1 byte and 15 MB")
    checksum = (payload.file_checksum or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise HTTPException(status_code=400, detail="Invalid file checksum")

    session_id = uuid4().hex
    UPLOAD_SESSION_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    session_path = UPLOAD_SESSION_ROOT / session_id
    session_path.mkdir(mode=0o700)
    chunk_count = math.ceil(payload.file_size / UPLOAD_CHUNK_BYTES)
    metadata = {
        "user_id": current_user.id,
        "filename": filename,
        "file_size": payload.file_size,
        "file_checksum": checksum,
        "chunk_count": chunk_count,
        "created_at": datetime.utcnow().isoformat(),
    }
    (session_path / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return {"session_id": session_id, "chunk_size": UPLOAD_CHUNK_BYTES, "chunk_count": chunk_count}


@transport_router.post("/upload-session/{session_id}/chunk")
def upload_session_chunk(
    session_id: str,
    payload: UploadChunkRequest,
    current_user: User = Depends(get_current_user),
):
    _require_uploader(current_user)
    session_path, metadata = _load_upload_session(session_id, current_user)
    chunk_count = int(metadata["chunk_count"])
    if payload.index < 0 or payload.index >= chunk_count:
        raise HTTPException(status_code=400, detail="Invalid upload chunk index")
    try:
        chunk = base64.b64decode(payload.data, validate=True)
    except (ValueError, TypeError, binascii.Error):
        raise HTTPException(status_code=400, detail="Invalid upload chunk")
    expected_size = UPLOAD_CHUNK_BYTES
    if payload.index == chunk_count - 1:
        expected_size = int(metadata["file_size"]) - (payload.index * UPLOAD_CHUNK_BYTES)
    if len(chunk) != expected_size:
        raise HTTPException(status_code=400, detail="Upload chunk has the wrong size")
    chunk_path = session_path / f"{payload.index:06d}.part"
    temp_path = session_path / f"{payload.index:06d}.tmp"
    temp_path.write_bytes(chunk)
    temp_path.replace(chunk_path)
    return {"received": payload.index, "chunk_count": chunk_count}


@transport_router.post("/upload-session/{session_id}/complete")
def complete_upload_session(
    session_id: str,
    payload: UploadCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    session_path, metadata = _load_upload_session(session_id, current_user)
    if payload.file_checksum.lower() != metadata["file_checksum"]:
        raise HTTPException(status_code=400, detail="File checksum changed during upload")
    try:
        parts = []
        for index in range(int(metadata["chunk_count"])):
            chunk_path = session_path / f"{index:06d}.part"
            if not chunk_path.exists():
                raise HTTPException(status_code=400, detail=f"Upload chunk {index + 1} is missing")
            parts.append(chunk_path.read_bytes())
        content = b"".join(parts)
        if len(content) != int(metadata["file_size"]):
            raise HTTPException(status_code=400, detail="Uploaded file size does not match")
        if hashlib.sha256(content).hexdigest() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="Uploaded file checksum does not match")
        return _persist_primary_sales(content, metadata["filename"], current_user, db)
    finally:
        _remove_upload_session(session_path)


@router.delete("/city-split/uploads/{upload_id}")
@transport_router.delete("/city-split/uploads/{upload_id}")
def delete_primary_city_split_upload(
    upload_id: int,
    payload: UploadDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    if payload.confirmation.strip().upper() != "DELETE UPLOAD":
        raise HTTPException(status_code=400, detail="Type DELETE UPLOAD exactly to confirm")
    upload = db.query(PrimaryCitySplitUpload).filter(PrimaryCitySplitUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Tamil Nadu city-split upload not found")
    filename = upload.filename
    deleted_rows = db.query(PrimaryCitySplitEntry).filter(
        PrimaryCitySplitEntry.upload_id == upload.id
    ).delete(synchronize_session=False)
    db.delete(upload)
    db.commit()
    return {
        "message": f"Deleted {filename}",
        "upload_id": upload_id,
        "filename": filename,
        "deleted_rows": deleted_rows,
    }


@transport_router.post("/city-split/upload-session/start")
def start_city_split_upload_session(
    payload: UploadStartRequest,
    current_user: User = Depends(get_current_user),
):
    _require_uploader(current_user)
    filename = Path(payload.filename or "").name[:255]
    if Path(filename).suffix.lower() not in {".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Please upload an Excel .xls or .xlsx file")
    if payload.file_size <= 0 or payload.file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be between 1 byte and 15 MB")
    checksum = (payload.file_checksum or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise HTTPException(status_code=400, detail="Invalid file checksum")

    session_id = uuid4().hex
    CITY_SPLIT_UPLOAD_SESSION_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    session_path = CITY_SPLIT_UPLOAD_SESSION_ROOT / session_id
    session_path.mkdir(mode=0o700)
    chunk_count = math.ceil(payload.file_size / UPLOAD_CHUNK_BYTES)
    metadata = {
        "user_id": current_user.id,
        "filename": filename,
        "file_size": payload.file_size,
        "file_checksum": checksum,
        "chunk_count": chunk_count,
        "created_at": datetime.utcnow().isoformat(),
    }
    (session_path / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return {"session_id": session_id, "chunk_size": UPLOAD_CHUNK_BYTES, "chunk_count": chunk_count}


@transport_router.post("/city-split/upload-session/{session_id}/chunk")
def city_split_upload_session_chunk(
    session_id: str,
    payload: UploadChunkRequest,
    current_user: User = Depends(get_current_user),
):
    _require_uploader(current_user)
    session_path, metadata = _load_city_split_upload_session(session_id, current_user)
    chunk_count = int(metadata["chunk_count"])
    if payload.index < 0 or payload.index >= chunk_count:
        raise HTTPException(status_code=400, detail="Invalid upload chunk index")
    try:
        chunk = base64.b64decode(payload.data, validate=True)
    except (ValueError, TypeError, binascii.Error):
        raise HTTPException(status_code=400, detail="Invalid upload chunk")
    expected_size = UPLOAD_CHUNK_BYTES
    if payload.index == chunk_count - 1:
        expected_size = int(metadata["file_size"]) - (payload.index * UPLOAD_CHUNK_BYTES)
    if len(chunk) != expected_size:
        raise HTTPException(status_code=400, detail="Upload chunk has the wrong size")
    chunk_path = session_path / f"{payload.index:06d}.part"
    temp_path = session_path / f"{payload.index:06d}.tmp"
    temp_path.write_bytes(chunk)
    temp_path.replace(chunk_path)
    return {"received": payload.index, "chunk_count": chunk_count}


@transport_router.post("/city-split/upload-session/{session_id}/complete")
def complete_city_split_upload_session(
    session_id: str,
    payload: UploadCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    session_path, metadata = _load_city_split_upload_session(session_id, current_user)
    if payload.file_checksum.lower() != metadata["file_checksum"]:
        raise HTTPException(status_code=400, detail="File checksum changed during upload")
    try:
        parts = []
        for index in range(int(metadata["chunk_count"])):
            chunk_path = session_path / f"{index:06d}.part"
            if not chunk_path.exists():
                raise HTTPException(status_code=400, detail=f"Upload chunk {index + 1} is missing")
            parts.append(chunk_path.read_bytes())
        content = b"".join(parts)
        if len(content) != int(metadata["file_size"]):
            raise HTTPException(status_code=400, detail="Uploaded file size does not match")
        if hashlib.sha256(content).hexdigest() != metadata["file_checksum"]:
            raise HTTPException(status_code=400, detail="Uploaded file checksum does not match")
        return _persist_primary_city_split(content, metadata["filename"], current_user, db)
    finally:
        _remove_city_split_upload_session(session_path)


@router.get("/summary")
@transport_router.get("/summary")
def primary_sales_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    week: Optional[int] = None,
    region: Optional[str] = None,
    territory: Optional[str] = None,
    stockist_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ensure_seed_stockists(db)
    db.commit()
    if year is None:
        year = datetime.utcnow().year
    if month is None:
        month = datetime.utcnow().month
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")

    period_start = start_date
    period_end = end_date
    if not start_date and not end_date and week is not None:
        try:
            period_start, period_end = primary_sales_week_bounds(year, month, week)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    def apply_dimension_filters(base_query):
        filtered = base_query
        if stockist_id:
            filtered = filtered.filter(PrimarySalesEntry.stockist_id == stockist_id)
        has_region_filter = bool(region and region != "ALL")
        has_territory_filter = bool(territory and territory != "ALL")
        if has_region_filter or has_territory_filter:
            filtered = filtered.join(Stockist)
        if has_region_filter:
            filtered = filtered.filter(Stockist.region == region)
        if has_territory_filter:
            filtered = filtered.filter(Stockist.territory == territory)
        return filtered

    query = db.query(PrimarySalesEntry).options(joinedload(PrimarySalesEntry.stockist))
    if period_start or period_end:
        if period_start:
            query = query.filter(PrimarySalesEntry.bill_date >= period_start)
        if period_end:
            query = query.filter(PrimarySalesEntry.bill_date <= period_end)
    else:
        query = query.filter(PrimarySalesEntry.bill_date.like(f"{year:04d}-{month:02d}-%"))
    query = apply_dimension_filters(query)
    entries = query.order_by(PrimarySalesEntry.bill_date.desc(), PrimarySalesEntry.id.desc()).all()

    # The week selector controls the headline, territory and product metrics.
    # Sales by stockist is deliberately a complete-month view so every bill for
    # that distributor remains visible while managers move between weeks.
    if period_start or period_end:
        month_stockist_query = db.query(PrimarySalesEntry).options(joinedload(PrimarySalesEntry.stockist)).filter(
            PrimarySalesEntry.bill_date.like(f"{year:04d}-{month:02d}-%")
        )
        month_stockist_entries = apply_dimension_filters(month_stockist_query).order_by(
            PrimarySalesEntry.bill_date.desc(), PrimarySalesEntry.id.desc()
        ).all()
    else:
        month_stockist_entries = entries

    stockist_rows = {}
    product_rows = {}
    region_totals = {}
    territory_totals = {}
    bills = set()
    selected_stockists = set()
    total_quantity = 0.0
    total_sales = 0.0
    for entry in entries:
        stockist = entry.stockist
        region_name = stockist.region if stockist else "Unassigned"
        territory_name = stockist.territory if stockist else "Unassigned"
        total_quantity += entry.quantity or 0
        sales_amount = entry.gross_amount or 0
        total_sales += sales_amount
        bill_key = (entry.stockist_id, entry.bill_number)
        bills.add(bill_key)
        selected_stockists.add(entry.stockist_id)
        region_totals[region_name] = region_totals.get(region_name, 0) + sales_amount
        territory_key = (region_name, territory_name)
        territory_totals[territory_key] = territory_totals.get(territory_key, 0) + sales_amount

        product_key = entry.product_name.strip().upper()
        product_row = product_rows.setdefault(product_key, {
            "product_name": entry.product_name,
            "sales_amount": 0.0,
            "quantity": 0.0,
            "line_count": 0,
        })
        product_row["sales_amount"] += sales_amount
        product_row["quantity"] += entry.quantity or 0
        product_row["line_count"] += 1

    for entry in month_stockist_entries:
        stockist = entry.stockist
        region_name = stockist.region if stockist else "Unassigned"
        territory_name = stockist.territory if stockist else "Unassigned"
        stockist_row = stockist_rows.setdefault(entry.stockist_id, {
            "stockist_id": entry.stockist_id,
            "stockist_name": stockist.name if stockist else "Unknown",
            "region": region_name,
            "territory": territory_name,
            "sales_amount": 0.0,
            "quantity": 0.0,
            "line_count": 0,
            "bills": set(),
        })
        stockist_row["sales_amount"] += entry.gross_amount or 0
        stockist_row["quantity"] += entry.quantity or 0
        stockist_row["line_count"] += 1
        stockist_row["bills"].add(entry.bill_number)

    by_stockist = []
    for item in stockist_rows.values():
        by_stockist.append({
            **{key: value for key, value in item.items() if key != "bills"},
            "bill_count": len(item["bills"]),
            "sales_amount": round(item["sales_amount"], 2),
            "net_amount": round(item["sales_amount"], 2),
            "quantity": round(item["quantity"], 2),
        })
    by_stockist.sort(key=lambda item: (-item["sales_amount"], item["stockist_name"]))
    by_product = [{
        **item,
        "sales_amount": round(item["sales_amount"], 2),
        "net_amount": round(item["sales_amount"], 2),
        "quantity": round(item["quantity"], 2),
    } for item in product_rows.values()]
    by_product.sort(key=lambda item: (-item["sales_amount"], item["product_name"]))

    stockists = db.query(Stockist).filter(Stockist.is_active == True).order_by(Stockist.name).all()
    recent_uploads = db.query(PrimarySalesUpload).options(joinedload(PrimarySalesUpload.uploaded_by)).order_by(
        PrimarySalesUpload.uploaded_at.desc()
    ).limit(10).all()
    return {
        "period": {"year": year, "month": month, "week": week, "start_date": period_start, "end_date": period_end},
        "filters": {"region": region or "ALL", "territory": territory or "ALL", "stockist_id": stockist_id},
        "total_sales_amount": round(total_sales, 2),
        "total_net_amount": round(total_sales, 2),
        "total_quantity": round(total_quantity, 2),
        "bill_count": len(bills),
        "line_count": len(entries),
        "stockist_count": len(selected_stockists),
        "by_region": [
            {"region": name, "sales_amount": round(amount, 2), "net_amount": round(amount, 2)}
            for name, amount in sorted(region_totals.items(), key=lambda item: -item[1])
        ],
        "by_territory": [
            {"region": key[0], "territory": key[1], "sales_amount": round(amount, 2), "net_amount": round(amount, 2)}
            for key, amount in sorted(territory_totals.items(), key=lambda item: -item[1])
        ],
        "by_stockist": by_stockist,
        "by_stockist_period": {"year": year, "month": month},
        "by_product": by_product,
        "options": {
            "regions": sorted({row.region for row in stockists}),
            "territories": sorted({row.territory for row in stockists}),
            "stockists": [{"id": row.id, "name": row.name, "region": row.region, "territory": row.territory} for row in stockists],
        },
        "unassigned_stockists": [
            {"id": row.id, "name": row.name, "region": row.region, "territory": row.territory}
            for row in stockists
            if row.region == "Unassigned" or row.territory == "Unassigned"
        ],
        "recent_uploads": [_upload_payload(upload) for upload in recent_uploads],
    }


@router.get("/city-split/summary")
@transport_router.get("/city-split/summary")
def primary_city_split_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    week: Optional[int] = None,
    city: Optional[str] = None,
    territory: Optional[str] = None,
    db: Session = Depends(get_db),
):
    year = year or datetime.utcnow().year
    month = month or datetime.utcnow().month
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")

    period_start = None
    period_end = None
    if week is not None:
        try:
            period_start, period_end = primary_sales_week_bounds(year, month, week)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    def apply_period(base_query, date_column):
        if period_start and period_end:
            return base_query.filter(date_column >= period_start, date_column <= period_end)
        return base_query.filter(date_column.like(f"{year:04d}-{month:02d}-%"))

    query = apply_period(db.query(PrimaryCitySplitEntry), PrimaryCitySplitEntry.bill_date)
    if city and city != "ALL":
        query = query.filter(PrimaryCitySplitEntry.source_city == city)
    if territory and territory != "ALL":
        query = query.filter(PrimaryCitySplitEntry.territory == territory)
    entries = query.order_by(PrimaryCitySplitEntry.bill_date.desc(), PrimaryCitySplitEntry.id.desc()).all()

    fortel_period_query = apply_period(db.query(PrimarySalesEntry), PrimarySalesEntry.bill_date)
    nexus_primary_period_query = apply_period(
        db.query(PrimarySalesEntry).join(Stockist).filter(Stockist.normalized_name == "NEXUS BIOCARE"),
        PrimarySalesEntry.bill_date,
    )
    nexus_city_period_query = apply_period(db.query(PrimaryCitySplitEntry), PrimaryCitySplitEntry.bill_date)
    fortel_total = float(fortel_period_query.with_entities(func.sum(PrimarySalesEntry.gross_amount)).scalar() or 0)
    nexus_primary_total = float(nexus_primary_period_query.with_entities(func.sum(PrimarySalesEntry.gross_amount)).scalar() or 0)
    nexus_city_total = float(nexus_city_period_query.with_entities(func.sum(PrimaryCitySplitEntry.gross_amount)).scalar() or 0)
    fortel_row_count = fortel_period_query.count()
    nexus_city_row_count = nexus_city_period_query.count()

    city_rows = {}
    territory_rows = {}
    customer_rows = {}
    product_rows = {}
    bills = set()
    total_gross = 0.0
    total_quantity = 0.0
    returns_amount = 0.0
    returns_count = 0
    for entry in entries:
        amount = entry.gross_amount or 0
        quantity = entry.quantity or 0
        total_gross += amount
        total_quantity += quantity
        bills.add((entry.customer_name, entry.bill_number))
        if amount < 0 or (entry.sale_type or "").strip().lower() == "return":
            returns_amount += amount
            returns_count += 1

        city_row = city_rows.setdefault(entry.source_city, {
            "city": entry.source_city, "territory": entry.territory,
            "sales_amount": 0.0, "quantity": 0.0, "line_count": 0, "customers": set(),
        })
        city_row["sales_amount"] += amount
        city_row["quantity"] += quantity
        city_row["line_count"] += 1
        city_row["customers"].add(entry.customer_name)

        territory_row = territory_rows.setdefault(entry.territory, {
            "region": "Tamil Nadu", "territory": entry.territory,
            "sales_amount": 0.0, "quantity": 0.0, "line_count": 0,
        })
        territory_row["sales_amount"] += amount
        territory_row["quantity"] += quantity
        territory_row["line_count"] += 1

        customer_key = entry.customer_name.strip().upper()
        customer_row = customer_rows.setdefault(customer_key, {
            "customer_name": entry.customer_name, "city": entry.source_city,
            "territory": entry.territory, "sales_amount": 0.0, "quantity": 0.0,
            "line_count": 0, "bills": set(),
        })
        customer_row["sales_amount"] += amount
        customer_row["quantity"] += quantity
        customer_row["line_count"] += 1
        customer_row["bills"].add(entry.bill_number)

        product_key = entry.product_name.strip().upper()
        product_row = product_rows.setdefault(product_key, {
            "product_name": entry.product_name, "sales_amount": 0.0,
            "quantity": 0.0, "line_count": 0,
        })
        product_row["sales_amount"] += amount
        product_row["quantity"] += quantity
        product_row["line_count"] += 1

    def rounded_rows(items, set_field=None, count_field=None):
        result = []
        for item in items:
            row = dict(item)
            if set_field:
                values = row.pop(set_field)
                row[count_field] = len(values)
            for field in ("sales_amount", "quantity"):
                if field in row:
                    row[field] = round(row[field], 2)
            result.append(row)
        return sorted(result, key=lambda row: (-row["sales_amount"], row.get("city") or row.get("territory") or row.get("customer_name") or row.get("product_name")))

    all_options = db.query(PrimaryCitySplitEntry.source_city, PrimaryCitySplitEntry.territory).distinct().all()
    recent_uploads = db.query(PrimaryCitySplitUpload).options(joinedload(PrimaryCitySplitUpload.uploaded_by)).order_by(
        PrimaryCitySplitUpload.uploaded_at.desc()
    ).limit(10).all()
    return {
        "period": {"year": year, "month": month, "week": week, "start_date": period_start, "end_date": period_end},
        "source": "NEXUS BIOCARE",
        "region": "Tamil Nadu",
        "accounting_note": "Separate city split only; not added to the company Primary Sales total.",
        "reconciliation": primary_sales_reconciliation(
            fortel_total,
            nexus_primary_total,
            nexus_city_total,
            fortel_row_count > 0 and nexus_city_row_count > 0,
        ),
        "total_sales_amount": round(total_gross, 2),
        "total_quantity": round(total_quantity, 2),
        "bill_count": len(bills),
        "line_count": len(entries),
        "return_amount": round(returns_amount, 2),
        "return_line_count": returns_count,
        "by_city": rounded_rows(city_rows.values(), "customers", "customer_count"),
        "by_territory": rounded_rows(territory_rows.values()),
        "by_customer": rounded_rows(customer_rows.values(), "bills", "bill_count"),
        "by_product": rounded_rows(product_rows.values()),
        "options": {
            "cities": sorted({row.source_city for row in all_options}),
            "territories": sorted({row.territory for row in all_options}),
        },
        "recent_uploads": [_city_split_upload_payload(upload) for upload in recent_uploads],
    }
