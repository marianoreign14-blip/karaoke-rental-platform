from datetime import datetime, timezone
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.dependencies import administrator, current_user, platform_administrator
from app.models import (
    AssetCondition,
    Business,
    BusinessAuditLog,
    BusinessCategory,
    BusinessCustomer,
    BusinessStatus,
    InventoryAllocation,
    InventoryAsset,
    OrderHistory,
    OrderLine,
    OrderRequest,
    PackageComponent,
    PaymentEntry,
    PaymentEntryKind,
    PaymentEntryStatus,
    PlatformSetting,
    Product,
    QualityTier,
    RentalOrder,
    RentalPackage,
    RentalStatus,
    RequestKind,
    RequestStatus,
    User,
    UserRole,
)
from app.schemas import (
    AssetConditionInput,
    AssetInput,
    ActiveUpdate,
    BusinessAdminCreateInput,
    BusinessCategoryInput,
    BusinessDecisionInput,
    BusinessProfileInput,
    BusinessRegisterInput,
    BusinessSubscriptionInput,
    LoginInput,
    OrderCreate,
    OrderRequestInput,
    OrderStatusInput,
    PackageInput,
    PaymentDecisionInput,
    PaymentSubmission,
    PlatformSettingInput,
    ProductCreate,
    ProductPriceUpdate,
    ProductStockUpdate,
    ProductUpdate,
    ProfileUpdate,
    QualityInput,
    RegisterInput,
    RequestDecisionInput,
)
from app.services.inventory import (
    ACTIVE_ALLOCATION_STATUSES,
    allocate_assets,
    build_order_lines,
    lock_requested_items,
    lock_products,
    price_configured,
    release_allocations,
)

api = APIRouter(prefix="/api")
limiter = Limiter(key_func=get_remote_address)
MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
SUPPORTED_IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}


@api.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok"}


@api.get("/live")
def liveness():
    return {"status": "ok"}


def _user_read(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "phone": user.phone,
        "role": user.role.value,
        "business_id": user.business_id,
    }


def _business_read(business: Business, request: Request) -> dict:
    return {
        "id": business.id,
        "name": business.name,
        "slug": business.slug,
        "description": business.description,
        "contact_email": business.contact_email,
        "contact_phone": business.contact_phone,
        "address": business.address,
        "logo_url": str(request.url_for("business_logo", business_id=business.id)) if business.logo_data else None,
        "banner_url": (
            str(request.url_for("business_banner", business_id=business.id)) if business.banner_data else None
        ),
        "brand_primary": business.brand_primary,
        "brand_secondary": business.brand_secondary,
        "brand_accent": business.brand_accent,
        "is_listed": business.is_listed,
        "status": business.status,
        "subscription_plan": business.subscription_plan,
        "subscription_status": business.subscription_status,
        "subscription_ends_at": business.subscription_ends_at,
        "created_at": business.created_at,
    }


def _audit(
    db: Session,
    actor: User,
    business_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    details: dict,
) -> None:
    db.add(
        BusinessAuditLog(
            business_id=business_id,
            actor_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
    )


def _business_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")[:180] or "business"


def _require_business_id(user: User) -> int:
    if user.business_id is None:
        raise HTTPException(status_code=403, detail="A business account is required")
    return user.business_id


def _require_business_admin(user: User) -> int:
    business_id = _require_business_id(user)
    if user.role != UserRole.BUSINESS_ADMIN:
        raise HTTPException(status_code=403, detail="Business owner access is required")
    return business_id


@api.post("/auth/business-register", status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
def register_business(payload: BusinessRegisterInput, request: Request, db: Session = Depends(get_db)):
    business = Business(
        name=payload.business_name.strip(),
        slug=_business_slug(payload.business_name),
        status=BusinessStatus.PENDING.value,
        description="",
        contact_email=payload.email.lower(),
        contact_phone=payload.contact_number.strip(),
        address=payload.address.strip(),
    )
    db.add(business)
    db.flush()
    owner = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=payload.owner_name.strip(),
        phone=payload.contact_number.strip(),
        role=UserRole.BUSINESS_PENDING,
        business_id=business.id,
    )
    db.add(owner)
    try:
        db.flush()
        db.add_all(
            [
                QualityTier(business_id=business.id, name=name, is_active=True)
                for name in ("Basic", "Standard", "Premium")
            ]
            + [
                BusinessCategory(business_id=business.id, name=name, is_active=True)
                for name in ("karaoke", "table", "chair")
            ]
        )
        _audit(db, owner, business.id, "business_registration_submitted", "business", business.id, {})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A business with that name or an account with that email already exists",
        ) from None
    return {"business_id": business.id, "status": business.status, "message": "Registration awaits platform approval"}


@api.get("/marketplace/businesses")
def marketplace_businesses(
    request: Request,
    search: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
):
    statement = select(Business).where(
        Business.status == BusinessStatus.ACTIVE.value,
        Business.is_listed.is_(True),
    )
    if search:
        term = f"%{search.strip()}%"
        statement = statement.where(Business.name.ilike(term) | Business.description.ilike(term))
    businesses = db.scalars(statement.order_by(Business.name, Business.id))
    return [_business_read(business, request) for business in businesses]


@api.get("/marketplace/businesses/{slug}")
def marketplace_business(slug: str, request: Request, db: Session = Depends(get_db)):
    business = db.scalar(
        select(Business).where(
            Business.slug == slug,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business is None:
        raise HTTPException(status_code=404, detail="Business storefront not found")
    return _business_read(business, request)


@api.get("/marketplace/businesses/{business_id}/logo", name="business_logo")
def business_logo(business_id: int, db: Session = Depends(get_db)):
    business = db.scalar(
        select(Business).where(
            Business.id == business_id,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business is None or business.logo_data is None or business.logo_media_type is None:
        raise HTTPException(status_code=404, detail="Business logo not found")
    return Response(
        content=business.logo_data,
        media_type=business.logo_media_type,
        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@api.get("/marketplace/businesses/{business_id}/banner", name="business_banner")
def business_banner(business_id: int, db: Session = Depends(get_db)):
    business = db.scalar(
        select(Business).where(
            Business.id == business_id,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business is None or business.banner_data is None or business.banner_media_type is None:
        raise HTTPException(status_code=404, detail="Business banner not found")
    return Response(
        content=business.banner_data,
        media_type=business.banner_media_type,
        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@api.get("/platform/summary")
def platform_summary(_: User = Depends(platform_administrator), db: Session = Depends(get_db)):
    return {
        "businesses": db.scalar(select(func.count(Business.id))) or 0,
        "active_businesses": db.scalar(
            select(func.count(Business.id)).where(Business.status == BusinessStatus.ACTIVE.value)
        )
        or 0,
        "pending_businesses": db.scalar(
            select(func.count(Business.id)).where(Business.status == BusinessStatus.PENDING.value)
        )
        or 0,
        "customers": db.scalar(select(func.count(User.id)).where(User.role == UserRole.CUSTOMER)) or 0,
        "orders": db.scalar(select(func.count(RentalOrder.id))) or 0,
    }


@api.get("/platform/settings")
def platform_settings(_: User = Depends(platform_administrator), db: Session = Depends(get_db)):
    allowed_keys = {
        "marketplace_name",
        "support_email",
        "maintenance_mode",
        "default_subscription_plan",
    }
    return {
        setting.key: setting.value
        for setting in db.scalars(select(PlatformSetting).where(PlatformSetting.key.in_(allowed_keys)))
    }


@api.put("/platform/settings/{key}")
def update_platform_setting(
    key: str,
    payload: PlatformSettingInput,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    allowed_keys = {
        "marketplace_name",
        "support_email",
        "maintenance_mode",
        "default_subscription_plan",
    }
    if key not in allowed_keys:
        raise HTTPException(status_code=404, detail="Platform setting not found")
    value = payload.value.strip()
    if key == "maintenance_mode" and value.lower() not in {"true", "false"}:
        raise HTTPException(status_code=422, detail="maintenance_mode must be true or false")
    setting = db.get(PlatformSetting, key)
    if setting is None:
        setting = PlatformSetting(key=key, value=value, updated_by_id=platform_admin.id)
        db.add(setting)
    else:
        setting.value = value
        setting.updated_by_id = platform_admin.id
    _audit(db, platform_admin, None, "platform_setting_updated", "platform_setting", None, {"key": key})
    db.commit()
    return {"key": key, "value": value}


@api.get("/platform/businesses")
def platform_businesses(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=120),
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    statement = select(Business)
    if status_filter:
        statement = statement.where(Business.status == status_filter)
    if search:
        term = f"%{search.strip()}%"
        statement = statement.where(Business.name.ilike(term) | Business.slug.ilike(term))
    result = []
    for business in db.scalars(statement.order_by(Business.created_at.desc(), Business.id)):
        owner = db.scalar(
            select(User)
            .where(User.business_id == business.id, User.role.in_([UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_PENDING]))
            .order_by(User.id)
        )
        result.append(
            {
                **_business_read(business, request),
                "owner_name": owner.display_name if owner else None,
                "owner_email": owner.email if owner else None,
                "owner_active": owner.is_active if owner else None,
            }
        )
    return result


@api.patch("/platform/businesses/{business_id}/listing")
def set_business_listing(
    business_id: int,
    payload: ActiveUpdate,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    if payload.is_active and business.status != BusinessStatus.ACTIVE.value:
        raise HTTPException(status_code=409, detail="Only active businesses can be listed")
    business.is_listed = payload.is_active
    _audit(
        db,
        platform_admin,
        business.id,
        "business_listing_changed",
        "business",
        business.id,
        {"is_listed": payload.is_active},
    )
    db.commit()
    return {"id": business.id, "is_listed": business.is_listed}


@api.patch("/platform/businesses/{business_id}/status")
def set_business_status(
    business_id: int,
    payload: BusinessDecisionInput,
    request: Request,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    allowed_transitions = {
        BusinessStatus.PENDING.value: {BusinessStatus.ACTIVE.value, BusinessStatus.REJECTED.value},
        BusinessStatus.ACTIVE.value: {BusinessStatus.SUSPENDED.value},
        BusinessStatus.SUSPENDED.value: {BusinessStatus.ACTIVE.value},
        BusinessStatus.REJECTED.value: set(),
    }
    if payload.status not in allowed_transitions.get(business.status, set()):
        raise HTTPException(status_code=409, detail="That business status transition is not allowed")
    business.status = payload.status
    if payload.status == BusinessStatus.ACTIVE.value:
        business.approved_at = datetime.now(timezone.utc)
        business.approved_by_id = platform_admin.id
        owners = db.scalars(
            select(User).where(
                User.business_id == business.id,
                User.role == UserRole.BUSINESS_PENDING,
            )
        )
        for owner in owners:
            owner.role = UserRole.BUSINESS_ADMIN
            owner.is_active = True
    elif payload.status == BusinessStatus.REJECTED.value:
        pending_owners = db.scalars(
            select(User).where(
                User.business_id == business.id,
                User.role == UserRole.BUSINESS_PENDING,
            )
        )
        for owner in pending_owners:
            owner.is_active = False
    _audit(
        db,
        platform_admin,
        business.id,
        "business_status_changed",
        "business",
        business.id,
        {"status": payload.status, "note": payload.note},
    )
    db.commit()
    db.refresh(business)
    return _business_read(business, request)


@api.patch("/platform/businesses/{business_id}/subscription")
def update_business_subscription(
    business_id: int,
    payload: BusinessSubscriptionInput,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    if payload.subscription_ends_at is not None and payload.subscription_ends_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Subscription end date must include a timezone")
    before = {
        "plan": business.subscription_plan,
        "status": business.subscription_status,
        "ends_at": business.subscription_ends_at.isoformat() if business.subscription_ends_at else None,
    }
    business.subscription_plan = payload.subscription_plan.strip()
    business.subscription_status = payload.subscription_status
    business.subscription_ends_at = payload.subscription_ends_at
    _audit(
        db,
        platform_admin,
        business.id,
        "business_subscription_changed",
        "business",
        business.id,
        {"before": before, "after": payload.model_dump(mode="json")},
    )
    db.commit()
    return {"id": business.id, "subscription_plan": business.subscription_plan,
            "subscription_status": business.subscription_status, "subscription_ends_at": business.subscription_ends_at}


def _create_business_admin(
    db: Session,
    business: Business,
    payload: BusinessAdminCreateInput,
    role: UserRole,
    actor: User,
) -> User:
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        phone=payload.phone,
        role=role,
        business_id=business.id,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists") from None
    _audit(db, actor, business.id, "business_staff_created", "user", user.id, {"role": role.value})
    return user


@api.post("/platform/businesses/{business_id}/admin", status_code=status.HTTP_201_CREATED)
def create_business_admin(
    business_id: int,
    payload: BusinessAdminCreateInput,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.status != BusinessStatus.ACTIVE.value:
        raise HTTPException(status_code=409, detail="Activate the business before assigning an administrator")
    user = _create_business_admin(db, business, payload, UserRole.BUSINESS_ADMIN, platform_admin)
    db.commit()
    db.refresh(user)
    return _user_read(user)


@api.get("/platform/audit-logs")
def platform_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(BusinessAuditLog, Business.name)
        .outerjoin(Business, Business.id == BusinessAuditLog.business_id)
        .order_by(BusinessAuditLog.created_at.desc(), BusinessAuditLog.id.desc())
        .limit(limit)
    )
    return [
        {
            "id": entry.id,
            "business_id": entry.business_id,
            "business_name": business_name,
            "actor_id": entry.actor_id,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "details": entry.details,
            "created_at": entry.created_at,
        }
        for entry, business_name in rows
    ]


@api.get("/admin/business")
def business_settings(request: Request, admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    return _business_read(business, request)


@api.put("/admin/business")
def update_business_settings(
    payload: BusinessProfileInput,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    before = {
        "name": business.name,
        "description": business.description,
        "brand_primary": business.brand_primary,
        "brand_secondary": business.brand_secondary,
        "brand_accent": business.brand_accent,
    }
    for field, value in payload.model_dump().items():
        setattr(business, field, value)
    _audit(
        db,
        admin,
        business.id,
        "business_profile_updated",
        "business",
        business.id,
        {"before": before},
    )
    db.commit()
    db.refresh(business)
    return _business_read(business, request)


async def _save_business_image(
    request: Request,
    business_id: int,
    admin: User,
    db: Session,
    *,
    banner: bool,
) -> dict:
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    image_data, media_type = await _read_uploaded_image(request)
    if banner:
        business.banner_data = image_data
        business.banner_media_type = media_type
        field = "banner"
    else:
        business.logo_data = image_data
        business.logo_media_type = media_type
        field = "logo"
    _audit(db, admin, business.id, f"business_{field}_uploaded", "business", business.id, {})
    db.commit()
    return _business_read(business, request)


@api.put("/admin/business/logo")
async def upload_business_logo(
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    return await _save_business_image(request, _require_business_admin(admin), admin, db, banner=False)


@api.put("/admin/business/banner")
async def upload_business_banner(
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    return await _save_business_image(request, _require_business_admin(admin), admin, db, banner=True)


@api.get("/admin/staff")
def business_staff(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    staff = db.scalars(
        select(User)
        .where(
            User.business_id == business_id,
            User.role.in_([UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_STAFF]),
        )
        .order_by(User.display_name)
    )
    return [{**_user_read(user), "is_active": user.is_active, "created_at": user.created_at} for user in staff]


@api.post("/admin/staff", status_code=status.HTTP_201_CREATED)
def create_business_staff(
    payload: BusinessAdminCreateInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    user = _create_business_admin(db, business, payload, UserRole.BUSINESS_STAFF, admin)
    db.commit()
    db.refresh(user)
    return _user_read(user)


@api.patch("/admin/staff/{staff_id}/active")
def set_business_staff_active(
    staff_id: int,
    payload: ActiveUpdate,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    staff = db.scalar(
        select(User).where(
            User.id == staff_id,
            User.business_id == business_id,
            User.role == UserRole.BUSINESS_STAFF,
        )
    )
    if staff is None:
        raise HTTPException(status_code=404, detail="Staff member not found")
    staff.is_active = payload.is_active
    _audit(
        db,
        admin,
        business_id,
        "business_staff_status_changed",
        "user",
        staff.id,
        {"is_active": payload.is_active},
    )
    db.commit()
    return {"id": staff.id, "is_active": staff.is_active}


@api.get("/admin/categories")
def admin_categories(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    return list(
        db.scalars(
            select(BusinessCategory)
            .where(BusinessCategory.business_id == business_id)
            .order_by(BusinessCategory.name)
        )
    )


@api.post("/admin/categories", status_code=status.HTTP_201_CREATED)
def create_business_category(
    payload: BusinessCategoryInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    category = BusinessCategory(
        business_id=business_id,
        name=payload.name.strip(),
        is_active=payload.is_active,
    )
    db.add(category)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That category already exists for this business") from None
    _audit(db, admin, business_id, "category_created", "category", category.id, {"name": category.name})
    db.commit()
    db.refresh(category)
    return {"id": category.id, "name": category.name, "is_active": category.is_active}


@api.put("/admin/categories/{category_id}")
def update_business_category(
    category_id: int,
    payload: BusinessCategoryInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    category = db.scalar(
        select(BusinessCategory).where(
            BusinessCategory.id == category_id,
            BusinessCategory.business_id == business_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    category.name = payload.name.strip()
    category.is_active = payload.is_active
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That category already exists for this business") from None
    _audit(db, admin, business_id, "category_updated", "category", category.id, {"name": category.name})
    db.commit()
    return {"id": category.id, "name": category.name, "is_active": category.is_active}
@api.post("/auth/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(payload: RegisterInput, request: Request, db: Session = Depends(get_db)):
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        phone=payload.phone,
        role=UserRole.CUSTOMER,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists") from None
    db.refresh(user)
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer", "user": _user_read(user)}


@api.post("/auth/login")
@limiter.limit("10/minute")
def login(payload: LoginInput, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer", "user": _user_read(user)}


@api.get("/users/me")
def get_profile(user: User = Depends(current_user)):
    return _user_read(user)


@api.put("/users/me")
def update_profile(payload: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.display_name = payload.display_name.strip()
    user.phone = payload.phone
    db.commit()
    db.refresh(user)
    return _user_read(user)


def _product_read(
    product: Product,
    request: Request,
    stock_count: int,
    available_count: int | None,
) -> dict:
    return {
        "id": product.id,
        "business_id": product.business_id,
        "business_name": product.business.name,
        "business_slug": product.business.slug,
        "name": product.name,
        "description": product.description,
        "category": product.category,
        "quality_tier_id": product.quality_tier_id,
        "quality_name": product.quality_tier.name,
        "price_cents": product.price_cents,
        "pricing_basis": product.pricing_basis,
        "pricing_configured": price_configured(product),
        "billing_interval_minutes": product.billing_interval_minutes,
        "rounding_rule": product.rounding_rule,
        "image_url": (
            str(request.url_for("catalog_product_image", product_id=product.id))
            if product.image_data is not None
            else product.image_url
        ),
        "is_active": product.is_active,
        "stock_count": stock_count,
        "available_count": available_count,
    }


def _available_assets(
    db: Session,
    product_id: int,
    starts_at: datetime,
    ends_at: datetime,
) -> list[InventoryAsset]:
    conflicting_allocation = select(InventoryAllocation.id).join(
        RentalOrder, RentalOrder.id == InventoryAllocation.order_id
    ).where(
        InventoryAllocation.asset_id == InventoryAsset.id,
        InventoryAllocation.released_at.is_(None),
        RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
        InventoryAllocation.starts_at < ends_at,
        InventoryAllocation.ends_at > starts_at,
    )
    return list(
        db.scalars(
            select(InventoryAsset).where(
                InventoryAsset.product_id == product_id,
                InventoryAsset.condition == AssetCondition.AVAILABLE,
                ~conflicting_allocation.exists(),
            )
        ).all()
    )


@api.get("/catalog/products")
def catalog_products(
    request: Request,
    category: str | None = Query(default=None, max_length=80),
    quality_tier_id: int | None = None,
    business_id: int | None = None,
    search: str | None = Query(default=None, max_length=120),
    sort: str = Query(default="name", pattern="^(name|price_asc|price_desc|quality)$"),
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for availability")
    if starts_at is not None and (
        starts_at.tzinfo is None
        or ends_at is None
        or ends_at.tzinfo is None
        or ends_at <= starts_at
    ):
        raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")

    statement = (
        select(Product)
        .join(Business, Business.id == Product.business_id)
        .options(selectinload(Product.quality_tier), selectinload(Product.business))
        .where(
            Product.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business_id is not None:
        statement = statement.where(Product.business_id == business_id)
    if category is not None:
        statement = statement.where(Product.category == category)
    if quality_tier_id is not None:
        statement = statement.where(Product.quality_tier_id == quality_tier_id)
    if search:
        statement = statement.where(Product.name.ilike(f"%{search.strip()}%"))
    if sort == "name":
        statement = statement.order_by(Product.name, Product.id)
    elif sort == "price_asc":
        statement = statement.order_by(Product.price_cents, Product.id)
    elif sort == "price_desc":
        statement = statement.order_by(Product.price_cents.desc(), Product.id)
    else:
        statement = statement.order_by(Product.quality_tier_id, Product.name)

    result = []
    for product in db.scalars(statement):
        stock = db.scalar(
            select(func.count(InventoryAsset.id)).where(
                InventoryAsset.product_id == product.id,
                InventoryAsset.condition == AssetCondition.AVAILABLE,
            )
        ) or 0
        available = None
        if starts_at is not None and ends_at is not None:
            available = len(_available_assets(db, product.id, starts_at, ends_at))
        result.append(_product_read(product, request, stock, available))
    return result


@api.get("/catalog/products/{product_id}/image", name="catalog_product_image")
def catalog_product_image(product_id: int, db: Session = Depends(get_db)):
    product = db.scalar(
        select(Product)
        .join(Business, Business.id == Product.business_id)
        .where(
            Product.id == product_id,
            Product.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if product is None or product.image_data is None or product.image_media_type is None:
        raise HTTPException(status_code=404, detail="Product image not found")
    return Response(
        content=product.image_data,
        media_type=product.image_media_type,
        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@api.get("/catalog/quality-tiers")
def catalog_quality_tiers(business_id: int | None = None, db: Session = Depends(get_db)):
    statement = (
        select(QualityTier)
        .join(Business, Business.id == QualityTier.business_id)
        .where(
            QualityTier.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business_id is not None:
        statement = statement.where(QualityTier.business_id == business_id)
    return [
        {"id": tier.id, "name": tier.name, "business_id": tier.business_id}
        for tier in db.scalars(statement.order_by(QualityTier.name, QualityTier.business_id))
    ]


@api.get("/catalog/categories")
def catalog_categories(business_id: int, db: Session = Depends(get_db)):
    business = db.scalar(
        select(Business.id).where(
            Business.id == business_id,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
            Business.is_listed.is_(True),
        )
    )
    if business is None:
        raise HTTPException(status_code=404, detail="Business storefront is not available")
    return [
        {"id": category.id, "name": category.name}
        for category in db.scalars(
            select(BusinessCategory)
            .where(
                BusinessCategory.business_id == business_id,
                BusinessCategory.is_active.is_(True),
            )
            .order_by(BusinessCategory.name)
        )
    ]


def _package_read(package: RentalPackage, request: Request, available_count: int | None = None) -> dict:
    return {
        "id": package.id,
        "business_id": package.business_id,
        "business_name": package.business.name,
        "business_slug": package.business.slug,
        "name": package.name,
        "description": package.description,
        "price_cents": package.price_cents,
        "pricing_basis": package.pricing_basis,
        "billing_interval_minutes": package.billing_interval_minutes,
        "rounding_rule": package.rounding_rule,
        "image_url": (
            str(request.url_for("catalog_package_image", package_id=package.id))
            if package.image_data is not None
            else package.image_url
        ),
        "is_active": package.is_active,
        "pricing_configured": price_configured(package),
        "available_count": available_count,
        "components": [
            {
                "product_id": component.product.id,
                "name": component.product.name,
                "category": component.product.category,
                "quality_name": component.product.quality_tier.name,
                "quantity": component.quantity,
            }
            for component in package.components
        ],
    }


def _uploaded_image_media_type(image: bytes) -> str | None:
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _read_uploaded_image(request: Request) -> tuple[bytes, str]:
    declared_media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if declared_media_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP image")

    image = bytearray()
    async for chunk in request.stream():
        if len(image) + len(chunk) > MAX_UPLOAD_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Images must be 5 MB or smaller")
        image.extend(chunk)
    if not image:
        raise HTTPException(status_code=422, detail="Choose an image to upload")

    actual_media_type = _uploaded_image_media_type(bytes(image))
    if actual_media_type is None or actual_media_type != declared_media_type:
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid JPEG, PNG, or WebP image")
    return bytes(image), actual_media_type


@api.get("/catalog/packages/{package_id}/image", name="catalog_package_image")
def catalog_package_image(package_id: int, db: Session = Depends(get_db)):
    package = db.scalar(
        select(RentalPackage)
        .join(Business, Business.id == RentalPackage.business_id)
        .where(
            RentalPackage.id == package_id,
            RentalPackage.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
        )
    )
    if package is None or package.image_data is None or package.image_media_type is None:
        raise HTTPException(status_code=404, detail="Package image not found")
    return Response(
        content=package.image_data,
        media_type=package.image_media_type,
        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@api.get("/catalog/packages")
def catalog_packages(
    request: Request,
    business_id: int | None = None,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for availability")
    if starts_at is not None and (
        starts_at.tzinfo is None or ends_at is None or ends_at.tzinfo is None or ends_at <= starts_at
    ):
        raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")
    package_statement = (
        select(RentalPackage)
        .options(
            selectinload(RentalPackage.components)
            .selectinload(PackageComponent.product)
            .selectinload(Product.quality_tier),
            selectinload(RentalPackage.business),
        )
        .join(Business, Business.id == RentalPackage.business_id)
        .where(
            RentalPackage.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business_id is not None:
        package_statement = package_statement.where(RentalPackage.business_id == business_id)
    packages = db.scalars(package_statement.order_by(RentalPackage.name))
    result = []
    for package in packages:
        available = None
        if starts_at is not None and ends_at is not None and package.components:
            available = min(
                len(_available_assets(db, component.product_id, starts_at, ends_at)) // component.quantity
                for component in package.components
            )
        result.append(_package_read(package, request, available))
    return result


def _payment_summary(order: RentalOrder) -> tuple[int, int, str]:
    verified = [entry for entry in order.payments if entry.status == PaymentEntryStatus.VERIFIED]
    net_paid = sum(
        entry.amount_cents if entry.kind == PaymentEntryKind.PAYMENT else -entry.amount_cents
        for entry in verified
    )
    paid = max(net_paid, 0)
    balance = max(order.total_cents - paid, 0)
    if net_paid <= 0 and any(entry.kind == PaymentEntryKind.REFUND for entry in verified):
        payment_status = "refunded"
    elif paid == 0:
        payment_status = "unpaid"
    elif balance > 0:
        payment_status = "partially_paid"
    else:
        payment_status = "paid"
    return paid, balance, payment_status


def _order_read(order: RentalOrder) -> dict:
    paid, balance, payment_status = _payment_summary(order)
    return {
        "id": order.id,
        "business_id": order.business_id,
        "business_name": order.business.name,
        "business_slug": order.business.slug,
        "customer_id": order.customer_id,
        "customer_name": order.customer.display_name,
        "starts_at": order.starts_at,
        "ends_at": order.ends_at,
        "status": order.status.value,
        "total_cents": order.total_cents,
        "paid_cents": paid,
        "balance_cents": balance,
        "payment_status": payment_status,
        "lines": [
            {
                "id": line.id,
                "kind": line.line_kind,
                "item_id": line.product_id if line.line_kind == "product" else line.package_id,
                "quantity": line.quantity,
                "name": line.pricing_snapshot["name"],
                "unit_price_cents": line.unit_price_cents,
                "line_total_cents": line.line_total_cents,
                "components": line.pricing_snapshot.get("components", []),
            }
            for line in order.lines
            if line.is_current
        ],
        "requests": [
            {
                "id": item.id,
                "kind": item.kind.value,
                "status": item.status.value,
                "reason": item.reason,
                "decision_note": item.decision_note,
                "created_at": item.created_at,
                "decided_at": item.decided_at,
                "decided_by_id": item.decided_by_id,
            }
            for item in order.requests
        ],
        "payments": [
            {
                "id": entry.id,
                "kind": entry.kind.value,
                "status": entry.status.value,
                "amount_cents": entry.amount_cents,
                "method": entry.method.value,
                "reference_number": entry.reference_number,
                "proof_available": entry.proof_data is not None,
                "paid_at": entry.paid_at,
                "notes": entry.notes,
                "submitted_by_id": entry.submitted_by_id,
                "verified_by_id": entry.verified_by_id,
                "submitted_at": entry.submitted_at,
                "decided_at": entry.decided_at,
            }
            for entry in order.payments
        ],
        "history": [
            {
                "action": event.action,
                "details": event.details,
                "created_at": event.created_at,
                "actor_id": event.actor_id,
            }
            for event in order.history
        ],
    }


def _load_order(db: Session, order_id: int) -> RentalOrder:
    order = db.scalar(
        select(RentalOrder)
        .options(
            selectinload(RentalOrder.customer),
            selectinload(RentalOrder.lines),
            selectinload(RentalOrder.requests),
            selectinload(RentalOrder.payments),
            selectinload(RentalOrder.history),
            selectinload(RentalOrder.business),
        )
        .where(RentalOrder.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _order_for_user(db: Session, order_id: int, user: User) -> RentalOrder:
    order = _load_order(db, order_id)
    if user.role != UserRole.CUSTOMER or order.customer_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _add_history(db: Session, order: RentalOrder, actor: User, action: str, details: dict):
    db.add(
        OrderHistory(
            business_id=order.business_id,
            order_id=order.id,
            actor_id=actor.id,
            action=action,
            details=details,
        )
    )


def _persist_lines(db: Session, order: RentalOrder, line_data: list[dict]) -> list[OrderLine]:
    for old_line in order.lines:
        if old_line.is_current:
            old_line.is_current = False
    db.flush()
    lines = [OrderLine(business_id=order.business_id, order_id=order.id, **data) for data in line_data]
    db.add_all(lines)
    db.flush()
    return lines


@api.post("/orders", status_code=status.HTTP_201_CREATED)
def create_order(payload: OrderCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=403, detail="Customer access is required to submit a rental request")
    business = db.scalar(
        select(Business).where(
            Business.id == payload.business_id,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business is None:
        raise HTTPException(status_code=404, detail="Business storefront is not available")
    membership = db.scalar(
        select(BusinessCustomer).where(
            BusinessCustomer.business_id == payload.business_id,
            BusinessCustomer.customer_id == user.id,
        )
    )
    if membership is not None and not membership.is_active:
        raise HTTPException(status_code=403, detail="Your customer account is not active for this business")
    if membership is None:
        membership = BusinessCustomer(business_id=payload.business_id, customer_id=user.id)
        db.add(membership)
        db.flush()
    lock_requested_items(db, payload.lines, payload.business_id)
    lines_data, required, total_cents = build_order_lines(
        db, payload.lines, payload.starts_at, payload.ends_at, payload.business_id
    )
    order = RentalOrder(
        business_id=payload.business_id,
        customer_id=user.id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status=RentalStatus.PENDING_ADMIN,
        total_cents=total_cents,
    )
    db.add(order)
    db.flush()
    lines = _persist_lines(db, order, lines_data)
    allocate_assets(db, order, lines, required)
    _add_history(db, order, user, "submitted", {"status": RentalStatus.PENDING_ADMIN.value, "lines": lines_data})
    db.commit()
    return _order_read(_load_order(db, order.id))


@api.post("/orders/quote")
def quote_order(payload: OrderCreate, db: Session = Depends(get_db)):
    business = db.scalar(
        select(Business).where(
            Business.id == payload.business_id,
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if business is None:
        raise HTTPException(status_code=404, detail="Business storefront is not available")
    line_data, _, total_cents = build_order_lines(
        db, payload.lines, payload.starts_at, payload.ends_at, payload.business_id
    )
    return {"total_cents": total_cents, "lines": line_data, "is_estimate": True}


@api.get("/orders")
def list_orders(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    statement = select(RentalOrder).order_by(RentalOrder.created_at.desc(), RentalOrder.id.desc())
    if user.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=403, detail="Customer access is required")
    statement = statement.where(RentalOrder.customer_id == user.id)
    orders = db.scalars(
        statement.options(
            selectinload(RentalOrder.customer),
            selectinload(RentalOrder.lines),
            selectinload(RentalOrder.requests),
            selectinload(RentalOrder.payments),
            selectinload(RentalOrder.history),
            selectinload(RentalOrder.business),
        )
    )
    return [_order_read(order) for order in orders]


@api.get("/orders/{order_id}")
def get_order(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _order_read(_order_for_user(db, order_id, user))


@api.get("/orders/{order_id}/receipt")
def get_order_receipt(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    order = _order_for_user(db, order_id, user)
    paid, balance, payment_status = _payment_summary(order)
    return {
        "order_id": order.id,
        "customer": order.customer.display_name,
        "rental_period": {"starts_at": order.starts_at, "ends_at": order.ends_at},
        "items": _order_read(order)["lines"],
        "total_cents": order.total_cents,
        "verified_paid_cents": paid,
        "balance_cents": balance,
        "payment_status": payment_status,
        "payment_history": _order_read(order)["payments"],
    }


@api.post("/orders/{order_id}/requests", status_code=status.HTTP_201_CREATED)
def create_order_request(
    order_id: int,
    payload: OrderRequestInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    order = _order_for_user(db, order_id, user)
    if order.status not in {RentalStatus.PENDING_ADMIN, RentalStatus.CONFIRMED}:
        raise HTTPException(status_code=409, detail="This order is not eligible for a change or cancellation request")
    pending = db.scalar(
        select(OrderRequest.id).where(
            OrderRequest.order_id == order.id,
            OrderRequest.status == RequestStatus.PENDING,
        )
    )
    if pending is not None:
        raise HTTPException(status_code=409, detail="This order already has a request awaiting administrator review")
    proposed_data = None
    if payload.kind == RequestKind.MODIFICATION:
        if payload.starts_at is None or payload.ends_at is None or payload.lines is None:
            raise HTTPException(status_code=422, detail="A modification requires dates and replacement items")
        proposed_data = {
            "business_id": order.business_id,
            "starts_at": payload.starts_at.isoformat(),
            "ends_at": payload.ends_at.isoformat(),
            "lines": [line.model_dump() for line in payload.lines],
        }
    request_record = OrderRequest(
        business_id=order.business_id,
        order_id=order.id,
        customer_id=user.id,
        kind=payload.kind,
        reason=payload.reason,
        proposed_data=proposed_data,
        before_data=(
            {
                "starts_at": order.starts_at.isoformat(),
                "ends_at": order.ends_at.isoformat(),
                "lines": _order_read(order)["lines"],
            }
            if payload.kind == RequestKind.MODIFICATION
            else None
        ),
    )
    db.add(request_record)
    db.flush()
    _add_history(db, order, user, f"{payload.kind.value}_requested", {"request_id": request_record.id, "reason": payload.reason})
    db.commit()
    return {"id": request_record.id, "kind": request_record.kind.value, "status": request_record.status.value}


@api.post("/orders/{order_id}/payments", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def submit_payment(
    order_id: int,
    payload: PaymentSubmission,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    order = _order_for_user(db, order_id, user)
    if payload.kind != PaymentEntryKind.PAYMENT:
        raise HTTPException(status_code=422, detail="Customers may submit payment details, not refunds")
    if order.status not in {RentalStatus.PENDING_ADMIN, RentalStatus.CONFIRMED}:
        raise HTTPException(status_code=409, detail="Payments cannot be submitted for this order status")
    entry = PaymentEntry(
        business_id=order.business_id,
        order_id=order.id,
        kind=payload.kind,
        status=PaymentEntryStatus.SUBMITTED,
        amount_cents=payload.amount_cents,
        method=payload.method,
        paid_at=payload.paid_at,
        reference_number=payload.reference_number,
        notes=payload.notes,
        submitted_by_id=user.id,
    )
    db.add(entry)
    db.flush()
    _add_history(
        db,
        order,
        user,
        "payment_submitted",
        {"payment_id": entry.id, "amount_cents": entry.amount_cents},
    )
    db.commit()
    return {"id": entry.id, "status": entry.status.value, "message": "Payment details await administrator verification"}


@api.put("/orders/{order_id}/payments/{payment_id}/proof")
@limiter.limit("10/minute")
async def upload_payment_proof(
    order_id: int,
    payment_id: int,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    order = _order_for_user(db, order_id, user)
    entry = db.scalar(
        select(PaymentEntry).where(
            PaymentEntry.id == payment_id,
            PaymentEntry.order_id == order.id,
            PaymentEntry.business_id == order.business_id,
            PaymentEntry.submitted_by_id == user.id,
        )
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Payment entry not found")
    if entry.status != PaymentEntryStatus.SUBMITTED or entry.kind != PaymentEntryKind.PAYMENT:
        raise HTTPException(status_code=409, detail="Proof can only be attached to a submitted payment")
    entry.proof_data, entry.proof_media_type = await _read_uploaded_image(request)
    _add_history(db, order, user, "payment_proof_uploaded", {"payment_id": entry.id})
    db.commit()
    return {"id": entry.id, "proof_available": True}


@api.get("/orders/{order_id}/payments/{payment_id}/proof")
def payment_proof(
    order_id: int,
    payment_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if user.role == UserRole.CUSTOMER:
        order = _order_for_user(db, order_id, user)
    elif user.role in {UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_STAFF}:
        order = db.scalar(
            select(RentalOrder).where(
                RentalOrder.id == order_id,
                RentalOrder.business_id == _require_business_id(user),
            )
        )
        if order is None:
            raise HTTPException(status_code=404, detail="Payment proof not found")
    else:
        raise HTTPException(status_code=403, detail="Payment proof is not available to this account")
    entry = db.scalar(
        select(PaymentEntry).where(
            PaymentEntry.id == payment_id,
            PaymentEntry.order_id == order.id,
            PaymentEntry.business_id == order.business_id,
        )
    )
    if entry is None or entry.proof_data is None or entry.proof_media_type is None:
        raise HTTPException(status_code=404, detail="Payment proof not found")
    return Response(
        content=entry.proof_data,
        media_type=entry.proof_media_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@api.get("/admin/products")
def admin_products(request: Request, admin: User = Depends(administrator), db: Session = Depends(get_db)):
    products = db.scalars(
        select(Product)
        .options(selectinload(Product.quality_tier), selectinload(Product.business))
        .where(Product.business_id == admin.business_id)
        .order_by(Product.id)
    )
    return [
        _product_read(
            product,
            request,
            db.scalar(
                select(func.count(InventoryAsset.id)).where(
                    InventoryAsset.product_id == product.id,
                    InventoryAsset.condition == AssetCondition.AVAILABLE,
                )
            )
            or 0,
            None,
        )
        for product in products
    ]


def _check_quality(db: Session, quality_tier_id: int, business_id: int):
    if db.scalar(
        select(QualityTier.id).where(
            QualityTier.id == quality_tier_id,
            QualityTier.business_id == business_id,
            QualityTier.is_active.is_(True),
        )
    ) is None:
        raise HTTPException(status_code=422, detail="The selected quality tier is not active for this business")


def _check_category(db: Session, category_name: str, business_id: int):
    if db.scalar(
        select(BusinessCategory.id).where(
            BusinessCategory.business_id == business_id,
            func.lower(func.trim(BusinessCategory.name)) == category_name.strip().lower(),
            BusinessCategory.is_active.is_(True),
        )
    ) is None:
        raise HTTPException(status_code=422, detail="The selected category is not active for this business")


def _product_from_input(payload: ProductCreate | ProductUpdate) -> dict:
    data = payload.model_dump(exclude={"image_url", "initial_stock"})
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Product name is required")
    data["name"] = name
    if "image_url" in payload.model_fields_set:
        data["image_url"] = str(payload.image_url) if payload.image_url else None
    return data


def _check_product_name(
    db: Session,
    payload: ProductCreate | ProductUpdate,
    business_id: int,
    exclude_product_id: int | None = None,
):
    statement = select(Product.id).where(
        Product.business_id == business_id,
        Product.category == payload.category,
        Product.quality_tier_id == payload.quality_tier_id,
        func.lower(func.trim(Product.name)) == payload.name.strip().lower(),
    )
    if exclude_product_id is not None:
        statement = statement.where(Product.id != exclude_product_id)
    if db.scalar(statement) is not None:
        raise HTTPException(
            status_code=409,
            detail="A product with this name, category, and quality classification already exists",
        )


def _product_stock_count(db: Session, product_id: int, business_id: int) -> int:
    return db.scalar(
        select(func.count(InventoryAsset.id)).where(
            InventoryAsset.business_id == business_id,
            InventoryAsset.product_id == product_id,
            InventoryAsset.condition == AssetCondition.AVAILABLE,
        )
    ) or 0


def _add_stock_assets(db: Session, product_id: int, business_id: int, quantity: int):
    existing_tags = set(
        db.scalars(
            select(InventoryAsset.asset_tag).where(
                InventoryAsset.business_id == business_id,
                InventoryAsset.product_id == product_id,
            )
        )
    )
    assets = []
    sequence = 1
    while len(assets) < quantity:
        asset_tag = f"PRD-{product_id:06d}-{sequence:04d}"
        if asset_tag not in existing_tags:
            existing_tags.add(asset_tag)
            assets.append(
                InventoryAsset(
                    business_id=business_id,
                    product_id=product_id,
                    asset_tag=asset_tag,
                    condition=AssetCondition.AVAILABLE,
                )
            )
        sequence += 1
    db.add_all(assets)


@api.post("/admin/products", status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    _check_quality(db, payload.quality_tier_id, business_id)
    _check_category(db, payload.category, business_id)
    _check_product_name(db, payload, business_id)
    product = Product(business_id=business_id, **_product_from_input(payload))
    db.add(product)
    try:
        db.flush()
        _add_stock_assets(db, product.id, business_id, payload.initial_stock)
        _audit(db, admin, business_id, "product_created", "product", product.id, {"name": product.name})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A matching product already exists") from None
    db.refresh(product)
    product.quality_tier
    return _product_read(product, request, _product_stock_count(db, product.id, business_id), None)


@api.put("/admin/products/{product_id}")
def update_product(
    product_id: int,
    payload: ProductUpdate,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    lock_products(db, {product_id}, business_id)
    product = db.scalar(
        select(Product).where(Product.id == product_id, Product.business_id == business_id)
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    _check_quality(db, payload.quality_tier_id, business_id)
    _check_category(db, payload.category, business_id)
    _check_product_name(db, payload, business_id, product.id)
    before_name = product.name
    for key, value in _product_from_input(payload).items():
        setattr(product, key, value)
    try:
        db.flush()
        _audit(
            db,
            admin,
            business_id,
            "product_updated",
            "product",
            product.id,
            {"before_name": before_name, "name": product.name},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A matching product already exists") from None
    db.refresh(product)
    product.quality_tier
    return _product_read(product, request, _product_stock_count(db, product.id, business_id), None)


@api.patch("/admin/products/{product_id}/price")
def update_product_price(
    product_id: int,
    payload: ProductPriceUpdate,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    lock_products(db, {product_id}, business_id)
    product = db.scalar(
        select(Product).where(Product.id == product_id, Product.business_id == business_id)
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.price_cents = payload.price_cents
    _audit(db, admin, business_id, "product_price_updated", "product", product.id, {"price_cents": payload.price_cents})
    db.commit()
    product.quality_tier
    return _product_read(product, request, _product_stock_count(db, product.id, business_id), None)


@api.patch("/admin/products/{product_id}/stock")
def update_product_stock(
    product_id: int,
    payload: ProductStockUpdate,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    lock_products(db, {product_id}, business_id)
    product = db.scalar(
        select(Product).where(Product.id == product_id, Product.business_id == business_id)
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    current_stock = _product_stock_count(db, product_id, business_id)
    if payload.quantity > current_stock:
        _add_stock_assets(db, product_id, business_id, payload.quantity - current_stock)
    elif payload.quantity < current_stock:
        active_allocation = (
            select(InventoryAllocation.id)
            .join(RentalOrder, RentalOrder.id == InventoryAllocation.order_id)
            .where(
                InventoryAllocation.asset_id == InventoryAsset.id,
                InventoryAllocation.released_at.is_(None),
                RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
                InventoryAllocation.ends_at > datetime.now(timezone.utc),
            )
            .exists()
        )
        removable_assets = db.scalars(
            select(InventoryAsset)
            .where(
                InventoryAsset.product_id == product_id,
                InventoryAsset.business_id == business_id,
                InventoryAsset.condition == AssetCondition.AVAILABLE,
                ~active_allocation,
            )
            .order_by(InventoryAsset.id.desc())
            .with_for_update()
        ).all()
        decrease = current_stock - payload.quantity
        if len(removable_assets) < decrease:
            raise HTTPException(
                status_code=409,
                detail="Available stock cannot be reduced below units reserved for active rentals",
            )
        for asset in removable_assets[:decrease]:
            asset.condition = AssetCondition.UNAVAILABLE

    _audit(db, admin, business_id, "product_stock_updated", "product", product.id, {"quantity": payload.quantity})
    db.commit()
    product.quality_tier
    return _product_read(product, request, _product_stock_count(db, product_id, business_id), None)


@api.put("/admin/products/{product_id}/image")
async def upload_product_image(
    product_id: int,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    lock_products(db, {product_id}, business_id)
    product = db.scalar(
        select(Product).where(Product.id == product_id, Product.business_id == business_id)
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    image_data, media_type = await _read_uploaded_image(request)
    product.image_data = image_data
    product.image_media_type = media_type
    product.image_url = None
    _audit(db, admin, business_id, "product_image_uploaded", "product", product.id, {})
    db.commit()
    return {
        "id": product.id,
        "image_url": str(request.url_for("catalog_product_image", product_id=product.id)),
    }


@api.get("/admin/quality-tiers")
def admin_quality_tiers(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    return list(
        db.scalars(
            select(QualityTier)
            .where(QualityTier.business_id == business_id)
            .order_by(QualityTier.name)
        )
    )


@api.get("/admin/packages")
def admin_packages(request: Request, admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    packages = db.scalars(
        select(RentalPackage)
        .options(
            selectinload(RentalPackage.components)
            .selectinload(PackageComponent.product)
            .selectinload(Product.quality_tier),
            selectinload(RentalPackage.business),
        )
        .where(RentalPackage.business_id == business_id)
        .order_by(RentalPackage.name)
    )
    return [_package_read(package, request) for package in packages]


@api.post("/admin/quality-tiers", status_code=status.HTTP_201_CREATED)
def create_quality_tier(
    payload: QualityInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    tier = QualityTier(business_id=business_id, name=payload.name.strip(), is_active=payload.is_active)
    db.add(tier)
    try:
        db.flush()
        _audit(db, admin, business_id, "quality_tier_created", "quality_tier", tier.id, {"name": tier.name})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That quality label already exists for this business") from None
    db.refresh(tier)
    return {"id": tier.id, "name": tier.name, "is_active": tier.is_active}


@api.put("/admin/quality-tiers/{tier_id}")
def update_quality_tier(
    tier_id: int,
    payload: QualityInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    tier = db.scalar(
        select(QualityTier).where(
            QualityTier.id == tier_id,
            QualityTier.business_id == business_id,
        )
    )
    if tier is None:
        raise HTTPException(status_code=404, detail="Quality label not found")
    tier.name = payload.name.strip()
    tier.is_active = payload.is_active
    try:
        db.flush()
        _audit(db, admin, business_id, "quality_tier_updated", "quality_tier", tier.id, {"name": tier.name})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That quality label already exists for this business") from None
    return {"id": tier.id, "name": tier.name, "is_active": tier.is_active}


@api.get("/admin/inventory")
def admin_inventory(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(InventoryAsset, Product)
        .join(Product, Product.id == InventoryAsset.product_id)
        .where(InventoryAsset.business_id == business_id, Product.business_id == business_id)
        .order_by(Product.category, Product.name, InventoryAsset.asset_tag)
    )
    active_allocations = db.execute(
        select(
            InventoryAllocation.asset_id,
            InventoryAllocation.starts_at,
            InventoryAllocation.ends_at,
            RentalOrder.status,
        )
        .join(RentalOrder, RentalOrder.id == InventoryAllocation.order_id)
        .where(
            InventoryAllocation.business_id == business_id,
            RentalOrder.business_id == business_id,
            InventoryAllocation.released_at.is_(None),
            RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
            InventoryAllocation.ends_at > now,
        )
    )
    rental_states: dict[int, str] = {}
    for asset_id, starts_at, ends_at, order_status in active_allocations:
        derived = (
            "currently rented"
            if order_status == RentalStatus.CONFIRMED and starts_at <= now < ends_at
            else "reserved"
        )
        if rental_states.get(asset_id) != "currently rented":
            rental_states[asset_id] = derived
    return [
        {
            "id": asset.id,
            "asset_tag": asset.asset_tag,
            "product_id": product.id,
            "product_name": product.name,
            "category": product.category,
            "condition": asset.condition.value,
            "rental_status": rental_states.get(asset.id, asset.condition.value.replace("_", " ")),
        }
        for asset, product in rows
    ]


@api.post("/admin/inventory", status_code=status.HTTP_201_CREATED)
def create_asset(payload: AssetInput, admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    lock_products(db, {payload.product_id}, business_id)
    product = db.scalar(
        select(Product).where(Product.id == payload.product_id, Product.business_id == business_id)
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    asset = InventoryAsset(
        business_id=business_id,
        product_id=payload.product_id,
        asset_tag=payload.asset_tag.strip(),
        condition=payload.condition,
    )
    db.add(asset)
    try:
        db.flush()
        _audit(db, admin, business_id, "inventory_asset_created", "inventory_asset", asset.id, {"asset_tag": asset.asset_tag})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That asset tag already exists for this product") from None
    db.refresh(asset)
    return {"id": asset.id, "asset_tag": asset.asset_tag, "condition": asset.condition.value}


@api.patch("/admin/inventory/{asset_id}")
def update_asset_condition(
    asset_id: int,
    payload: AssetConditionInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    asset = db.scalar(
        select(InventoryAsset).where(
            InventoryAsset.id == asset_id,
            InventoryAsset.business_id == business_id,
        )
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Inventory asset not found")
    lock_products(db, {asset.product_id}, business_id)
    if payload.condition != AssetCondition.AVAILABLE:
        allocated = db.scalar(
            select(InventoryAllocation.id)
            .join(RentalOrder, RentalOrder.id == InventoryAllocation.order_id)
            .where(
                InventoryAllocation.asset_id == asset.id,
                InventoryAllocation.business_id == business_id,
                InventoryAllocation.released_at.is_(None),
                RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
                InventoryAllocation.ends_at > datetime.now(timezone.utc),
            )
        )
        if allocated is not None:
            raise HTTPException(status_code=409, detail="Release or resolve active reservations before changing condition")
    asset.condition = payload.condition
    _audit(
        db,
        admin,
        business_id,
        "inventory_asset_condition_changed",
        "inventory_asset",
        asset.id,
        {"condition": payload.condition.value},
    )
    db.commit()
    return {"id": asset.id, "condition": asset.condition.value}


def _package_from_input(payload: PackageInput) -> dict:
    data = payload.model_dump(exclude={"image_url", "components"})
    if "image_url" in payload.model_fields_set:
        data["image_url"] = str(payload.image_url) if payload.image_url else None
    return data


def _replace_package_components(
    db: Session,
    package: RentalPackage,
    payload: PackageInput,
    business_id: int,
):
    product_ids = {component.product_id for component in payload.components}
    lock_products(db, product_ids, business_id)
    db.expire_all()
    products = db.scalars(
        select(Product).where(
            Product.id.in_(product_ids),
            Product.business_id == business_id,
            Product.is_active.is_(True),
        )
    ).all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=422, detail="Every package component must reference an active product")
    package.components.clear()
    package.components.extend(
        [
            PackageComponent(
                business_id=business_id,
                product_id=component.product_id,
                quantity=component.quantity,
            )
            for component in payload.components
        ]
    )


@api.post("/admin/packages", status_code=status.HTTP_201_CREATED)
def create_package(
    payload: PackageInput,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    package = RentalPackage(business_id=business_id, **_package_from_input(payload))
    db.add(package)
    db.flush()
    _replace_package_components(db, package, payload, business_id)
    _audit(db, admin, business_id, "package_created", "package", package.id, {"name": package.name})
    db.commit()
    saved_package = db.scalar(
        select(RentalPackage)
        .options(
            selectinload(RentalPackage.components)
            .selectinload(PackageComponent.product)
            .selectinload(Product.quality_tier),
            selectinload(RentalPackage.business),
        )
        .where(RentalPackage.id == package.id, RentalPackage.business_id == business_id)
    )
    if saved_package is None:
        raise HTTPException(status_code=500, detail="Saved package could not be loaded")
    return _package_read(saved_package, request)


@api.put("/admin/packages/{package_id}")
def update_package(
    package_id: int,
    payload: PackageInput,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    package = db.scalar(
        select(RentalPackage)
        .where(RentalPackage.id == package_id, RentalPackage.business_id == business_id)
        .with_for_update()
    )
    if package is None:
        raise HTTPException(status_code=404, detail="Package not found")
    for key, value in _package_from_input(payload).items():
        setattr(package, key, value)
    _replace_package_components(db, package, payload, business_id)
    _audit(db, admin, business_id, "package_updated", "package", package.id, {"name": package.name})
    db.commit()
    package = db.scalar(
        select(RentalPackage)
        .options(
            selectinload(RentalPackage.components)
            .selectinload(PackageComponent.product)
            .selectinload(Product.quality_tier),
            selectinload(RentalPackage.business),
        )
        .where(RentalPackage.id == package_id, RentalPackage.business_id == business_id)
    )
    if package is None:
        raise HTTPException(status_code=500, detail="Updated package could not be loaded")
    return _package_read(package, request)


@api.put("/admin/packages/{package_id}/image")
async def upload_package_image(
    package_id: int,
    request: Request,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_admin(admin)
    package = db.scalar(
        select(RentalPackage)
        .where(RentalPackage.id == package_id, RentalPackage.business_id == business_id)
        .with_for_update()
    )
    if package is None:
        raise HTTPException(status_code=404, detail="Package not found")
    image_data, media_type = await _read_uploaded_image(request)
    package.image_data = image_data
    package.image_media_type = media_type
    package.image_url = None
    _audit(db, admin, business_id, "package_image_uploaded", "package", package.id, {})
    db.commit()
    return {
        "id": package.id,
        "image_url": str(request.url_for("catalog_package_image", package_id=package.id)),
    }


@api.get("/admin/orders")
def admin_orders(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    orders = db.scalars(
        select(RentalOrder)
        .options(
            selectinload(RentalOrder.customer),
            selectinload(RentalOrder.lines),
            selectinload(RentalOrder.requests),
            selectinload(RentalOrder.payments),
            selectinload(RentalOrder.history),
            selectinload(RentalOrder.business),
        )
        .where(RentalOrder.business_id == business_id)
        .order_by(RentalOrder.created_at.desc())
    )
    return [_order_read(order) for order in orders]


@api.get("/admin/customers")
def admin_customers(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    customers = db.scalars(
        select(User)
        .join(BusinessCustomer, BusinessCustomer.customer_id == User.id)
        .where(
            BusinessCustomer.business_id == business_id,
            User.role == UserRole.CUSTOMER,
        )
        .order_by(User.created_at.desc())
    )
    return [
        {
            "id": customer.id,
            "email": customer.email,
            "display_name": customer.display_name,
            "phone": customer.phone,
            "is_active": db.scalar(
                select(BusinessCustomer.is_active).where(
                    BusinessCustomer.business_id == business_id,
                    BusinessCustomer.customer_id == customer.id,
                )
            ),
            "created_at": customer.created_at,
        }
        for customer in customers
    ]


@api.patch("/admin/customers/{customer_id}/active")
def set_customer_active(
    customer_id: int,
    payload: ActiveUpdate,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    membership = db.scalar(
        select(BusinessCustomer).where(
            BusinessCustomer.business_id == business_id,
            BusinessCustomer.customer_id == customer_id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    membership.is_active = payload.is_active
    _audit(
        db,
        admin,
        business_id,
        "business_customer_status_changed",
        "customer",
        customer_id,
        {"is_active": payload.is_active},
    )
    db.commit()
    return {"id": customer_id, "is_active": membership.is_active}


@api.patch("/admin/orders/{order_id}/status")
def decide_order_status(
    order_id: int,
    payload: OrderStatusInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    order = db.scalar(
        select(RentalOrder)
        .where(RentalOrder.id == order_id, RentalOrder.business_id == business_id)
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    allowed = {
        RentalStatus.PENDING_ADMIN: {RentalStatus.CONFIRMED, RentalStatus.REJECTED},
        RentalStatus.CONFIRMED: {RentalStatus.COMPLETED},
    }
    if payload.status not in allowed.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move an order from {order.status.value} to {payload.status.value}")
    old_status = order.status
    order.status = payload.status
    if payload.status in {RentalStatus.REJECTED, RentalStatus.COMPLETED}:
        release_allocations(db, order)
    _add_history(
        db,
        order,
        admin,
        "status_changed",
        {"from": old_status.value, "to": payload.status.value, "note": payload.note},
    )
    db.commit()
    return _order_read(_load_order(db, order.id))


@api.get("/admin/requests")
def admin_requests(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    requests = db.scalars(
        select(OrderRequest)
        .where(
            OrderRequest.business_id == business_id,
            OrderRequest.status == RequestStatus.PENDING,
        )
        .order_by(OrderRequest.created_at)
    )
    return [
        {
            "id": item.id,
            "order_id": item.order_id,
            "customer_id": item.customer_id,
            "kind": item.kind.value,
            "reason": item.reason,
            "proposed_data": item.proposed_data,
            "before_data": item.before_data,
            "created_at": item.created_at,
        }
        for item in requests
    ]


@api.post("/admin/orders/{order_id}/requests/{request_id}/decision")
def decide_order_request(
    order_id: int,
    request_id: int,
    payload: RequestDecisionInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    order = db.scalar(
        select(RentalOrder)
        .where(RentalOrder.id == order_id, RentalOrder.business_id == business_id)
        .with_for_update()
    )
    request_record = db.scalar(
        select(OrderRequest).where(
            OrderRequest.id == request_id,
            OrderRequest.order_id == order_id,
            OrderRequest.business_id == business_id,
        ).with_for_update()
    )
    if order is None or request_record is None:
        raise HTTPException(status_code=404, detail="Order request not found")
    if request_record.status != RequestStatus.PENDING:
        raise HTTPException(status_code=409, detail="This request has already been decided")
    if order.status not in {RentalStatus.PENDING_ADMIN, RentalStatus.CONFIRMED}:
        raise HTTPException(status_code=409, detail="The order is no longer eligible for this request")

    before_status = order.status
    if payload.approved and request_record.kind == RequestKind.MODIFICATION:
        proposed = request_record.proposed_data
        candidate = OrderCreate.model_validate(proposed)
        if candidate.business_id != business_id:
            raise HTTPException(status_code=422, detail="The requested rental must remain with this business")
        lock_requested_items(db, candidate.lines, business_id)
        line_data, required, total = build_order_lines(
            db, candidate.lines, candidate.starts_at, candidate.ends_at, business_id
        )
        before = {
            "starts_at": order.starts_at.isoformat(),
            "ends_at": order.ends_at.isoformat(),
            "lines": _order_read(_load_order(db, order.id))["lines"],
            "total_cents": order.total_cents,
        }
        release_allocations(db, order)
        order.starts_at = candidate.starts_at
        order.ends_at = candidate.ends_at
        order.total_cents = total
        lines = _persist_lines(db, order, line_data)
        allocate_assets(db, order, lines, required)
        _add_history(
            db,
            order,
            admin,
            "modification_approved",
            {
                "request_id": request_record.id,
                "before": before,
                "after": {
                    "starts_at": order.starts_at.isoformat(),
                    "ends_at": order.ends_at.isoformat(),
                    "lines": line_data,
                    "total_cents": total,
                },
            },
        )
    elif payload.approved and request_record.kind == RequestKind.CANCELLATION:
        order.status = RentalStatus.CANCELLED
        release_allocations(db, order)
        _add_history(
            db,
            order,
            admin,
            "cancellation_approved",
            {"request_id": request_record.id, "reason": request_record.reason, "note": payload.note},
        )
    else:
        _add_history(
            db,
            order,
            admin,
            f"{request_record.kind.value}_rejected",
            {"request_id": request_record.id, "reason": request_record.reason, "note": payload.note},
        )

    request_record.status = RequestStatus.APPROVED if payload.approved else RequestStatus.REJECTED
    request_record.decision_note = payload.note
    request_record.decided_by_id = admin.id
    request_record.decided_at = datetime.now(timezone.utc)
    if request_record.kind == RequestKind.CANCELLATION and payload.approved:
        _add_history(db, order, admin, "status_changed", {"from": before_status.value, "to": order.status.value})
    db.commit()
    return _order_read(_load_order(db, order.id))


def _payment_admin_result(entry: PaymentEntry) -> dict:
    return {
        "id": entry.id,
        "kind": entry.kind.value,
        "status": entry.status.value,
        "amount_cents": entry.amount_cents,
        "method": entry.method.value,
        "reference_number": entry.reference_number,
        "proof_available": entry.proof_data is not None,
        "paid_at": entry.paid_at,
        "submitted_by_id": entry.submitted_by_id,
        "verified_by_id": entry.verified_by_id,
        "submitted_at": entry.submitted_at,
        "decided_at": entry.decided_at,
    }


@api.post("/admin/orders/{order_id}/payments", status_code=status.HTTP_201_CREATED)
def record_manual_payment(
    order_id: int,
    payload: PaymentSubmission,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    order = db.scalar(
        select(RentalOrder).where(
            RentalOrder.id == order_id,
            RentalOrder.business_id == business_id,
        )
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in {RentalStatus.PENDING_ADMIN, RentalStatus.CONFIRMED}:
        raise HTTPException(status_code=409, detail="Payments cannot be recorded for this order status")
    if payload.kind == PaymentEntryKind.REFUND:
        paid, _, _ = _payment_summary(_load_order(db, order_id))
        if payload.amount_cents > paid:
            raise HTTPException(status_code=409, detail="A refund cannot exceed the verified amount received")
    entry = PaymentEntry(
        business_id=business_id,
        order_id=order_id,
        kind=payload.kind,
        status=PaymentEntryStatus.VERIFIED,
        amount_cents=payload.amount_cents,
        method=payload.method,
        reference_number=payload.reference_number,
        paid_at=payload.paid_at,
        notes=payload.notes,
        submitted_by_id=admin.id,
        verified_by_id=admin.id,
        decided_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    _audit(db, admin, business_id, "manual_payment_recorded", "payment", entry.id, {"kind": payload.kind.value})
    db.commit()
    return _payment_admin_result(entry)


@api.post("/admin/orders/{order_id}/payments/{payment_id}/decision")
def decide_payment(
    order_id: int,
    payment_id: int,
    payload: PaymentDecisionInput,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    entry = db.scalar(
        select(PaymentEntry)
        .where(
            PaymentEntry.id == payment_id,
            PaymentEntry.order_id == order_id,
            PaymentEntry.business_id == business_id,
        )
        .with_for_update()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Payment entry not found")
    if entry.status != PaymentEntryStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="Only submitted payment details can be verified or rejected")
    entry.status = PaymentEntryStatus.VERIFIED if payload.approved else PaymentEntryStatus.REJECTED
    entry.verified_by_id = admin.id
    entry.decided_at = datetime.now(timezone.utc)
    if payload.note:
        entry.notes = f"{entry.notes or ''}\nDecision: {payload.note}".strip()
    _audit(
        db,
        admin,
        business_id,
        "payment_decided",
        "payment",
        entry.id,
        {"approved": payload.approved, "note": payload.note},
    )
    db.commit()
    return _payment_admin_result(entry)


@api.get("/admin/reports/summary")
def report_summary(admin: User = Depends(administrator), db: Session = Depends(get_db)):
    business_id = _require_business_id(admin)
    order_count = db.scalar(
        select(func.count(RentalOrder.id)).where(RentalOrder.business_id == business_id)
    ) or 0
    active_assets = db.scalar(
        select(func.count(InventoryAsset.id)).where(
            InventoryAsset.business_id == business_id,
            InventoryAsset.condition == AssetCondition.AVAILABLE,
        )
    ) or 0
    verified_entries = db.scalars(
        select(PaymentEntry).where(
            PaymentEntry.business_id == business_id,
            PaymentEntry.status == PaymentEntryStatus.VERIFIED,
        )
    )
    collections_cents = sum(
        entry.amount_cents if entry.kind == PaymentEntryKind.PAYMENT else -entry.amount_cents
        for entry in verified_entries
    )
    return {
        "orders": order_count,
        "assets_in_available_condition": active_assets,
        "verified_collections_cents": max(collections_cents, 0),
        "collections_note": "Verified offline payments less recorded refunds; not an accounting revenue report.",
    }
