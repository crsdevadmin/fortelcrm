# backend/utils/hierarchy.py
# Shared helper — compute which user IDs a given viewer is allowed to see.

from sqlalchemy.orm import Session
from typing import Optional, Set


def get_subtree_ids(viewer_id: int, db: Session) -> Optional[Set[int]]:
    """
    Returns the set of user IDs the viewer controls (themselves + all descendants).
    Returns None for admin/md roles — meaning "no filter, see everyone".
    """
    from ..models.models import User, UserRole

    viewer = db.query(User).filter(User.id == viewer_id).first()
    if not viewer:
        return set()

    # Admin and MD see everything
    if viewer.role in ("admin", "md"):
        return None

    # BFS from the viewer's node
    all_users = db.query(User.id, User.reports_to_id).all()
    children_map: dict[int, list[int]] = {}
    for uid, parent_id in all_users:
        if parent_id:
            children_map.setdefault(parent_id, []).append(uid)

    visible: Set[int] = set()
    queue = [viewer_id]
    while queue:
        current = queue.pop(0)
        visible.add(current)
        queue.extend(children_map.get(current, []))

    return visible
