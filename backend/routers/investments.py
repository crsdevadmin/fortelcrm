# backend/routers/investments.py
import boto3
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..models.models import Investment, InvestmentCategory, InvestmentSubCategory, Doctor, User
from ..core.config import settings

router = APIRouter(prefix="/investments", tags=["Investments"])


COMMERCIAL_MODEL_LABELS = {
    "U1": "Upfront Investment Account",
    "U2": "Strategic Upfront Account",
    "P1": "Performance-Linked Account",
    "P2": "Growth Incentive Account",
    "N1": "Natural Prescriber",
    "D1": "Development Account",
    "R1": "At-Risk Account",
}

COMMERCIAL_MODEL_DESC = {
    "U1": "Investment made first, expected business multiple later",
    "U2": "High-value account with long-term growth potential",
    "P1": "Support linked to actual sales generated",
    "P2": "Support increases as business increases",
    "N1": "Prescribes without significant investment",
    "D1": "New doctor under evaluation",
    "R1": "Declining business or high competitor threat",
}

CATEGORY_LABELS = {
    "PD": "Professional Development",
    "RD": "Research & Development",
    "CS": "Commercial Support",
}


@router.get("/my")
def get_my_investments(
    associate_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment).filter(Investment.associate_id == associate_id)
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    q = q.order_by(Investment.year.desc(), Investment.month.desc(), Investment.week.desc())
    invs = q.all()

    result = []
    for i in invs:
        doc = db.query(Doctor).filter(Doctor.id == i.doctor_id).first()
        cmt = i.commercial_model_type or (doc.commercial_model if doc else None)
        result.append({
            "id":                    i.id,
            "doctor_id":             i.doctor_id,
            "doctor_name":           doc.name if doc else "Unknown",
            "doctor_commercial_model": doc.commercial_model if doc else None,
            "commercial_model_type": cmt,
            "commercial_model_label":COMMERCIAL_MODEL_LABELS.get(cmt or "", ""),
            "expected_multiple":     i.expected_multiple,
            "year":                  i.year,
            "month":                 i.month,
            "week":                  i.week,
            "category":              i.category.value if i.category else None,
            "sub_category":          i.sub_category.value if i.sub_category else None,
            "amount":                i.amount,
            "expected_sales":        i.expected_sales,
            "purpose":               i.purpose,
            "bill_url":              i.bill_url,
            "is_approved":           i.is_approved,
            "submitted_at":          i.submitted_at.isoformat() if i.submitted_at else None,
        })
    return result


@router.get("/summary/my")
def get_my_investment_summary(
    associate_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Investment).filter(Investment.associate_id == associate_id)
    if year:  q = q.filter(Investment.year  == year)
    if month: q = q.filter(Investment.month == month)
    invs = q.all()
    total      = sum(i.amount for i in invs)
    approved   = sum(i.amount for i in invs if i.is_approved)
    pending    = sum(i.amount for i in invs if not i.is_approved)
    exp_sales  = sum(i.expected_sales or 0 for i in invs)
    return {
        "total": round(total, 2),
        "approved": round(approved, 2),
        "pending": round(pending, 2),
        "expected_sales": round(exp_sales, 2),
        "count": len(invs),
    }


def upload_to_s3(file: UploadFile, doctor_id: int) -> str:
    s3 = boto3.client("s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
    )
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    key = f"bills/doctor_{doctor_id}/{timestamp}_{file.filename}"
    s3.upload_fileobj(file.file, settings.AWS_S3_BUCKET, key)
    return f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"


COMMERCIAL_MODEL_TO_CATEGORY = {
    "U1": "PD", "U2": "PD",   # Upfront → Professional Development
    "P1": "PD", "P2": "PD",   # Performance → Professional Development
    "N1": "CS",                # Natural Prescriber → Commercial Support
    "D1": "RD",                # Development → Relationship Development
    "R1": "RD",                # At-Risk → Relationship Development
}

@router.post("/submit")
async def submit_investment(
    doctor_id: int = Form(...),
    associate_id: int = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week: int = Form(...),
    commercial_model_type: Optional[str] = Form(None),
    category: Optional[InvestmentCategory] = Form(None),
    sub_category: Optional[InvestmentSubCategory] = Form(None),
    amount: float = Form(...),
    expected_multiple: float = Form(5.0),
    purpose: Optional[str] = Form(None),
    bill: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    bill_url = None
    if bill and bill.filename:
        try:
            bill_url = upload_to_s3(bill, doctor_id)
        except Exception:
            pass  # S3 optional — proceed without bill

    # Auto-derive legacy category from commercial model type if not supplied
    if category is None and commercial_model_type:
        cat_str = COMMERCIAL_MODEL_TO_CATEGORY.get(commercial_model_type, "PD")
        try:
            category = InvestmentCategory(cat_str)
        except Exception:
            category = InvestmentCategory.PD
    if category is None:
        category = InvestmentCategory.PD

    expected_sales = amount * expected_multiple
    needs_approval = amount > 25000

    inv = Investment(
        doctor_id=doctor_id, associate_id=associate_id,
        year=year, month=month, week=week,
        commercial_model_type=commercial_model_type,
        category=category, sub_category=sub_category,
        amount=amount, expected_multiple=expected_multiple,
        expected_sales=expected_sales, purpose=purpose,
        bill_url=bill_url, is_approved=not needs_approval,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return {
        "id": inv.id,
        "status": "pending_approval" if needs_approval else "approved",
        "expected_sales": expected_sales,
        "bill_url": bill_url,
    }


@router.get("/doctor/{doctor_id}")
def get_doctor_investments(doctor_id: int, db: Session = Depends(get_db)):
    invs = db.query(Investment).filter(Investment.doctor_id == doctor_id)\
              .order_by(Investment.year.desc(), Investment.month.desc()).all()
    return [{
        "id": i.id, "year": i.year, "month": i.month, "week": i.week,
        "category": i.category.value,
        "sub_category": i.sub_category.value if i.sub_category else None,
        "amount": i.amount, "expected_sales": i.expected_sales,
        "purpose": i.purpose, "bill_url": i.bill_url, "is_approved": i.is_approved,
    } for i in invs]


@router.get("/doctor/{doctor_id}/total")
def get_total_investment(doctor_id: int, db: Session = Depends(get_db)):
    total = db.query(func.sum(Investment.amount)).filter(
        Investment.doctor_id == doctor_id, Investment.is_approved == True,
    ).scalar() or 0.0
    return {"doctor_id": doctor_id, "total_invested": round(total, 2)}


@router.get("/summary/by-category")
def get_investment_by_category(year: int, month: int, db: Session = Depends(get_db)):
    rows = db.query(
        Investment.category,
        func.sum(Investment.amount).label("total"),
        func.count(Investment.id).label("count"),
    ).filter(Investment.year == year, Investment.month == month)\
     .group_by(Investment.category).all()
    return [{"category": r.category.value, "total_amount": round(r.total, 2), "count": r.count} for r in rows]


@router.get("/pending-approvals")
def get_pending_investments(db: Session = Depends(get_db)):
    invs = db.query(Investment).filter(Investment.is_approved == False).all()
    return [{
        "id": i.id, "doctor_id": i.doctor_id, "amount": i.amount,
        "category": i.category.value, "purpose": i.purpose,
        "submitted_at": i.submitted_at, "bill_url": i.bill_url,
    } for i in invs]


@router.post("/{investment_id}/approve")
def approve_investment(investment_id: int, approver_id: int, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == investment_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")
    inv.is_approved = True
    inv.approved_by_id = approver_id
    inv.approved_at = datetime.utcnow()
    db.commit()
    return {"status": "approved"}
