from typing import Optional, Set

from sqlalchemy.orm import Session

from ..models.models import User, UserRegionalTerritory
from .hierarchy import get_subtree_ids


REGIONAL_TERRITORIES = (
    "Chennai",
    "Madurai",
    "Coimbatore 1",
    "Coimbatore 2",
    "Hyderabad",
    "Cochin",
)

TERRITORY_STATES = {
    "Chennai": "TAMIL NADU",
    "Madurai": "TAMIL NADU",
    "Coimbatore 1": "TAMIL NADU",
    "Coimbatore 2": "TAMIL NADU",
    "Hyderabad": "TELANGANA",
    "Cochin": "KERALA",
}


def normalize_territories(territories) -> list[str]:
    requested = {str(value).strip() for value in (territories or []) if str(value).strip()}
    invalid = requested.difference(REGIONAL_TERRITORIES)
    if invalid:
        raise ValueError(f"Unknown regional territories: {', '.join(sorted(invalid))}")
    return [territory for territory in REGIONAL_TERRITORIES if territory in requested]


def direct_territories(user_id: int, db: Session) -> list[str]:
    assigned = {
        row.territory
        for row in db.query(UserRegionalTerritory.territory)
        .filter(UserRegionalTerritory.user_id == user_id)
        .all()
    }
    return [territory for territory in REGIONAL_TERRITORIES if territory in assigned]


def infer_user_territory(user: User) -> Optional[str]:
    city = " ".join((user.city or "").strip().lower().split())
    if city == "chennai":
        return "Chennai"
    if city == "madurai":
        return "Madurai"
    if city == "coimbatore":
        return "Coimbatore 2" if user.id == 9 else "Coimbatore 1"
    if city == "hyderabad":
        return "Hyderabad"
    if city in {"cochin", "kochi"}:
        return "Cochin"
    return None


def visible_territories(user_id: int, db: Session) -> Optional[Set[str]]:
    subtree = get_subtree_ids(user_id, db)
    if subtree is None:
        return None

    assigned = {
        row.territory
        for row in db.query(UserRegionalTerritory.territory)
        .filter(UserRegionalTerritory.user_id.in_(subtree))
        .all()
    }
    if assigned:
        return assigned

    user = db.query(User).filter(User.id == user_id).first()
    fallback = infer_user_territory(user) if user else None
    return {fallback} if fallback else set()


def can_manage_multiple_territories(user_id: int, db: Session) -> bool:
    subtree = get_subtree_ids(user_id, db)
    return subtree is None or len(subtree) > 1
