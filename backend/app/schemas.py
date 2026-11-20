from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, model_validator

from app.models import AssetCondition, PaymentEntryKind, PaymentMethod, RequestKind, RentalStatus

PositiveQuantity = Annotated[int, Field(gt=0, le=1000)]


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterInput(APIModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=12, max_length=128)]
    display_name: Annotated[str, Field(min_length=1, max_length=120)]
    phone: Annotated[str | None, Field(max_length=40)] = None


class LoginInput(APIModel):
    email: EmailStr
    password: str


class UserRead(APIModel):
    id: int
    email: str
    display_name: str
    phone: str | None
    role: str
    business_id: int | None = None


class ProfileUpdate(APIModel):
    display_name: Annotated[str, Field(min_length=1, max_length=120)]
    phone: Annotated[str | None, Field(max_length=40)] = None


class ActiveUpdate(APIModel):
    is_active: bool


class BusinessRegisterInput(APIModel):
    business_name: Annotated[str, Field(min_length=2, max_length=160)]
    owner_name: Annotated[str, Field(min_length=1, max_length=120)]
    email: EmailStr
    contact_number: Annotated[str, Field(min_length=7, max_length=40)]
    address: Annotated[str, Field(min_length=5, max_length=500)]
    password: Annotated[str, Field(min_length=12, max_length=128)]


class BusinessDecisionInput(APIModel):
    status: Literal["active", "rejected", "suspended"]
    note: Annotated[str | None, Field(max_length=1000)] = None


class BusinessSubscriptionInput(APIModel):
    subscription_plan: Annotated[str, Field(min_length=1, max_length=40)]
    subscription_status: Literal["active", "trialing", "past_due", "cancelled"]
    subscription_ends_at: datetime | None = None


class BusinessProfileInput(APIModel):
    name: Annotated[str, Field(min_length=2, max_length=160)]
    description: Annotated[str, Field(max_length=4000)] = ""
    contact_email: EmailStr | None = None
    contact_phone: Annotated[str | None, Field(max_length=40)] = None
    address: Annotated[str | None, Field(max_length=500)] = None
    brand_primary: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
    brand_secondary: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
    brand_accent: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class BusinessAdminCreateInput(APIModel):
    email: EmailStr
    display_name: Annotated[str, Field(min_length=1, max_length=120)]
    phone: Annotated[str | None, Field(max_length=40)] = None
    password: Annotated[str, Field(min_length=12, max_length=128)]


class PlatformSettingInput(APIModel):
    value: Annotated[str, Field(max_length=1000)]


class QualityInput(APIModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    is_active: bool = True


class BusinessCategoryInput(APIModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    is_active: bool = True


class PricingFields(APIModel):
    price_cents: Annotated[int, Field(ge=0)]
    pricing_basis: str | None = None
    billing_interval_minutes: Annotated[int | None, Field(gt=0, le=525600)] = None
    rounding_rule: str | None = None

    @model_validator(mode="after")
    def validate_pricing(self):
        if self.pricing_basis is None:
            if self.billing_interval_minutes is not None or self.rounding_rule is not None:
                raise ValueError("A pricing basis is required before billing details can be set")
        elif self.pricing_basis == "per_rental":
            if self.billing_interval_minutes is not None or self.rounding_rule is not None:
                raise ValueError("per_rental pricing does not use a billing interval or rounding rule")
        elif self.pricing_basis == "duration":
            if self.billing_interval_minutes is None or self.rounding_rule not in {"ceil", "pro_rata"}:
                raise ValueError("duration pricing requires an interval and ceil or pro_rata rounding")
        else:
            raise ValueError("pricing_basis must be per_rental or duration")
        return self


class ProductCreate(PricingFields):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    description: Annotated[str, Field(max_length=4000)] = ""
    category: Annotated[str, Field(min_length=1, max_length=80)]
    quality_tier_id: int
    initial_stock: Annotated[int, Field(ge=0, le=1000)] = 0
    image_url: HttpUrl | None = None
    is_active: bool = True


class ProductUpdate(PricingFields):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    description: Annotated[str, Field(max_length=4000)] = ""
    category: Annotated[str, Field(min_length=1, max_length=80)]
    quality_tier_id: int
    image_url: HttpUrl | None = None
    is_active: bool = True


class ProductRead(APIModel):
    id: int
    business_id: int
    business_name: str
    business_slug: str
    name: str
    description: str
    category: str
    quality_tier_id: int
    quality_name: str
    price_cents: int
    pricing_basis: str | None
    pricing_configured: bool
    billing_interval_minutes: int | None
    rounding_rule: str | None
    image_url: str | None
    is_active: bool
    stock_count: int
    available_count: int | None = None


class ProductPriceUpdate(APIModel):
    price_cents: Annotated[int, Field(ge=0)]


class ProductStockUpdate(APIModel):
    quantity: Annotated[int, Field(ge=0, le=1000)]


class PackageComponentInput(APIModel):
    product_id: int
    quantity: PositiveQuantity


class PackageInput(APIModel):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    description: Annotated[str, Field(max_length=4000)] = ""
    price_cents: Annotated[int | None, Field(ge=0)] = None
    pricing_basis: str | None = None
    billing_interval_minutes: Annotated[int | None, Field(gt=0, le=525600)] = None
    rounding_rule: str | None = None
    image_url: HttpUrl | None = None
    is_active: bool = True
    components: Annotated[list[PackageComponentInput], Field(min_length=1, max_length=30)]

    @model_validator(mode="after")
    def validate_pricing(self):
        if self.pricing_basis is None:
            if self.billing_interval_minutes is not None or self.rounding_rule is not None:
                raise ValueError("A pricing basis is required before billing details can be set")
        elif self.pricing_basis == "per_rental":
            if self.price_cents is None or self.billing_interval_minutes is not None or self.rounding_rule is not None:
                raise ValueError("per_rental pricing requires a price and no interval or rounding rule")
        elif self.pricing_basis == "duration":
            if (
                self.price_cents is None
                or self.billing_interval_minutes is None
                or self.rounding_rule not in {"ceil", "pro_rata"}
            ):
                raise ValueError("duration pricing requires a price, interval, and ceil or pro_rata rounding")
        else:
            raise ValueError("pricing_basis must be per_rental or duration")
        return self


class PackageRead(APIModel):
    id: int
    name: str
    description: str
    price_cents: int | None
    pricing_basis: str | None
    billing_interval_minutes: int | None
    rounding_rule: str | None
    image_url: str | None
    is_active: bool
    pricing_configured: bool
    components: list[dict]


class OrderLineInput(APIModel):
    kind: str
    item_id: int
    quantity: PositiveQuantity

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind not in {"product", "package"}:
            raise ValueError("kind must be product or package")
        return self


class OrderCreate(APIModel):
    business_id: int
    starts_at: datetime
    ends_at: datetime
    lines: Annotated[list[OrderLineInput], Field(min_length=1, max_length=50)]

    @model_validator(mode="after")
    def validate_window(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Rental timestamps must include a timezone")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be later than starts_at")
        return self


class OrderStatusInput(APIModel):
    status: RentalStatus
    note: Annotated[str | None, Field(max_length=1000)] = None


class OrderRequestInput(APIModel):
    kind: RequestKind
    reason: Annotated[str, Field(min_length=1, max_length=2000)]
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    lines: Annotated[list[OrderLineInput] | None, Field(min_length=1, max_length=50)] = None

    @model_validator(mode="after")
    def validate_request(self):
        if self.kind == RequestKind.MODIFICATION and (
            self.starts_at is None or self.ends_at is None or self.lines is None
        ):
            raise ValueError("Modification requests must include rental dates and replacement order lines")
        if self.kind == RequestKind.CANCELLATION and (self.starts_at is not None or self.lines is not None):
            raise ValueError("Cancellation requests must not include replacement order details")
        if self.starts_at is not None and self.starts_at.tzinfo is None:
            raise ValueError("starts_at must include a timezone")
        if self.ends_at is not None and self.ends_at.tzinfo is None:
            raise ValueError("ends_at must include a timezone")
        if self.starts_at is not None and self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be later than starts_at")
        return self


class RequestDecisionInput(APIModel):
    approved: bool
    note: Annotated[str | None, Field(max_length=1000)] = None


class PaymentSubmission(APIModel):
    kind: PaymentEntryKind = PaymentEntryKind.PAYMENT
    amount_cents: Annotated[int, Field(gt=0)]
    method: PaymentMethod
    paid_at: datetime
    reference_number: Annotated[str | None, Field(max_length=160)] = None
    notes: Annotated[str | None, Field(max_length=1000)] = None

    @model_validator(mode="after")
    def validate_paid_at(self):
        if self.paid_at.tzinfo is None:
            raise ValueError("paid_at must include a timezone")
        return self


class PaymentDecisionInput(APIModel):
    approved: bool
    note: Annotated[str | None, Field(max_length=1000)] = None


class AssetInput(APIModel):
    product_id: int
    asset_tag: Annotated[str, Field(min_length=1, max_length=100)]
    condition: AssetCondition = AssetCondition.AVAILABLE


class AssetConditionInput(APIModel):
    condition: AssetCondition


class OrderSummary(APIModel):
    id: int
    customer_id: int
    customer_name: str
    starts_at: datetime
    ends_at: datetime
    status: RentalStatus
    total_cents: int
    paid_cents: int
    balance_cents: int
    payment_status: str
    lines: list[dict]
    requests: list[dict]
    payments: list[dict]


class PaymentRead(APIModel):
    id: int
    kind: PaymentEntryKind
    status: str
    amount_cents: int
    method: PaymentMethod
    reference_number: str | None
    paid_at: datetime
    notes: str | None
    submitted_by_id: int
    verified_by_id: int | None
    submitted_at: datetime
    decided_at: datetime | None
