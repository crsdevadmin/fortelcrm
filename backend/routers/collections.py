import hashlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import CollectionUpload, OutstandingEntry, ReceiptEntry, User
from ..services.collections_import import parse_collection_report


router = APIRouter(prefix="/collections", tags=["Receipts and outstanding"])
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def _require_staff(user):
    if user.role not in {"back_office", "md"}:
        raise HTTPException(status_code=403, detail="Only back-office staff or the MD can upload these reports")


def _require_md(user):
    if user.role != "md":
        raise HTTPException(status_code=403, detail="This collections information is visible only to the MD")


def _upload_dict(upload):
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
    }


@router.post("/upload")
async def upload_report(
    report_type: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_staff(current_user)
    report_type = report_type.strip().lower()
    if report_type not in {"receipt", "outstanding"}:
        raise HTTPException(status_code=400, detail="Report type must be receipt or outstanding")
    filename = Path(file.filename or "report").name
    if Path(filename).suffix.lower() not in {".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Upload an Excel .xls or .xlsx file")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The file exceeds the 15 MB limit")

    checksum = hashlib.sha256(content).hexdigest()
    duplicate = db.query(CollectionUpload).filter(
        CollectionUpload.report_type == report_type,
        CollectionUpload.file_checksum == checksum,
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


@router.get("/uploads")
def list_uploads(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_staff(current_user)
    uploads = db.query(CollectionUpload).order_by(CollectionUpload.uploaded_at.desc()).limit(30).all()
    return [_upload_dict(upload) for upload in uploads]


@router.get("/md-summary")
def md_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_md(current_user)
    latest = {}
    for report_type in ("receipt", "outstanding"):
        latest[report_type] = db.query(CollectionUpload).filter(
            CollectionUpload.report_type == report_type
        ).order_by(CollectionUpload.uploaded_at.desc()).first()

    receipt_upload = latest["receipt"]
    outstanding_upload = latest["outstanding"]
    receipts = [] if not receipt_upload else db.query(ReceiptEntry).filter(
        ReceiptEntry.upload_id == receipt_upload.id
    ).order_by(ReceiptEntry.receipt_date.desc(), ReceiptEntry.id.desc()).all()
    outstanding = [] if not outstanding_upload else db.query(OutstandingEntry).filter(
        OutstandingEntry.upload_id == outstanding_upload.id
    ).order_by(OutstandingEntry.balance.desc()).all()
    history = db.query(CollectionUpload).order_by(CollectionUpload.uploaded_at.desc()).limit(10).all()

    return {
        "receipt_upload": _upload_dict(receipt_upload) if receipt_upload else None,
        "outstanding_upload": _upload_dict(outstanding_upload) if outstanding_upload else None,
        "receipts": [{
            "id": row.id,
            "receipt_date": row.receipt_date,
            "receipt_no": row.receipt_no,
            "mode": row.mode,
            "customer_name": row.customer_name,
            "customer_code": row.customer_code,
            "salesman_name": row.salesman_name,
            "amount": row.amount,
        } for row in receipts],
        "outstanding": [{
            "id": row.id,
            "customer_code": row.customer_code,
            "customer_name": row.customer_name,
            "area_name": row.area_name,
            "city_name": row.city_name,
            "balance": row.balance,
        } for row in outstanding],
        "recent_uploads": [_upload_dict(upload) for upload in history],
    }
