# backend/routers/doctors.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from ..database import get_db
from ..models.models import Doctor, RepDoctorMapping, User
from ..utils.hierarchy import get_subtree_ids

router = APIRouter(prefix="/doctors", tags=["Doctors"])


def doc_to_dict(d: Doctor) -> dict:
    return {
        "id": d.id,
        "customer_type": d.customer_type or "doctor",
        "client_id": d.client_id,
        "client_code": d.client_code,
        "registration_number": d.registration_number,
        "name": d.name,
        "phone": d.phone,
        "email": d.email,
        "gender": d.gender,
        "dob": d.dob,
        "anniversary": d.anniversary,
        "hospital": d.hospital,
        "firm_name": d.firm_name,
        "qualification": d.qualification,
        "specialty": d.specialty,
        "division": d.division,
        "prescriber_type": d.prescriber_type,
        "category": d.category,
        "approx_business": d.approx_business,
        "city": d.city,
        "state_code": d.state_code,
        "zone": d.zone,
        "pincode": d.pincode,
        "country": d.country,
        "full_address": d.full_address,
        "address2": d.address2,
        "address3": d.address3,
        "latitude": d.latitude,
        "longitude": d.longitude,
        "commercial_model": d.commercial_model or None,
        "expected_multiple": d.expected_multiple,
        "roi_grade": d.roi_grade or None,
        "add_date": d.add_date,
        "status": d.status,
        "is_active": d.is_active,
        "manager_id": d.manager_id,
        "manager_name": d.manager.name if d.manager else None,
        "reps": [
            {"id": m.associate_id, "name": m.associate.name if m.associate else None}
            for m in d.rep_mappings if m.is_active and m.associate_id
        ],
    }


class DoctorPayload(BaseModel):
    customer_type: Optional[str] = "doctor"
    client_id: Optional[str] = None
    client_code: Optional[str] = None
    registration_number: Optional[str] = None
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[str] = None
    anniversary: Optional[str] = None
    hospital: Optional[str] = None
    firm_name: Optional[str] = None
    qualification: Optional[str] = None
    specialty: Optional[str] = None
    division: Optional[str] = None
    prescriber_type: Optional[str] = None
    category: Optional[str] = None
    approx_business: Optional[str] = None
    city: Optional[str] = None
    state_code: Optional[str] = None
    zone: Optional[str] = None
    pincode: Optional[str] = None
    country: Optional[str] = "INDIA"
    full_address: Optional[str] = None
    address2: Optional[str] = None
    address3: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    commercial_model: Optional[str] = None
    expected_multiple: float = 5.0
    add_date: Optional[str] = None
    status: Optional[str] = "Active"
    manager_id: Optional[int] = None


class AssignDoctorRequest(BaseModel):
    doctor_id: int
    manager_id: Optional[int] = None
    associate_id: Optional[int] = None
    assigned_by_id: Optional[int] = 1


# ── List ──────────────────────────────────────
@router.get("/")
def list_doctors(
    state_code: Optional[str] = None,
    viewer_id: Optional[int] = None,
    manager_id: Optional[int] = None,
    associate_id: Optional[int] = None,
    customer_type: Optional[str] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(Doctor)
    if not include_inactive:
        q = q.filter(Doctor.is_active != False)  # treat NULL as active

    # Role-scoped: filter to viewer's subtree of managers
    if viewer_id and not manager_id:
        subtree = get_subtree_ids(viewer_id, db)
        if subtree is not None:           # None = admin/md, sees all
            mapped_doctors = db.query(RepDoctorMapping.doctor_id).filter(
                RepDoctorMapping.associate_id.in_(subtree),
                RepDoctorMapping.is_active == True,
            )
            q = q.filter(or_(Doctor.manager_id.in_(subtree), Doctor.id.in_(mapped_doctors)))

    if state_code:     q = q.filter(Doctor.state_code.ilike(state_code))
    if manager_id:     q = q.filter(Doctor.manager_id == manager_id)
    if customer_type:  q = q.filter(Doctor.customer_type == customer_type)
    if search:
        like = f"%{search}%"
        q = q.filter(
            Doctor.name.ilike(like) |
            Doctor.hospital.ilike(like) |
            Doctor.city.ilike(like) |
            Doctor.client_code.ilike(like)
        )
    if associate_id:
        sub = db.query(RepDoctorMapping.doctor_id).filter(
            RepDoctorMapping.associate_id == associate_id,
            RepDoctorMapping.is_active == True,
        )
        q = q.filter(Doctor.id.in_(sub))
    return [doc_to_dict(d) for d in q.order_by(Doctor.name).all()]


# ── Distinct states & cities for filters ──────
@router.get("/filters/states")
def get_states(manager_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Doctor.state_code).filter(Doctor.is_active != False, Doctor.state_code.isnot(None))
    if manager_id:
        q = q.filter(Doctor.manager_id == manager_id)
    rows = q.distinct().all()
    return sorted([r[0] for r in rows if r[0]])

@router.get("/filters/cities")
def get_cities(state_code: Optional[str] = None, manager_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Doctor.city).filter(Doctor.is_active != False, Doctor.city.isnot(None))
    if state_code:
        q = q.filter(Doctor.state_code.ilike(state_code))
    if manager_id:
        q = q.filter(Doctor.manager_id == manager_id)
    rows = q.distinct().all()
    return sorted([r[0] for r in rows if r[0]])


# ── Create ────────────────────────────────────
@router.post("/create")
def create_doctor(payload: DoctorPayload, db: Session = Depends(get_db)):
    doctor = Doctor(**{k: v for k, v in payload.dict().items() if k != 'manager_id'})
    doctor.manager_id = payload.manager_id
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    return {"id": doctor.id, "name": doctor.name, "status": "created"}


# ── Update ────────────────────────────────────
@router.patch("/{doctor_id}")
def update_doctor(doctor_id: int, payload: DoctorPayload, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(doctor, field, value)
    db.commit()
    return {"status": "updated"}


# ── Toggle Active / Inactive ──────────────────
@router.patch("/{doctor_id}/toggle-status")
def toggle_status(doctor_id: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    doctor.is_active = not doctor.is_active
    doctor.status = "Active" if doctor.is_active else "Inactive"
    db.commit()
    return {"status": "ok", "is_active": doctor.is_active}


# ── Hard Delete ───────────────────────────────
@router.delete("/{doctor_id}")
def delete_doctor(doctor_id: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    db.delete(doctor)
    db.commit()
    return {"status": "deleted"}


# ── Assign Doctor → Manager + Rep ────────────
@router.post("/assign")
def assign_doctor(payload: AssignDoctorRequest, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == payload.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    if payload.manager_id:
        doctor.manager_id = payload.manager_id

    if payload.associate_id:
        existing = db.query(RepDoctorMapping).filter(
            RepDoctorMapping.doctor_id == payload.doctor_id,
            RepDoctorMapping.associate_id == payload.associate_id,
            RepDoctorMapping.is_active == True,
        ).first()
        if not existing:
            db.add(RepDoctorMapping(
                doctor_id=payload.doctor_id,
                manager_id=payload.manager_id,
                associate_id=payload.associate_id,
                assigned_by_id=payload.assigned_by_id,
                is_active=True,
            ))

    db.commit()
    return {"status": "assigned"}


# ── Remove Rep from Doctor ────────────────────
@router.delete("/{doctor_id}/remove-rep/{rep_id}")
def remove_rep(doctor_id: int, rep_id: int, db: Session = Depends(get_db)):
    mapping = db.query(RepDoctorMapping).filter(
        RepDoctorMapping.doctor_id == doctor_id,
        RepDoctorMapping.associate_id == rep_id,
        RepDoctorMapping.is_active == True,
    ).first()
    if mapping:
        mapping.is_active = False
        db.commit()
    return {"status": "removed"}
