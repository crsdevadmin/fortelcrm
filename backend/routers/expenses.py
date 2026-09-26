from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import ExpenseLine, User
from ..services.expense_bill_validation import validate_expense_bill


router = APIRouter(prefix="/expenses", tags=["Expenses"])

ALLOWED_TYPES = {"employee", "company"}
ALLOWED_BILL_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_BILL_BYTES = 10 * 1024 * 1024
MANAGER_ROLES = {"admin", "md", "director", "senior_manager", "manager"}


class BillReviewRequest(BaseModel):
    decision: str
    notes: Optional[str] = None


def _clean(value: Optional[str]) -> Optional[str]:
    cleaned = " ".join((value or "").split())
    return cleaned or None


def _parse_date(value: str):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Expense date must be YYYY-MM-DD")


def _expense_dict(row: ExpenseLine):
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_name": row.employee.name if row.employee else "",
        "expense_type": row.expense_type,
        "expense_date": row.expense_date,
        "year": row.year,
        "month": row.month,
        "category": row.category,
        "description": row.description,
        "location": row.location,
        "travel_from": row.travel_from,
        "travel_to": row.travel_to,
        "distance_km": row.distance_km,
        "travel_mode": row.travel_mode,
        "amount": round(float(row.amount or 0), 2),
        "remarks": row.remarks,
        "status": row.status,
        "bill_filename": row.bill_filename,
        "bill_validation_status": row.bill_validation_status,
        "bill_validation_reason": row.bill_validation_reason,
        "bill_detected_amount": row.bill_detected_amount,
        "bill_review_notes": row.bill_review_notes,
        "bill_reviewed_by_name": row.bill_reviewed_by.name if row.bill_reviewed_by else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/")
def list_expenses(
    year: int,
    month: int,
    expense_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Month must be between 1 and 12")
    if expense_type and expense_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid expense type")
    query = db.query(ExpenseLine).filter(
        ExpenseLine.employee_id == current_user.id,
        ExpenseLine.year == year,
        ExpenseLine.month == month,
    )
    if expense_type:
        query = query.filter(ExpenseLine.expense_type == expense_type)
    rows = query.order_by(ExpenseLine.expense_date.desc(), ExpenseLine.id.desc()).all()
    totals = {"employee": 0.0, "company": 0.0}
    for row in rows:
        totals[row.expense_type] = totals.get(row.expense_type, 0.0) + float(row.amount or 0)
    return {
        "year": year,
        "month": month,
        "rows": [_expense_dict(row) for row in rows],
        "totals": {key: round(value, 2) for key, value in totals.items()},
        "grand_total": round(sum(totals.values()), 2),
    }


@router.post("/")
async def create_expense(
    expense_type: str = Form(...),
    expense_date: str = Form(...),
    category: str = Form(...),
    description: str = Form(...),
    amount: float = Form(...),
    location: Optional[str] = Form(None),
    travel_from: Optional[str] = Form(None),
    travel_to: Optional[str] = Form(None),
    distance_km: Optional[float] = Form(None),
    travel_mode: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    bill: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    normalized_type = (expense_type or "").strip().lower()
    if normalized_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Choose Employee Expense or Company Expense")
    clean_category = _clean(category)
    clean_description = _clean(description)
    if not clean_category or not clean_description:
        raise HTTPException(status_code=400, detail="Category and description are required")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    if distance_km is not None and distance_km < 0:
        raise HTTPException(status_code=400, detail="Distance cannot be negative")

    content_type = (bill.content_type or "").lower()
    if content_type not in ALLOWED_BILL_TYPES:
        raise HTTPException(status_code=400, detail="Bill must be a PDF, JPG, PNG, or WebP file")
    bill_data = await bill.read(MAX_BILL_BYTES + 1)
    if not bill_data:
        raise HTTPException(status_code=400, detail="The bill file is empty")
    if len(bill_data) > MAX_BILL_BYTES:
        raise HTTPException(status_code=413, detail="Bill file must be 10 MB or smaller")

    parsed_date = _parse_date(expense_date)
    bill_validation = validate_expense_bill(bill_data, content_type, amount)
    row = ExpenseLine(
        employee_id=current_user.id,
        expense_type=normalized_type,
        expense_date=parsed_date.isoformat(),
        year=parsed_date.year,
        month=parsed_date.month,
        category=clean_category,
        description=clean_description,
        location=_clean(location),
        travel_from=_clean(travel_from),
        travel_to=_clean(travel_to),
        distance_km=distance_km,
        travel_mode=_clean(travel_mode),
        amount=round(float(amount), 2),
        remarks=_clean(remarks),
        status="saved",
        bill_filename=_clean(bill.filename) or "bill",
        bill_content_type=content_type,
        bill_data=bill_data,
        bill_validation_status=bill_validation["status"],
        bill_validation_reason=bill_validation["reason"],
        bill_detected_amount=bill_validation["detected_amount"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "status": "created",
        "expense": _expense_dict(row),
        "bill_validation": bill_validation,
    }


def _own_expense(expense_id: int, current_user: User, db: Session) -> ExpenseLine:
    row = db.query(ExpenseLine).filter(
        ExpenseLine.id == expense_id,
        ExpenseLine.employee_id == current_user.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    return row


def _accessible_expense(expense_id: int, current_user: User, db: Session) -> ExpenseLine:
    row = db.query(ExpenseLine).filter(ExpenseLine.id == expense_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    is_owner = row.employee_id == current_user.id
    is_reporting_manager = row.employee and row.employee.reports_to_id == current_user.id
    is_company_reviewer = current_user.role in {"admin", "md"}
    if not (is_owner or is_reporting_manager or is_company_reviewer):
        raise HTTPException(status_code=403, detail="You cannot access this bill")
    return row


@router.get("/manager/review-queue")
def manager_review_queue(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in MANAGER_ROLES:
        return {"can_review": False, "rows": []}
    query = db.query(ExpenseLine).join(User, ExpenseLine.employee_id == User.id).filter(
        ExpenseLine.bill_validation_status == "review_required",
    )
    if current_user.role not in {"admin", "md"}:
        query = query.filter(User.reports_to_id == current_user.id)
    rows = query.order_by(ExpenseLine.created_at.desc()).all()
    return {"can_review": True, "rows": [_expense_dict(row) for row in rows]}


@router.patch("/{expense_id}/bill-review")
def review_bill(
    expense_id: int,
    payload: BillReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Only a reporting manager can validate a bill")
    row = db.query(ExpenseLine).filter(ExpenseLine.id == expense_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    may_review = current_user.role in {"admin", "md"} or (
        row.employee and row.employee.reports_to_id == current_user.id
    )
    if not may_review:
        raise HTTPException(status_code=403, detail="Only this employee's reporting manager can validate the bill")
    decision = (payload.decision or "").strip().lower()
    if decision not in {"valid", "invalid"}:
        raise HTTPException(status_code=400, detail="Decision must be valid or invalid")
    row.bill_validation_status = "manager_validated" if decision == "valid" else "manager_rejected"
    row.bill_validation_reason = (
        "The reporting manager validated this bill."
        if decision == "valid"
        else "The reporting manager marked this bill as invalid."
    )
    row.bill_reviewed_by_id = current_user.id
    row.bill_reviewed_at = datetime.utcnow()
    row.bill_review_notes = _clean(payload.notes)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {"status": row.bill_validation_status, "expense": _expense_dict(row)}


@router.get("/{expense_id}/bill")
def download_bill(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _accessible_expense(expense_id, current_user, db)
    safe_name = row.bill_filename.replace('"', "")
    return Response(
        content=row.bill_data,
        media_type=row.bill_content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _own_expense(expense_id, current_user, db)
    db.delete(row)
    db.commit()
    return {"status": "deleted", "expense_id": expense_id}
