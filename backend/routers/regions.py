# backend/routers/regions.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel

from ..database import get_db
from ..models.models import Region, User

router = APIRouter(prefix="/regions", tags=["Regions"])

INDIAN_STATES = [
    {"code": "TN", "name": "Tamil Nadu"}, {"code": "AP", "name": "Andhra Pradesh"},
    {"code": "TS", "name": "Telangana"}, {"code": "KL", "name": "Kerala"},
    {"code": "KA", "name": "Karnataka"}, {"code": "MH", "name": "Maharashtra"},
    {"code": "GJ", "name": "Gujarat"}, {"code": "RJ", "name": "Rajasthan"},
    {"code": "MP", "name": "Madhya Pradesh"}, {"code": "UP", "name": "Uttar Pradesh"},
    {"code": "DL", "name": "Delhi"}, {"code": "HR", "name": "Haryana"},
    {"code": "PB", "name": "Punjab"}, {"code": "WB", "name": "West Bengal"},
    {"code": "OR", "name": "Odisha"}, {"code": "BR", "name": "Bihar"},
    {"code": "JH", "name": "Jharkhand"}, {"code": "CG", "name": "Chhattisgarh"},
    {"code": "HP", "name": "Himachal Pradesh"}, {"code": "UK", "name": "Uttarakhand"},
    {"code": "AS", "name": "Assam"}, {"code": "MN", "name": "Manipur"},
    {"code": "ML", "name": "Meghalaya"}, {"code": "NL", "name": "Nagaland"},
    {"code": "TR", "name": "Tripura"}, {"code": "SK", "name": "Sikkim"},
    {"code": "GA", "name": "Goa"},
]


class RegionAssignRequest(BaseModel):
    state_codes: List[str]
    manager_id: int


@router.get("/states")
def list_all_states():
    return INDIAN_STATES


@router.get("/")
def list_regions(db: Session = Depends(get_db)):
    regions = db.query(Region).all()
    return [{
        "id": r.id, "state_code": r.state_code, "state_name": r.state_name,
        "manager_id": r.manager_id,
        "manager_name": r.manager.name if r.manager else None,
    } for r in regions]


@router.post("/assign")
def assign_manager_to_regions(payload: RegionAssignRequest, db: Session = Depends(get_db)):
    manager = db.query(User).filter(User.id == payload.manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")

    state_map = {s["code"]: s["name"] for s in INDIAN_STATES}
    updated = []
    for code in payload.state_codes:
        if code not in state_map:
            continue
        existing = db.query(Region).filter(Region.state_code == code).first()
        if existing:
            existing.manager_id = payload.manager_id
        else:
            db.add(Region(state_code=code, state_name=state_map[code], manager_id=payload.manager_id))
        updated.append(code)

    db.commit()
    return {"status": "assigned", "states": updated, "manager_id": payload.manager_id}


@router.delete("/{state_code}/remove-manager")
def remove_manager_from_region(state_code: str, db: Session = Depends(get_db)):
    region = db.query(Region).filter(Region.state_code == state_code).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")
    region.manager_id = None
    db.commit()
    return {"status": "removed", "state_code": state_code}


@router.get("/manager/{manager_id}")
def get_manager_regions(manager_id: int, db: Session = Depends(get_db)):
    regions = db.query(Region).filter(Region.manager_id == manager_id).all()
    return [{"state_code": r.state_code, "state_name": r.state_name} for r in regions]
