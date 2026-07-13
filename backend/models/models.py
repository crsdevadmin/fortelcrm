# backend/models/models.py
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from ..database import Base


class UserRole(str, enum.Enum):
    admin          = "admin"
    md             = "md"
    director       = "director"
    senior_manager = "senior_manager"
    manager        = "manager"
    rep            = "rep"
    custom         = "custom"


class ROIGrade(str, enum.Enum):
    platinum = "Platinum"
    gold     = "Gold"
    silver   = "Silver"
    bronze   = "Bronze"


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
    conference  = "conference"
    travel      = "travel"
    hotel       = "hotel"
    cme         = "cme"
    speaker     = "speaker"
    sample      = "sample"
    gift        = "gift"
    meeting     = "meeting"
    round_table = "round_table"
    advisory    = "advisory"


# USER

class User(Base):
    __tablename__ = "users"

    id               = Column(Integer,     primary_key=True, index=True)
    name             = Column(String(100), nullable=False)
    username         = Column(String(50),  unique=True, index=True, nullable=True)
    email            = Column(String(100), unique=True, index=True, nullable=True)
    password_hash    = Column(String(200), nullable=False)
    role             = Column(String(20),  default="rep", nullable=False)
    custom_role_name = Column(String(100), nullable=True)
    phone            = Column(String(20),  nullable=True)
    personal_email   = Column(String(200), nullable=True)
    city             = Column(String(100), nullable=True)
    state            = Column(String(200), nullable=True)
    plain_password   = Column(String(200), nullable=True)
    must_reset_password = Column(Boolean, default=False)
    profile_picture  = Column(String(500), nullable=True)
    is_active        = Column(Boolean,     default=True)
    reports_to_id    = Column(Integer,     ForeignKey("users.id"), nullable=True)
    created_by_id    = Column(Integer,     ForeignKey("users.id"), nullable=True)
    created_at       = Column(DateTime,    default=datetime.utcnow)

    created_by   = relationship("User", foreign_keys=[created_by_id], remote_side="User.id")
    reports_to   = relationship("User", foreign_keys=[reports_to_id], remote_side="User.id")
    subordinates = relationship("User", foreign_keys=[reports_to_id], back_populates="reports_to")

    sales_entries = relationship("SalesEntry", foreign_keys="SalesEntry.associate_id", back_populates="associate")
    investments   = relationship("Investment", foreign_keys="Investment.associate_id", back_populates="associate")
    visit_logs    = relationship("VisitLog",   foreign_keys="VisitLog.associate_id",   back_populates="associate")

    @property
    def display_role(self):
        if self.role == "custom" and self.custom_role_name:
            return self.custom_role_name
        return self.role or "rep"

    @property
    def reports_to_name(self):
        return self.reports_to.name if self.reports_to else None


# REGION

class Region(Base):
    __tablename__ = "regions"

    id         = Column(Integer,     primary_key=True, index=True)
    name       = Column(String(100), unique=True, nullable=False)
    state_code = Column(String(10),  nullable=True)
    created_at = Column(DateTime,    default=datetime.utcnow)

    doctors = relationship("Doctor", back_populates="region")


# DOCTOR — all string-like columns use String to avoid OID mismatches

class Doctor(Base):
    __tablename__ = "doctors"

    id                  = Column(Integer,     primary_key=True, index=True)
    customer_type       = Column(String(50),  nullable=True, default="doctor")
    client_id           = Column(String(50),  nullable=True)
    client_code         = Column(String(50),  nullable=True)
    registration_number = Column(String(100), nullable=True)
    name                = Column(String(150), nullable=False)
    phone               = Column(String(20),  nullable=True)
    email               = Column(String(100), nullable=True)
    gender              = Column(String(10),  nullable=True)
    dob                 = Column(String(20),  nullable=True)
    anniversary         = Column(String(20),  nullable=True)
    hospital            = Column(String(200), nullable=True)
    firm_name           = Column(String(200), nullable=True)
    qualification       = Column(String(100), nullable=True)
    specialty           = Column(String(100), nullable=True)
    division            = Column(String(100), nullable=True)
    prescriber_type     = Column(String(100), nullable=True)
    category            = Column(String(100), nullable=True)
    approx_business     = Column(String(100), nullable=True)
    city                = Column(String(100), nullable=True)
    state_code          = Column(String(10),  nullable=True)
    zone                = Column(String(100), nullable=True)
    pincode             = Column(String(20),  nullable=True)
    country             = Column(String(100), nullable=True, default="INDIA")
    full_address        = Column(String(500), nullable=True)
    address2            = Column(String(500), nullable=True)
    address3            = Column(String(500), nullable=True)
    latitude            = Column(String(30),  nullable=True)
    longitude           = Column(String(30),  nullable=True)
    commercial_model    = Column(String(5),   nullable=True)
    expected_multiple   = Column(String(10),  nullable=True)
    roi_grade           = Column(String(20),  nullable=True)
    add_date            = Column(String(20),  nullable=True)
    status              = Column(String(20),  nullable=True, default="Active")
    is_active           = Column(Boolean,     default=True)
    region_id           = Column(Integer,     ForeignKey("regions.id"), nullable=True)
    manager_id          = Column(Integer,     ForeignKey("users.id"),   nullable=True)
    created_at          = Column(DateTime,    default=datetime.utcnow)

    region        = relationship("Region",           back_populates="doctors")
    manager       = relationship("User",             foreign_keys=[manager_id])
    rep_mappings  = relationship("RepDoctorMapping", back_populates="doctor")
    sales_entries = relationship("SalesEntry",        back_populates="doctor")
    investments   = relationship("Investment",         back_populates="doctor")
    visit_logs    = relationship("VisitLog",           back_populates="doctor")


# REP-DOCTOR MAPPING

class RepDoctorMapping(Base):
    __tablename__ = "rep_doctor_mappings"

    id             = Column(Integer,  primary_key=True, index=True)
    doctor_id      = Column(Integer,  ForeignKey("doctors.id"), nullable=False)
    associate_id   = Column(Integer,  ForeignKey("users.id"),   nullable=True)
    rep_id         = Column(Integer,  ForeignKey("users.id"),   nullable=True)
    manager_id     = Column(Integer,  ForeignKey("users.id"),   nullable=True)
    assigned_by_id = Column(Integer,  ForeignKey("users.id"),   nullable=True)
    is_active      = Column(Boolean,  default=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    doctor    = relationship("Doctor", back_populates="rep_mappings")
    associate = relationship("User",   foreign_keys=[associate_id])
    rep       = relationship("User",   foreign_keys=[rep_id])


# PRODUCT

class Product(Base):
    __tablename__ = "products"

    id          = Column(Integer,     primary_key=True, index=True)
    name        = Column(String(150), nullable=False)
    code        = Column(String(50),  nullable=True)    # pack_size alias
    composition = Column(String(500), nullable=True)
    pack        = Column(String(50),  nullable=True)    # e.g. 30's, 10's, 1
    rate        = Column(Float,       nullable=True)    # legacy column — keep for backward compat
    price       = Column(Float,       nullable=True)    # PTS (same as rate; preferred going forward)
    gst         = Column(String(10),  nullable=True)    # e.g. "5%" or "18%"
    mrp         = Column(Float,       nullable=True)    # Maximum Retail Price
    category    = Column(String(100), nullable=True)
    is_active   = Column(Boolean,     default=True)
    created_at  = Column(DateTime,    default=datetime.utcnow)

    sales_entries = relationship("SalesEntry", back_populates="product")


# SALES ENTRY

class SalesEntry(Base):
    __tablename__ = "sales_entries"

    id             = Column(Integer,  primary_key=True, index=True)
    doctor_id      = Column(Integer,  ForeignKey("doctors.id"),  nullable=False)
    associate_id   = Column(Integer,  ForeignKey("users.id"),    nullable=False)
    product_id     = Column(Integer,  ForeignKey("products.id"), nullable=False)
    year           = Column(Integer,  nullable=False)
    month          = Column(Integer,  nullable=False)
    week           = Column(Integer,  nullable=True)
    sale_date      = Column(String(20), nullable=True)
    remarks        = Column(String(500), nullable=True)
    submitted_at   = Column(DateTime,   nullable=True)
    qty            = Column('quantity', Float, nullable=True)
    value          = Column(Float,    nullable=True)
    approved_by_id = Column(Integer,  ForeignKey("users.id"), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    doctor      = relationship("Doctor",  back_populates="sales_entries")
    associate   = relationship("User",    foreign_keys=[associate_id],   back_populates="sales_entries")
    product     = relationship("Product", back_populates="sales_entries")
    approved_by = relationship("User",    foreign_keys=[approved_by_id])

    __table_args__ = (
        UniqueConstraint("doctor_id", "associate_id", "product_id", "year", "month", "week",
                         name="uq_sales_entry"),
    )


# REGIONAL SALES ENTRY

class RegionalSalesEntry(Base):
    __tablename__ = "regional_sales_entries"

    id             = Column(Integer,  primary_key=True, index=True)
    associate_id   = Column(Integer,  ForeignKey("users.id"),    nullable=False)
    product_id     = Column(Integer,  ForeignKey("products.id"), nullable=False)
    year           = Column(Integer,  nullable=False)
    month          = Column(Integer,  nullable=False)
    week           = Column(Integer,  nullable=False)
    qty            = Column('quantity', Float, nullable=True)
    price          = Column(Float,    nullable=True)
    value          = Column(Float,    nullable=True)
    remarks        = Column(String(500), nullable=True)
    submitted_at   = Column(DateTime, default=datetime.utcnow)
    created_at     = Column(DateTime, default=datetime.utcnow)

    associate = relationship("User",    foreign_keys=[associate_id])
    product   = relationship("Product", foreign_keys=[product_id])

    __table_args__ = (
        UniqueConstraint("associate_id", "product_id", "year", "month", "week",
                         name="uq_regional_sales_user_product_week"),
    )


# PRODUCT TARGET

class ProductTarget(Base):
    __tablename__ = "product_targets"

    id             = Column(Integer,  primary_key=True, index=True)
    owner_user_id  = Column(Integer,  ForeignKey("users.id"), nullable=False)
    product_id     = Column(Integer,  ForeignKey("products.id"), nullable=False)
    year           = Column(Integer,  nullable=False)
    month          = Column(Integer,  nullable=False)
    target_units   = Column(Float,    nullable=False, default=0)
    target_rate    = Column(Float,    nullable=True)
    target_value   = Column(Float,    nullable=False, default=0)
    created_by_id  = Column(Integer,  ForeignKey("users.id"), nullable=False)
    updated_by_id  = Column(Integer,  ForeignKey("users.id"), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow)

    owner      = relationship("User",    foreign_keys=[owner_user_id])
    product    = relationship("Product", foreign_keys=[product_id])
    created_by = relationship("User",    foreign_keys=[created_by_id])
    updated_by = relationship("User",    foreign_keys=[updated_by_id])

    __table_args__ = (
        UniqueConstraint("owner_user_id", "product_id", "year", "month",
                         name="uq_product_target_user_product_month"),
    )


# INVESTMENT

class Investment(Base):
    __tablename__ = "investments"

    id                    = Column(Integer,     primary_key=True, index=True)
    doctor_id             = Column(Integer,     ForeignKey("doctors.id"), nullable=False)
    associate_id          = Column(Integer,     ForeignKey("users.id"),   nullable=False)
    year                  = Column(Integer,     nullable=False)
    month                 = Column(Integer,     nullable=False)
    week                  = Column(Integer,     nullable=False)
    commercial_model_type = Column(String(5),   nullable=True)
    category              = Column(String(5),   nullable=True)
    sub_category          = Column(String(50),  nullable=True)
    amount                = Column(Float,       nullable=False)
    expected_multiple     = Column(Float,       default=5.0)
    expected_sales        = Column(Float,       nullable=True)
    purpose               = Column(Text,        nullable=True)
    bill_url              = Column(String(500), nullable=True)
    submitted_at          = Column(DateTime,    default=datetime.utcnow)
    is_approved           = Column(Boolean,     default=False)
    approved_by_id        = Column(Integer,     ForeignKey("users.id"), nullable=True)
    approved_at           = Column(DateTime,    nullable=True)

    doctor      = relationship("Doctor", back_populates="investments")
    associate   = relationship("User",   foreign_keys=[associate_id],   back_populates="investments")
    approved_by = relationship("User",   foreign_keys=[approved_by_id])


# VISIT LOG

class VisitLog(Base):
    __tablename__ = "visit_logs"

    id           = Column(Integer,     primary_key=True, index=True)
    associate_id = Column(Integer,     ForeignKey("users.id"),   nullable=False)
    doctor_id    = Column(Integer,     ForeignKey("doctors.id"), nullable=True)
    latitude     = Column(Float,       nullable=True)
    longitude    = Column(Float,       nullable=True)
    address      = Column(String(500), nullable=True)
    visit_time   = Column(DateTime,    default=datetime.utcnow, nullable=False)
    purpose      = Column(String(100), nullable=True)
    notes        = Column(Text,        nullable=True)
    created_at   = Column(DateTime,    default=datetime.utcnow)

    associate = relationship("User",   foreign_keys=[associate_id], back_populates="visit_logs")
    doctor    = relationship("Doctor", back_populates="visit_logs")
