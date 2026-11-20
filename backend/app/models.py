from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.core.database import Base

JSON_DOCUMENT = JSON()


class UTCDateTime(TypeDecorator):
    """Stores timezone-aware UTC timestamps and always returns UTC-aware datetimes across PostgreSQL and SQLite."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class UserRole(StrEnum):
    CUSTOMER = "customer"
    PLATFORM_ADMIN = "platform_admin"
    BUSINESS_ADMIN = "business_admin"
    BUSINESS_STAFF = "business_staff"
    BUSINESS_PENDING = "business_pending"


class ProductCategory(StrEnum):
    KARAOKE = "karaoke"
    TABLE = "table"
    CHAIR = "chair"


class AssetCondition(StrEnum):
    AVAILABLE = "available"
    UNDER_MAINTENANCE = "under_maintenance"
    DAMAGED = "damaged"
    UNAVAILABLE = "unavailable"


class RentalStatus(StrEnum):
    PENDING_ADMIN = "pending_admin"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class BusinessStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REJECTED = "rejected"


class RequestKind(StrEnum):
    MODIFICATION = "modification"
    CANCELLATION = "cancellation"


class RequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PaymentMethod(StrEnum):
    CASH = "cash"
    GCASH = "gcash"
    BANK_TRANSFER = "bank_transfer"


class PaymentEntryKind(StrEnum):
    PAYMENT = "payment"
    REFUND = "refund"


class PaymentEntryStatus(StrEnum):
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    REJECTED = "rejected"


def enum_column(enum_type: type[StrEnum], name: str) -> Enum:
    return Enum(enum_type, name=name, native_enum=False, values_callable=lambda members: [item.value for item in members])


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    contact_email: Mapped[str | None] = mapped_column(String(320))
    contact_phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(500))
    logo_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    logo_media_type: Mapped[str | None] = mapped_column(String(32))
    banner_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    banner_media_type: Mapped[str | None] = mapped_column(String(32))
    brand_primary: Mapped[str] = mapped_column(String(7), default="#7E3F3F")
    brand_secondary: Mapped[str] = mapped_column(String(7), default="#F5EFE6")
    brand_accent: Mapped[str] = mapped_column(String(7), default="#B88A5A")
    is_listed: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default=BusinessStatus.PENDING.value, index=True)
    subscription_plan: Mapped[str] = mapped_column(String(40), default="demo")
    subscription_status: Mapped[str] = mapped_column(String(20), default="active")
    subscription_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    approved_by_id: Mapped[int | None] = mapped_column(Integer)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(40))
    role: Mapped[UserRole] = mapped_column(enum_column(UserRole, "user_role"), default=UserRole.CUSTOMER)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class BusinessCustomer(Base):
    __tablename__ = "business_customers"
    __table_args__ = (UniqueConstraint("business_id", "customer_id", name="uq_business_customer"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class QualityTier(Base):
    __tablename__ = "quality_tiers"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (
        Index("uq_quality_tiers_business_name", "business_id", func.lower(func.trim(name)), unique=True),
    )


class BusinessCategory(Base):
    __tablename__ = "business_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (
        Index("uq_business_categories_business_name", "business_id", func.lower(func.trim(name)), unique=True),
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    specifications: Mapped[dict[str, str]] = mapped_column(JSON_DOCUMENT, default=dict)
    category: Mapped[str] = mapped_column(String(80), index=True)
    quality_tier_id: Mapped[int] = mapped_column(ForeignKey("quality_tiers.id", ondelete="RESTRICT"), index=True)
    price_cents: Mapped[int] = mapped_column(Integer)
    pricing_basis: Mapped[str | None] = mapped_column(String(24))
    billing_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    rounding_rule: Mapped[str | None] = mapped_column(String(16))
    image_url: Mapped[str | None] = mapped_column(String(2048))
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    image_media_type: Mapped[str | None] = mapped_column(String(32))
    __table_args__ = (
        Index(
            "uq_products_business_category_quality_name",
            "business_id",
            "category",
            "quality_tier_id",
            func.lower(func.trim(name)),
            unique=True,
        ),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    quality_tier: Mapped[QualityTier] = relationship()
    business: Mapped[Business] = relationship()
    assets: Mapped[list["InventoryAsset"]] = relationship(back_populates="product")


class InventoryAsset(Base):
    __tablename__ = "inventory_assets"
    __table_args__ = (UniqueConstraint("product_id", "asset_tag", name="uq_asset_tag_per_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    asset_tag: Mapped[str] = mapped_column(String(100))
    condition: Mapped[AssetCondition] = mapped_column(
        enum_column(AssetCondition, "asset_condition"),
        default=AssetCondition.AVAILABLE,
        index=True,
    )
    product: Mapped[Product] = relationship(back_populates="assets")


class RentalPackage(Base):
    __tablename__ = "rental_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    category: Mapped[str] = mapped_column(String(80), default="Karaoke Packages", index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    price_cents: Mapped[int | None] = mapped_column(Integer)
    pricing_basis: Mapped[str | None] = mapped_column(String(24))
    billing_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    rounding_rule: Mapped[str | None] = mapped_column(String(16))
    image_url: Mapped[str | None] = mapped_column(String(2048))
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    image_media_type: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    components: Mapped[list["PackageComponent"]] = relationship(
        back_populates="rental_package", cascade="all, delete-orphan"
    )
    business: Mapped[Business] = relationship()


class PackageComponent(Base):
    __tablename__ = "package_components"
    __table_args__ = (UniqueConstraint("package_id", "product_id", name="uq_package_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    package_id: Mapped[int] = mapped_column(ForeignKey("rental_packages.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    product: Mapped[Product] = relationship()
    rental_package: Mapped[RentalPackage] = relationship(back_populates="components")


class RentalOrder(Base):
    __tablename__ = "rental_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime())
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime())
    status: Mapped[RentalStatus] = mapped_column(
        enum_column(RentalStatus, "rental_status"), default=RentalStatus.PENDING_ADMIN, index=True
    )
    total_cents: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
    customer: Mapped[User] = relationship()
    lines: Mapped[list["OrderLine"]] = relationship(cascade="all, delete-orphan")
    payments: Mapped[list["PaymentEntry"]] = relationship(back_populates="rental_order")
    requests: Mapped[list["OrderRequest"]] = relationship(back_populates="rental_order")
    history: Mapped[list["OrderHistory"]] = relationship(order_by="OrderHistory.created_at")
    business: Mapped[Business] = relationship()


class OrderLine(Base):
    __tablename__ = "order_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("rental_orders.id", ondelete="CASCADE"), index=True)
    line_kind: Mapped[str] = mapped_column(String(16))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    package_id: Mapped[int | None] = mapped_column(ForeignKey("rental_packages.id", ondelete="RESTRICT"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_cents: Mapped[int] = mapped_column(Integer)
    line_total_cents: Mapped[int] = mapped_column(Integer)
    pricing_snapshot: Mapped[dict] = mapped_column(JSON_DOCUMENT)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    product: Mapped[Product | None] = relationship()
    rental_package: Mapped[RentalPackage | None] = relationship()


class InventoryAllocation(Base):
    __tablename__ = "inventory_allocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("rental_orders.id", ondelete="CASCADE"), index=True)
    order_line_id: Mapped[int] = mapped_column(ForeignKey("order_lines.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("inventory_assets.id", ondelete="RESTRICT"), index=True)
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    released_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), index=True)
    asset: Mapped[InventoryAsset] = relationship()


class OrderRequest(Base):
    __tablename__ = "order_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("rental_orders.id", ondelete="RESTRICT"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    kind: Mapped[RequestKind] = mapped_column(enum_column(RequestKind, "order_request_kind"))
    status: Mapped[RequestStatus] = mapped_column(
        enum_column(RequestStatus, "order_request_status"), default=RequestStatus.PENDING
    )
    reason: Mapped[str] = mapped_column(Text)
    proposed_data: Mapped[dict | None] = mapped_column(JSON_DOCUMENT)
    before_data: Mapped[dict | None] = mapped_column(JSON_DOCUMENT)
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    rental_order: Mapped[RentalOrder] = relationship(back_populates="requests")


class OrderHistory(Base):
    __tablename__ = "order_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("rental_orders.id", ondelete="RESTRICT"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON_DOCUMENT)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class PaymentEntry(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("rental_orders.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[PaymentEntryKind] = mapped_column(enum_column(PaymentEntryKind, "payment_entry_kind"))
    status: Mapped[PaymentEntryStatus] = mapped_column(
        enum_column(PaymentEntryStatus, "payment_entry_status"), default=PaymentEntryStatus.SUBMITTED
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    method: Mapped[PaymentMethod] = mapped_column(enum_column(PaymentMethod, "payment_method"))
    reference_number: Mapped[str | None] = mapped_column(String(160))
    proof_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    proof_media_type: Mapped[str | None] = mapped_column(String(32))
    paid_at: Mapped[datetime] = mapped_column(UTCDateTime())
    notes: Mapped[str | None] = mapped_column(Text)
    submitted_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    rental_order: Mapped[RentalOrder] = relationship(back_populates="payments")


class BusinessAuditLog(Base):
    __tablename__ = "business_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="SET NULL"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict] = mapped_column(JSON_DOCUMENT)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now(), index=True)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(1000))
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now(), onupdate=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now(), index=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
