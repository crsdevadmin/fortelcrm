# backend/models/models.py
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Enum, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from ..database import Base


# ─────────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────────

class UserRole(str, enum.Enum):
    admin          = "admin"
    md             = "md"
    director       = "director"
    senior_manager = "senior_manager"
    manager        = "manager"
    rep            = "rep"
    custom         = "custom"       # for any new position admin creates


class CommercialModel(str, enum.Enum):
    U1 = "U1"
    U2 = "U2"
    P1 = "P1"
    P2 = "P2"
    N1 = "N1"
    D1 = "D1"
    R1 = "R1"


class InvestmentCategory(str, enum.Enum):
    PD = "PD"
    RD = "RD"
    CS = "CS"


class InvestmentSubCategory(str, enum.Enum):
    conference  = "Conference Registration"
    travel      = "Travel Support"
    hotel       = "Hotel / Stay"
    cme         = "CME Sponsorship"
    speaker     = "Speaker Program"
    advisory    = "Advisory Board"
    round_table = "Round Table"
    meeting     = "Doctor Meeting"
    commercial  = "Commercial Support"
    sample      = "Sample"
    gift        = "Gift"


class ROIGrade(str, enum.Enum):
    platinum = "Platinum"
    gold     = "Gold"
    silver   = "Silver"
    bronze   = "Bronze"


# ─────────────────────────────────────────────
# USER
# ─────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String(200), nullable=False)
    email            = Column(String(200), unique=True, nullable=False, index=True)  # login — must be @fortel.in
    personal_email   = Column(String(200), nullable=True)       # personal/contact email (gmail etc.)
    password_hash    = Column(String(500), nullable=True)       # bcrypt hash
    plain_password   = Column(String(200), nullable=True)       # stored for admin visibility
    role             = Column(Enum(UserRole), nullable=False, default=UserRole.rep)
    custom_role_name = Column(String(100), nullable=True)       # e.g. "Key Account Manager"
    is_active        = Column(Boolean, default=True)
    must_reset_password = Column(Boolean, default=True)         # force reset on first login
    profile_picture  = Column(String(500), nullable=True)
    phone            = Column(String(20), nullable=True)
    city             = Column(String(100), nullable=True)   # territory / base city
    state            = Column(String(100), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    created_by_id    = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Hierarchy — who does this user report to
    reports_to_id    = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    created_by  = relationship("User", foreign_keys=[created_by_id],  remote_side="User.id")
    reports_to  = relationship("User", foreign_keys=[reports_to_id],  remote_side="User.id")
    subordinates = relationship("User", foreign_keys=[reports_to_id], back_populates="reports_to")

    sales_entries = relationship("SalesEntry",  foreign_keys="SalesEntry.associate_id",  back_populates="associate")
    investments   = relationship("Investment",   foreign_keys="Investment.associate_id",  back_populates="associate")

    @property
    def display_role(self):
        """Human-readable role label."""
        if self.role == UserRole.custom and self.custom_role_name:
            return self.custom_role_name
        labels = {
            UserRole.admin:          "Admin",
            UserRole.md:             "MD",
            UserRole.director:       "Director",
            UserRole.senior_manager: "Senior Manager",
            UserRole.manager:        "Manager",
            UserRole.rep:            "Sales Rep",
        }
        return labels.get(self.role, self.role.value)


# ─────────────────────────────────────────────
# REGION
# ─────────────────────────────────────────────

class Region(Base):
    __tablename__ = "regions"

    id         = Column(Integer, primary_key=True, index=True)
    state_code = Column(String(10), nullable=False)
    state_name = Column(String(100), nullable=False)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    manager = relationship("User", foreign_keys=[manager_id])
    doctors = relationship("Doctor", back_populates="region")


# ─────────────────────────────────────────────
# DOCTOR
# ─────────────────────────────────────────────

class Doctor(Base):
    __tablename__ = "doctors"

    id               = Column(Integer, primary_key=True, index=True)
    customer_type    = Column(String(20),  default='doctor', nullable=True)   # 'doctor' | 'pharmacy'

    # ── Core identity ─────────────────────────────
    name             = Column(String(200), nullable=False)
    client_id        = Column(String(50),  nullable=True, index=True)   # External Client ID
    client_code      = Column(String(50),  nullable=True)               # e.g. FRTLDC248
    registration_number = Column(String(100), nullable=True)

    # ── Contact ───────────────────────────────────
    phone            = Column(String(20),  nullable=True)
    email            = Column(String(200), nullable=True)
    gender           = Column(String(20),  nullable=True)
    dob              = Column(String(30),  nullable=True)
    anniversary      = Column(String(30),  nullable=True)

    # ── Professional ──────────────────────────────
    hospital         = Column(String(300), nullable=True)   # clinic / pharmacy / hospital name
    firm_name        = Column(String(300), nullable=True)
    qualification    = Column(String(200), nullable=True)
    specialty        = Column(String(200), nullable=True)
    division         = Column(String(100), nullable=True)
    prescriber_type  = Column(String(50),  nullable=True)   # Prescriber / Non Prescriber
    category         = Column(String(10),  nullable=True)   # A / B / C / D
    approx_business  = Column(String(50),  nullable=True)   # e.g. 0-5000

    # ── Location ──────────────────────────────────
    city             = Column(String(100), nullable=True)
    state_code       = Column(String(50),  nullable=True)
    zone             = Column(String(100), nullable=True)
    pincode          = Column(String(20),  nullable=True)
    country          = Column(String(100), nullable=True, default='INDIA')
    full_address     = Column(Text,        nullable=True)   # Address 1
    address2         = Column(Text,        nullable=True)
    address3         = Column(Text,        nullable=True)
    latitude         = Column(String(50),  nullable=True)
    longitude        = Column(String(50),  nullable=True)

    # ── Fortel commercial ─────────────────────────
    commercial_model = Column(Enum(CommercialModel), nullable=True)
    expected_multiple= Column(Float, default=5.0)
    roi_grade        = Column(Enum(ROIGrade), nullable=True)
    add_date         = Column(String(30),  nullable=True)   # Doctor Add Date from import
    status           = Column(String(30),  nullable=True, default='Active')

    # ── Relations ─────────────────────────────────
    region_id        = Column(Integer, ForeignKey("regions.id"), nullable=True)
    manager_id       = Column(Integer, ForeignKey("users.id"),   nullable=True)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    region       = relationship("Region", back_populates="doctors")
    manager      = relationship("User",   foreign_keys=[manager_id])
    rep_mappings = relationship("RepDoctorMapping", back_populates="doctor")
    sales_entries= relationship("SalesEntry",       back_populates="doctor")
    investments  = relationship("Investment",        back_populates="doctor")


# ─────────────────────────────────────────────
# REP–DOCTOR MAPPING
# ─────────────────────────────────────────────

class RepDoctorMapping(Base):
    __tablename__ = "rep_doctor_mappings"

    id             = Column(Integer, primary_key=True, index=True)
    doctor_id      = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    manager_id     = Column(Integer, ForeignKey("users.id"),   nullable=True)
    associate_id   = Column(Integer, ForeignKey("users.id"),   nullable=True)
    assigned_at    = Column(DateTime, default=datetime.utcnow)
    assigned_by_id = Column(Integer, ForeignKey("users.id"),   nullable=True)
    is_active      = Column(Boolean, default=True)

    doctor      = relationship("Doctor", back_populates="rep_mappings")
    manager     = relationship("User",   foreign_keys=[manager_id])
    associate   = relationship("User",   foreign_keys=[associate_id])
    assigned_by = relationship("User",   foreign_keys=[assigned_by_id])


# ─────────────────────────────────────────────
# PRODUCT
# ─────────────────────────────────────────────

class Product(Base):
    __tablename__ = "products"

    id        = Column(Integer, primary_key=True, index=True)
    name      = Column(String(200), nullable=False, unique=True)
    pack_size = Column(String(100), nullable=True)
    rate      = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)

    sales_entries = relationship("SalesEntry", back_populates="product")


# ─────────────────────────────────────────────
# SALES ENTRY (week-wise)
# ─────────────────────────────────────────────

class SalesEntry(Base):
    __tablename__ = "sales_entries"

    id             = Column(Integer, primary_key=True, index=True)
    doctor_id      = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    associate_id   = Column(Integer, ForeignKey("users.id"),   nullable=False)
    product_id     = Column(Integer, ForeignKey("products.id"),nullable=False)
    year           = Column(Integer, nullable=False)
    month          = Column(Integer, nullable=False)
    week           = Column(Integer, nullable=False)   # stores day-of-month (1-31) for day-wise entries
    sale_date      = Column(String(30), nullable=True) # 'YYYY-MM-DD' — actual date of visit/sale
    quantity       = Column(Float, default=0)
    value          = Column(Float, default=0)
    remarks        = Column(Text, nullable=True)
    submitted_at   = Column(DateTime, default=datetime.utcnow)
    is_approved    = Column(Boolean, default=False)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at    = Column(DateTime, nullable=True)

    doctor      = relationship("Doctor",  back_populates="sales_entries")
    associate   = relationship("User",    foreign_keys=[associate_id],   back_populates="sales_entries")
    product     = relationship("Product", back_populates="sales_entries")
    approved_by = relationship("User",    foreign_keys=[approved_by_id])

    __table_args__ = (
        UniqueConstraint("doctor_id", "associate_id", "product_id", "year", "month", "week",
                         name="uq_sales_entry"),
    )


# ─────────────────────────────────────────────
# INVESTMENT
# ─────────────────────────────────────────────

class Investment(Base):
    __tablename__ = "investments"

    id               = Column(Integer, primary_key=True, index=True)
    doctor_id        = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    associate_id     = Column(Integer, ForeignKey("users.id"),   nullable=False)
    year             = Column(Integer, nullable=False)
    month            = Column(Integer, nullable=False)
    week             = Column(Integer, nullable=False)
    commercial_model_type = Column(String(5),  nullable=True)   # U1/U2/P1/P2/N1/D1/R1
    category         = Column(Enum(InvestmentCategory),    nullable=True)   # PD/RD/CS (legacy)
    sub_category     = Column(Enum(InvestmentSubCategory), nullable=True)
    amount           = Column(Float, nullable=False)
    expected_multiple= Column(Float, default=5.0)
    expected_sales   = Column(Float)
    purpose          = Column(Text,   nullable=True)
    bill_url         = Column(String(500), nullable=True)
    submitted_at     = Column(DateTime, default=datetime.utcnow)
    is_approved      = Column(Boolean, default=False)
    approved_by_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at      = Column(DateTime, nullable=True)

    doctor      = relationship("Doctor", back_populates="investments")
    associate   = relationship("User",   foreign_keys=[associate_id],   back_populates="investments")
    approved_by = relationship("User",   foreign_keys=[approved_by_id])
