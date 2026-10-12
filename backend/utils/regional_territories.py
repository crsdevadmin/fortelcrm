from typing import Optional, Set

from sqlalchemy.orm import Session

from ..models.models import User, UserRegionalTerritory
from .hierarchy import get_subtree_ids


REGIONAL_TERRITORIES = (
    "Chennai 1",
    "Chennai 2",
    "Madurai",
    "Coimbatore 1",
    "Coimbatore 2",
    "Hyderabad",
    "Cochin",
)

TERRITORY_STATES = {
    "Chennai 1": "TAMIL NADU",
    "Chennai 2": "TAMIL NADU",
    "Madurai": "TAMIL NADU",
    "Coimbatore 1": "TAMIL NADU",
    "Coimbatore 2": "TAMIL NADU",
    "Hyderabad": "TELANGANA",
    "Cochin": "KERALA",
}

# Chennai is split by owner, the same way Coimbatore is: doctors/sales owned by
# these user ids are Chennai 2, everyone else's Chennai work is Chennai 1.
# Keep in step with CHENNAI_2_OWNER_IDS in frontend/src/screens/ROIDashboard.jsx.
CHENNAI_2_OWNER_IDS: Set[int] = set()

# Who owns each Chennai territory. Ids differ per database, so owners are named
# by email and resolved to ids at startup (load_territory_owners, main.py).
CHENNAI_1_OWNER_EMAILS = {"siva.kumar@fortel.in"}
CHENNAI_2_OWNER_EMAILS = {"hanni.wilfred@fortel.in"}


def load_territory_owners(db: Session) -> None:
    """Resolve the Chennai owners to user ids and give each owner access to
    their territory (Siva Kumar D -> Chennai 1, Hanni Wilfred -> Chennai 2)."""
    owners = {
        "Chennai 1": CHENNAI_1_OWNER_EMAILS,
        "Chennai 2": CHENNAI_2_OWNER_EMAILS,
    }
    CHENNAI_2_OWNER_IDS.clear()
    for territory, emails in owners.items():
        users = db.query(User).filter(User.email.in_(list(emails))).all()
        for user in users:
            if territory == "Chennai 2":
                CHENNAI_2_OWNER_IDS.add(user.id)
            other = "Chennai 1" if territory == "Chennai 2" else "Chennai 2"
            db.query(UserRegionalTerritory).filter(
                UserRegionalTerritory.user_id == user.id,
                UserRegionalTerritory.territory == other,
            ).delete(synchronize_session=False)
            exists = db.query(UserRegionalTerritory).filter(
                UserRegionalTerritory.user_id == user.id,
                UserRegionalTerritory.territory == territory,
            ).first()
            if not exists:
                db.add(UserRegionalTerritory(user_id=user.id, territory=territory))
    db.commit()

# Territory names that existed before a split, mapped to where their old
# rows now belong (used by the startup migration in main.py).
RENAMED_TERRITORIES = {"Chennai": "Chennai 1"}

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
        return "Chennai 2" if int(owner_id or 0) in CHENNAI_2_OWNER_IDS else "Chennai 1"
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
