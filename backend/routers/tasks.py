import hashlib
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import DailyTask, Doctor, User
from ..utils.hierarchy import get_subtree_ids


router = APIRouter(prefix="/tasks", tags=["Daily Tasks"])
MANAGER_ROLES = {"admin", "md", "director", "senior_manager", "manager"}


class TaskCreateRequest(BaseModel):
    assigned_by_id: int
    assigned_to_id: int
    doctor_id: int
    task_date: str
    details: str


class TaskCompleteRequest(BaseModel):
    user_id: int
    comments: str


def _normalize_details(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _fingerprint(value: str) -> str:
    return hashlib.sha256(_normalize_details(value).encode("utf-8")).hexdigest()


def _validate_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="task_date must be YYYY-MM-DD")


def _task_dict(task: DailyTask):
    return {
        "id": task.id,
        "assigned_by_id": task.assigned_by_id,
        "assigned_by_name": task.assigned_by.name if task.assigned_by else "",
        "assigned_to_id": task.assigned_to_id,
        "assigned_to_name": task.assigned_to.name if task.assigned_to else "",
        "doctor_id": task.doctor_id,
        "doctor_name": task.doctor.name if task.doctor else "",
        "hospital": task.hospital or (task.doctor.hospital if task.doctor else ""),
        "city": task.doctor.city if task.doctor else "",
        "task_date": task.task_date,
        "details": task.details,
        "status": task.status,
        "completion_comments": task.completion_comments,
        "is_read": task.read_at is not None,
        "read_at": task.read_at.isoformat() if task.read_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }


@router.get("/assignees")
def task_assignees(manager_id: int, db: Session = Depends(get_db)):
    manager = db.query(User).filter(User.id == manager_id, User.is_active == True).first()
    if not manager or manager.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Only managers can assign tasks")
    visible_ids = get_subtree_ids(manager_id, db)
    q = db.query(User).filter(User.is_active == True, User.role == "rep", User.id != manager_id)
    if visible_ids is not None:
        q = q.filter(User.id.in_(visible_ids))
    return [{"id": user.id, "name": user.name, "city": user.city, "state": user.state} for user in q.order_by(User.name).all()]


@router.post("/")
def create_task(payload: TaskCreateRequest, db: Session = Depends(get_db)):
    manager = db.query(User).filter(User.id == payload.assigned_by_id, User.is_active == True).first()
    if not manager or manager.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Only managers can assign tasks")

    assignee = db.query(User).filter(User.id == payload.assigned_to_id, User.is_active == True).first()
    if not assignee or assignee.role != "rep":
        raise HTTPException(status_code=400, detail="Select an active representative")

    visible_ids = get_subtree_ids(payload.assigned_by_id, db)
    if visible_ids is not None and payload.assigned_to_id not in visible_ids:
        raise HTTPException(status_code=403, detail="Representative is outside your reporting hierarchy")

    doctor = db.query(Doctor).filter(Doctor.id == payload.doctor_id, Doctor.is_active != False).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    details = re.sub(r"\s+", " ", (payload.details or "").strip())
    if len(details) < 3:
        raise HTTPException(status_code=400, detail="Enter task details")
    task_date = _validate_date(payload.task_date)
    fingerprint = _fingerprint(details)

    duplicate = db.query(DailyTask).filter(
        DailyTask.assigned_to_id == payload.assigned_to_id,
        DailyTask.doctor_id == payload.doctor_id,
        DailyTask.task_date == task_date,
        DailyTask.details_fingerprint == fingerprint,
    ).first()
    if duplicate:
        return {"status": "duplicate", "duplicate": True, "task": _task_dict(duplicate)}

    task = DailyTask(
        assigned_by_id=payload.assigned_by_id,
        assigned_to_id=payload.assigned_to_id,
        doctor_id=payload.doctor_id,
        hospital=doctor.hospital,
        task_date=task_date,
        details=details,
        details_fingerprint=fingerprint,
        status="pending",
    )
    db.add(task)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        duplicate = db.query(DailyTask).filter(
            DailyTask.assigned_to_id == payload.assigned_to_id,
            DailyTask.doctor_id == payload.doctor_id,
            DailyTask.task_date == task_date,
            DailyTask.details_fingerprint == fingerprint,
        ).first()
        return {"status": "duplicate", "duplicate": True, "task": _task_dict(duplicate)}
    db.refresh(task)
    return {"status": "created", "duplicate": False, "task": _task_dict(task)}


@router.get("/")
def list_tasks(
    viewer_id: int,
    task_date: Optional[str] = None,
    status: Optional[str] = None,
    unread_only: bool = False,
    db: Session = Depends(get_db),
):
    viewer = db.query(User).filter(User.id == viewer_id).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="User not found")

    q = db.query(DailyTask)
    if viewer.role == "rep":
        q = q.filter(DailyTask.assigned_to_id == viewer_id)
    else:
        visible_ids = get_subtree_ids(viewer_id, db)
        if visible_ids is not None:
            q = q.filter(or_(DailyTask.assigned_by_id == viewer_id, DailyTask.assigned_to_id.in_(visible_ids)))
    if task_date:
        q = q.filter(DailyTask.task_date == _validate_date(task_date))
    if status and status != "all":
        q = q.filter(DailyTask.status == status)
    if unread_only:
        q = q.filter(DailyTask.assigned_to_id == viewer_id, DailyTask.read_at.is_(None))
    tasks = q.order_by(DailyTask.task_date.desc(), DailyTask.created_at.desc()).all()
    return [_task_dict(task) for task in tasks]


@router.patch("/{task_id}/read")
def mark_task_read(task_id: int, user_id: int, db: Session = Depends(get_db)):
    task = db.query(DailyTask).filter(DailyTask.id == task_id, DailyTask.assigned_to_id == user_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.read_at:
        task.read_at = datetime.utcnow()
        task.updated_at = datetime.utcnow()
        db.commit()
    return {"status": "read", "task_id": task_id}


@router.patch("/{task_id}/complete")
def complete_task(task_id: int, payload: TaskCompleteRequest, db: Session = Depends(get_db)):
    task = db.query(DailyTask).filter(DailyTask.id == task_id, DailyTask.assigned_to_id == payload.user_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    comments = re.sub(r"\s+", " ", (payload.comments or "").strip())
    if not comments:
        raise HTTPException(status_code=400, detail="Completion comments are required")
    task.status = "completed"
    task.completion_comments = comments
    task.completed_at = datetime.utcnow()
    task.read_at = task.read_at or datetime.utcnow()
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return {"status": "completed", "task": _task_dict(task)}
