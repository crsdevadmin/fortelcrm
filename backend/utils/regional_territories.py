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

MADURAI_REGIONAL_AREAS = {
    "madurai",
    "trichy",
    "tiruchirappalli",
    "tirunelveli",
    "thirunelveli",
    "trivandrum",
    "thiruvananthapuram",
    "nagercoil",
    "nagarkoil",
    "tuticorin",
    "thoothukudi",
    "kulasekaram",
    "kulasegaram",
    "thanjavur",
    "tanjavur",
    "dindigul",
    "thinducal",
}

COIMBATORE_REGIONAL_AREAS = {
    "coimbatore",
    "salem",
    "erode",
    "namakkal",
    "namakal",
    "dharmapuri",
    "tharmapuri",
    "tirupur",
    "thirupur",
}


def territory_for_city(city: Optional[str], owner_id: Optional[int] = None) -> Optional[str]:
    """Map a raw doctor city or saved regional city to an approved territory."""
    value = " ".join((city or "").strip().lower().split())
    if not value:
        return None
    exact = {territory.lower(): territory for territory in REGIONAL_TERRITORIES}
    if value in exact:
        return exact[value]
    if value == "chennai":
        return "Chennai"
    if value in MADURAI_REGIONAL_AREAS:
        return "Madurai"
    if value in COIMBATORE_REGIONAL_AREAS:
        return "Coimbatore 2" if int(owner_id or 0) == 9 else "Coimbatore 1"
    if value == "hyderabad":
        return "Hyderabad"
    if value in {"cochin", "kochi"}:
        return "Cochin"
    return None


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
    return territory_for_city(user.city, user.id)


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
