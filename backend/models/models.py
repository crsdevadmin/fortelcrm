# backend/models/models.py
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, UniqueConstraint, LargeBinary
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
    back_office    = "back_office"
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


class UserRegionalTerritory(Base):
    __tablename__ = "user_regional_territories"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    territory  = Column(String(100), nullable=False)
    assigned_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("user_id", "territory", name="uq_user_regional_territory"),
    )


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
    state_code     = Column(String(50), nullable=False, default="")
    city           = Column(String(100), nullable=False, default="")
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
        UniqueConstraint("associate_id", "state_code", "city", "product_id", "year", "month", "week",
                         name="uq_regional_sales_region_product_week"),
    )


# REGIONAL WEEKLY SALES PDF

class RegionalSalesWeekPDF(Base):
    __tablename__ = "regional_sales_week_pdfs"

    id             = Column(Integer, primary_key=True, index=True)
    associate_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    state_code     = Column(String(50), nullable=False, default="")
    city           = Column(String(100), nullable=False, default="")
    year           = Column(Integer, nullable=False)
    month          = Column(Integer, nullable=False)
    week           = Column(Integer, nullable=False)
    filename       = Column(String(255), nullable=False)
    content_type   = Column(String(100), nullable=False, default="application/pdf")
    file_data      = Column(LargeBinary, nullable=False)
    entered_total  = Column(Float, nullable=False, default=0)
    pdf_total      = Column(Float, nullable=True)
    difference     = Column(Float, nullable=True)
    matches        = Column(Boolean, nullable=False, default=False)
    validation_status = Column(String(20), nullable=False, default="unverified")
    total_label    = Column(String(50), nullable=True)
    uploaded_at    = Column(DateTime, default=datetime.utcnow, nullable=False)

    associate = relationship("User", foreign_keys=[associate_id])


# PRIMARY SALES — invoice data uploaded by the back-office team

class Stockist(Base):
    __tablename__ = "stockists"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String(200), nullable=False)
    normalized_name = Column(String(200), nullable=False, unique=True, index=True)
    region          = Column(String(100), nullable=False, default="Unassigned", index=True)
    territory       = Column(String(100), nullable=False, default="Unassigned", index=True)
    is_active       = Column(Boolean, nullable=False, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    primary_sales_entries = relationship("PrimarySalesEntry", back_populates="stockist")


class PrimarySalesUpload(Base):
    __tablename__ = "primary_sales_uploads"

    id               = Column(Integer, primary_key=True, index=True)
    uploaded_by_id   = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    filename         = Column(String(255), nullable=False)
    file_checksum    = Column(String(64), nullable=False, unique=True, index=True)
    period_start     = Column(String(10), nullable=True, index=True)
    period_end       = Column(String(10), nullable=True, index=True)
    source_row_count = Column(Integer, nullable=False, default=0)
    inserted_count   = Column(Integer, nullable=False, default=0)
    updated_count    = Column(Integer, nullable=False, default=0)
    skipped_count    = Column(Integer, nullable=False, default=0)
    total_net_amount = Column(Float, nullable=False, default=0)
    uploaded_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    entries = relationship("PrimarySalesEntry", back_populates="upload")


class PrimarySalesEntry(Base):
    __tablename__ = "primary_sales_entries"

    id             = Column(Integer, primary_key=True, index=True)
    source_key     = Column(String(64), nullable=False, unique=True, index=True)
    upload_id      = Column(Integer, ForeignKey("primary_sales_uploads.id"), nullable=False, index=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    stockist_id    = Column(Integer, ForeignKey("stockists.id"), nullable=False, index=True)
    bill_number    = Column(String(100), nullable=False, index=True)
    bill_date      = Column(String(10), nullable=False, index=True)
    product_name   = Column(String(200), nullable=False, index=True)
    batch_number   = Column(String(100), nullable=True)
    quantity       = Column(Float, nullable=False, default=0)
    free_quantity  = Column(Float, nullable=False, default=0)
    rate           = Column(Float, nullable=False, default=0)
    gross_amount   = Column(Float, nullable=False, default=0)
    net_amount     = Column(Float, nullable=False, default=0)
    tax_amount     = Column(Float, nullable=False, default=0)
    gst_number     = Column(String(30), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at     = Column(DateTime, default=datetime.utcnow, nullable=False)

    upload      = relationship("PrimarySalesUpload", back_populates="entries")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    stockist    = relationship("Stockist", back_populates="primary_sales_entries")


class PrimaryCitySplitUpload(Base):
    """Tamil Nadu city-level detail supplied by the statewide Nexus stockist."""

    __tablename__ = "primary_city_split_uploads"

    id                 = Column(Integer, primary_key=True, index=True)
    uploaded_by_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    filename           = Column(String(255), nullable=False)
    file_checksum      = Column(String(64), nullable=False, unique=True, index=True)
    period_start       = Column(String(10), nullable=True, index=True)
    period_end         = Column(String(10), nullable=True, index=True)
    source_row_count   = Column(Integer, nullable=False, default=0)
    inserted_count     = Column(Integer, nullable=False, default=0)
    updated_count      = Column(Integer, nullable=False, default=0)
    skipped_count      = Column(Integer, nullable=False, default=0)
    total_gross_amount = Column(Float, nullable=False, default=0)
    uploaded_at        = Column(DateTime, default=datetime.utcnow, nullable=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    entries = relationship("PrimaryCitySplitEntry", back_populates="upload")


class PrimaryCitySplitEntry(Base):
    """City/customer rows used only to split Nexus Tamil Nadu Primary Sales."""

    __tablename__ = "primary_city_split_entries"

    id             = Column(Integer, primary_key=True, index=True)
    source_key     = Column(String(64), nullable=False, unique=True, index=True)
    upload_id      = Column(Integer, ForeignKey("primary_city_split_uploads.id"), nullable=False, index=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    customer_code  = Column(String(100), nullable=True)
    customer_name  = Column(String(200), nullable=False, index=True)
    bill_number    = Column(String(100), nullable=False, index=True)
    bill_date      = Column(String(10), nullable=False, index=True)
    product_code   = Column(String(100), nullable=True)
    product_name   = Column(String(200), nullable=False, index=True)
    batch_number   = Column(String(100), nullable=True)
    quantity       = Column(Float, nullable=False, default=0)
    free_quantity  = Column(Float, nullable=False, default=0)
    rate           = Column(Float, nullable=False, default=0)
    gross_amount   = Column(Float, nullable=False, default=0)
    net_amount     = Column(Float, nullable=False, default=0)
    sale_type      = Column(String(30), nullable=True)
    source_city    = Column(String(100), nullable=False, default="Unassigned", index=True)
    territory      = Column(String(100), nullable=False, default="Unassigned", index=True)
    region         = Column(String(100), nullable=False, default="Tamil Nadu", index=True)
    created_at     = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at     = Column(DateTime, default=datetime.utcnow, nullable=False)

    upload      = relationship("PrimaryCitySplitUpload", back_populates="entries")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])


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


# REGIONAL PRODUCT TARGET — kept separate from doctor-wise ProductTarget

class RegionalProductTarget(Base):
    __tablename__ = "regional_product_targets"

    id             = Column(Integer, primary_key=True, index=True)
    owner_user_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    state_code     = Column(String(50), nullable=False, default="")
    city           = Column(String(100), nullable=False, default="")
    product_id     = Column(Integer, ForeignKey("products.id"), nullable=False)
    year           = Column(Integer, nullable=False)
    month          = Column(Integer, nullable=False)
    target_units   = Column(Float, nullable=False, default=0)
    target_rate    = Column(Float, nullable=True)
    target_value   = Column(Float, nullable=False, default=0)
    created_by_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow)

    owner      = relationship("User", foreign_keys=[owner_user_id])
    product    = relationship("Product", foreign_keys=[product_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])

    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "state_code", "city", "product_id", "year", "month",
            name="uq_regional_target_user_territory_product_month",
        ),
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


# DAILY TASK ASSIGNMENT

class DailyTask(Base):
    __tablename__ = "daily_tasks"

    id                  = Column(Integer, primary_key=True, index=True)
    assigned_by_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_to_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    doctor_id           = Column(Integer, ForeignKey("doctors.id"), nullable=False, index=True)
    hospital            = Column(String(250), nullable=True)
    task_date           = Column(String(10), nullable=False, index=True)
    details             = Column(Text, nullable=False)
    details_fingerprint = Column(String(64), nullable=False)
    status              = Column(String(20), nullable=False, default="pending", index=True)
    completion_comments = Column(Text, nullable=True)
    read_at             = Column(DateTime, nullable=True)
    completed_at        = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at          = Column(DateTime, default=datetime.utcnow, nullable=False)

    assigned_by = relationship("User", foreign_keys=[assigned_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    doctor      = relationship("Doctor", foreign_keys=[doctor_id])

    __table_args__ = (
        UniqueConstraint(
            "assigned_to_id", "doctor_id", "task_date", "details_fingerprint",
            name="uq_daily_task_rep_doctor_date_details",
        ),
    )


# SAVED WEEKLY MANAGEMENT REPORT

class WeeklyManagementReport(Base):
    __tablename__ = "weekly_management_reports"

    id              = Column(Integer, primary_key=True, index=True)
    viewer_id       = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    scope           = Column(String(20), nullable=False, default="overall")
    year            = Column(Integer, nullable=False)
    month           = Column(Integer, nullable=False)
    week            = Column(Integer, nullable=False)
    version         = Column(Integer, nullable=False, default=1)
    week_start      = Column(String(10), nullable=False)
    week_end        = Column(String(10), nullable=False)
    payload_json    = Column(Text, nullable=False)
    generated_at    = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    viewer = relationship("User", foreign_keys=[viewer_id])

    __table_args__ = (
        UniqueConstraint(
            "viewer_id", "scope", "year", "month", "week", "version",
            name="uq_weekly_management_report_viewer_scope_period_version",
        ),
    )


# AUTOMATED SMS DELIVERY LOG

class SmsNotificationLog(Base):
    __tablename__ = "sms_notification_logs"

    id                    = Column(Integer, primary_key=True, index=True)
    idempotency_key       = Column(String(180), nullable=False, unique=True, index=True)
    notification_type     = Column(String(40), nullable=False, index=True)
    recipient_user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    related_user_id       = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    year                  = Column(Integer, nullable=False)
    month                 = Column(Integer, nullable=False)
    week                  = Column(Integer, nullable=False)
    phone                 = Column(String(20), nullable=True)
    template_id           = Column(String(60), nullable=False)
    message               = Column(Text, nullable=False)
    status                = Column(String(30), nullable=False, index=True)
    provider_message_id   = Column(String(200), nullable=True)
    error                 = Column(Text, nullable=True)
    attempt_count         = Column(Integer, nullable=False, default=0)
    last_attempt_at       = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at            = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at            = Column(DateTime, default=datetime.utcnow, nullable=False)

    recipient = relationship("User", foreign_keys=[recipient_user_id])
    related_user = relationship("User", foreign_keys=[related_user_id])


# EMPLOYEE AND COMPANY EXPENSES

class ExpenseLine(Base):
    __tablename__ = "expense_lines"

    id                = Column(Integer, primary_key=True, index=True)
    employee_id       = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    expense_type      = Column(String(20), nullable=False, index=True)  # employee | company
    expense_date      = Column(String(10), nullable=False, index=True)
    year              = Column(Integer, nullable=False, index=True)
    month             = Column(Integer, nullable=False, index=True)
    category          = Column(String(60), nullable=False)
    description       = Column(String(300), nullable=False)
    location          = Column(String(150), nullable=True)
    travel_from       = Column(String(150), nullable=True)
    travel_to         = Column(String(150), nullable=True)
    distance_km       = Column(Float, nullable=True)
    travel_mode       = Column(String(60), nullable=True)
    amount            = Column(Float, nullable=False)
    remarks           = Column(String(500), nullable=True)
    status            = Column(String(20), nullable=False, default="saved", index=True)
    bill_filename     = Column(String(255), nullable=False)
    bill_content_type = Column(String(100), nullable=False)
    bill_data         = Column(LargeBinary, nullable=False)
    bill_validation_status = Column(String(30), nullable=False, default="review_required", index=True)
    bill_validation_reason = Column(String(500), nullable=True)
    bill_detected_amount   = Column(Float, nullable=True)
    bill_reviewed_by_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    bill_reviewed_at       = Column(DateTime, nullable=True)
    bill_review_notes      = Column(String(500), nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at        = Column(DateTime, default=datetime.utcnow, nullable=False)

    employee = relationship("User", foreign_keys=[employee_id])
    bill_reviewed_by = relationship("User", foreign_keys=[bill_reviewed_by_id])
