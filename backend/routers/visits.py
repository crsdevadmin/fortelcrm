"""
Visit Log router — field check-ins with GPS location tagging.
"""
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import VisitLog, User, Doctor, UserRole

router = APIRouter(prefix="/visits", tags=["visits"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class VisitCreate(BaseModel):
    associate_id: int
    doctor_id:    Optional[int]   = None
    latitude:     Optional[float] = None
    longitude:    Optional[float] = None
    address:      Optional[str]   = None
    visit_time:   Optional[datetime] = None
    purpose:      Optional[str]   = None
    notes:        Optional[str]   = None


class VisitOut(BaseModel):
    id:           int
    associate_id: int
    associate_name: Optional[str]
    doctor_id:    Optional[int]
    doctor_name:  Optional[str]
    doctor_specialty: Optional[str]
    latitude:     Optional[float]
    longitude:    Optional[float]
    address:      Optional[str]
    visit_time:   datetime
    purpose:      Optional[str]
    notes:        Optional[str]
    created_at:   datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _subordinate_ids(db: Session, user_id: int) -> set:
    """Return all user IDs that report (directly or indirectly) to user_id."""
    result = {user_id}
    queue  = [user_id]
    while queue:
        current = queue.pop()
        subs = db.query(User.id).filter(User.reports_to_id == current).all()
        for (sid,) in subs:
            if sid not in result:
                result.add(sid)
                queue.append(sid)
    return result


def _serialize(v: VisitLog) -> dict:
    return {
        "id":               v.id,
        "associate_id":     v.associate_id,
        "associate_name":   v.associate.name if v.associate else None,
        "doctor_id":        v.doctor_id,
        "doctor_name":      v.doctor.name if v.doctor else None,
        "doctor_specialty": v.doctor.specialty if v.doctor else None,
        "latitude":         v.latitude,
        "longitude":        v.longitude,
        "address":          v.address,
        "visit_time":       v.visit_time,
        "purpose":          v.purpose,
        "notes":            v.notes,
        "created_at":       v.created_at,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=VisitOut)
def create_visit(body: VisitCreate, db: Session = Depends(get_db)):
    visit = VisitLog(
        associate_id = body.associate_id,
        doctor_id    = body.doctor_id,
        latitude     = body.latitude,
        longitude    = body.longitude,
        address      = body.address,
        visit_time   = body.visit_time or datetime.utcnow(),
        purpose      = body.purpose,
        notes        = body.notes,
        created_at   = datetime.utcnow(),
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return _serialize(visit)


@router.get("/", response_model=List[VisitOut])
def list_visits(
    viewer_id:    int            = Query(...),
    doctor_id:    Optional[int]  = Query(None),
    associate_id: Optional[int]  = Query(None),
    date_from:    Optional[str]  = Query(None),
    date_to:      Optional[str]  = Query(None),
    limit:        int            = Query(100),
    db: Session = Depends(get_db),
):
    viewer = db.query(User).filter(User.id == viewer_id).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="Viewer not found")

    q = db.query(VisitLog)

    # Role-scoped: reps see only their own; managers/MD see team
    if viewer.role in ("rep", "custom"):
        q = q.filter(VisitLog.associate_id == viewer_id)
    else:
        visible_ids = _subordinate_ids(db, viewer_id)
        q = q.filter(VisitLog.associate_id.in_(visible_ids))

    if doctor_id:
        q = q.filter(VisitLog.doctor_id == doctor_id)
    if associate_id:
        q = q.filter(VisitLog.associate_id == associate_id)
    if date_from:
        q = q.filter(VisitLog.visit_time >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(VisitLog.visit_time <= datetime.fromisoformat(date_to + "T23:59:59"))

    visits = q.order_by(VisitLog.visit_time.desc()).limit(limit).all()
    return [_serialize(v) for v in visits]


@router.delete("/{visit_id}")
def delete_visit(visit_id: int, viewer_id: int = Query(...), db: Session = Depends(get_db)):
    visit = db.query(VisitLog).filter(VisitLog.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    viewer = db.query(User).filter(User.id == viewer_id).first()
    if not viewer:
        raise HTTPException(status_code=403, detail="Forbidden")
    # Only the rep themselves or a manager can delete
    if viewer.role in ("rep", "custom") and visit.associate_id != viewer_id:
        raise HTTPException(status_code=403, detail="Not your visit")
    db.delete(visit)
    db.commit()
    return {"ok": True}
