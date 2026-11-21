from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import hashlib
import logging
import secrets
import smtplib

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.routes import (
    _as_utc,
    _audit,
    _available_assets,
    _business_read,
    _ilike_term,
    _load_order,
    _order_read,
    _package_read,
    _product_read,
    _require_business_admin,
    _require_business_id,
    _stock_counts_by_product,
    limiter,
)
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, password_fingerprint, verify_password
from app.dependencies import administrator, current_user, platform_administrator
from app.models import (
    Business,
    BusinessStatus,
    InventoryAllocation,
    InventoryAsset,
    Notification,
    OrderLine,
    PackageComponent,
    PasswordResetToken,
    PaymentEntry,
    PaymentEntryKind,
    PaymentEntryStatus,
    PaymentMethod,
    PlatformSetting,
    Product,
    RentalOrder,
    RentalPackage,
    RentalStatus,
    User,
    UserRole,
)
from app.schemas import ActiveUpdate, ForgotPasswordInput, PasswordChangeInput, ResetPasswordInput
from app.services.inventory import ACTIVE_ALLOCATION_STATUSES

logger = logging.getLogger("karaokewebapp")
extensions = APIRouter(prefix="/api")


def _send_reset_email(recipient: str, reset_url: str) -> bool:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_from_email:
        return False
    msg = EmailMessage()
    msg["Subject"] = "Reset your KARAOKEWEBAPP password"
    msg["From"] = settings.smtp_from_email
    msg["To"] = recipient
    msg.set_content(
        "A password reset was requested for your KARAOKEWEBAPP account.\n\n"
        f"Open this link within 30 minutes to set a new password:\n{reset_url}\n\n"
        "If you did not request this change, you can ignore this message."
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username and settings.smtp_password:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(msg)
    return True


@extensions.put("/users/me/password")
@limiter.limit("10/hour")
def change_password(
    payload: PasswordChangeInput,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="New password must be different from your current password",
        )
    user_id = user.id
    new_hash = hash_password(payload.new_password)
    user.password_hash = new_hash
    _audit(db, user, user.business_id, "password_changed", "user", user_id, {})
    db.commit()
    return {
        "updated": True,
        "access_token": create_access_token(str(user_id), password_version=password_fingerprint(new_hash)),
        "message": "Password updated successfully.",
    }


@extensions.get("/users/me/business-application")
def my_business_application(
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if user.business_id is None:
        raise HTTPException(status_code=404, detail="No business application is associated with this account")
    business = db.get(Business, user.business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business record not found")
    return {
        **_business_read(business, request),
        "approved_at": business.approved_at,
    }


@extensions.post("/auth/forgot-password")
@limiter.limit("5/hour")
def forgot_password(payload: ForgotPasswordInput, request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    support_setting = db.get(PlatformSetting, "support_email")
    support_email = support_setting.value.strip() if support_setting and support_setting.value.strip() else None
    email_delivery_configured = bool(settings.smtp_host and settings.smtp_from_email)

    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active.is_(True)))
    if user is not None and email_delivery_configured:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
        db.commit()
        reset_url = f"{settings.app_base_url.rstrip('/')}/reset-password?token={raw_token}"
        try:
            _send_reset_email(user.email, reset_url)
        except Exception:
            logger.exception("Failed to send password reset email")

    if email_delivery_configured:
        return {
            "email_delivery_configured": True,
            "support_email": support_email,
            "message": "If an active account matches that email, password reset instructions have been sent.",
        }
    return {
        "email_delivery_configured": False,
        "support_email": support_email,
        "message": (
            "Automated reset email delivery is not configured on this server. "
            + (
                f"Contact platform support at {support_email} for a one-time reset token."
                if support_email
                else "Contact the platform administrator for a one-time reset token."
            )
        ),
    }


@extensions.post("/auth/reset-password")
@limiter.limit("10/hour")
def reset_password(payload: ResetPasswordInput, request: Request, db: Session = Depends(get_db)):
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    record = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == token_hash)
        .with_for_update()
    )
    if record is None or record.used_at is not None or _as_utc(record.expires_at) <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset token is invalid or has expired.",
        )
    user = db.scalar(select(User).where(User.id == record.user_id, User.is_active.is_(True)))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset token is invalid or has expired.",
        )
    user.password_hash = hash_password(payload.new_password)
    record.used_at = now
    other_tokens = db.scalars(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.id != record.id,
        )
    )
    for token in other_tokens:
        token.used_at = now
    _audit(db, user, user.business_id, "password_reset_completed", "user", user.id, {})
    db.commit()
    return {"reset": True, "message": "Your password has been reset. You can now sign in."}


@extensions.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    statement = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        statement = statement.where(Notification.is_read.is_(False))
    items = db.scalars(statement.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)).all()
    unread_count = (
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
            )
        )
        or 0
    )
    return {
        "unread_count": unread_count,
        "items": [
            {
                "id": item.id,
                "business_id": item.business_id,
                "kind": item.kind,
                "title": item.title,
                "message": item.message,
                "link": item.link,
                "is_read": item.is_read,
                "created_at": item.created_at,
            }
            for item in items
        ],
    }


@extensions.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    item.is_read = True
    db.commit()
    return {"id": item.id, "is_read": True}


@extensions.post("/notifications/read-all")
def mark_all_notifications_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
        )
    ).all()
    for item in items:
        item.is_read = True
    db.commit()
    return {"marked_read": len(items)}


@extensions.get("/catalog/products/{product_id}")
def catalog_product_detail(
    product_id: int,
    request: Request,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for availability")
    if starts_at is not None:
        if starts_at.tzinfo is None or ends_at is None or ends_at.tzinfo is None:
            raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")
        starts_at = _as_utc(starts_at)
        ends_at = _as_utc(ends_at)
        if ends_at <= starts_at:
            raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")

    product = db.scalar(
        select(Product)
        .join(Business, Business.id == Product.business_id)
        .options(selectinload(Product.quality_tier), selectinload(Product.business))
        .where(
            Product.id == product_id,
            Product.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    stock = _stock_counts_by_product(db, [product.id]).get(product.id, 0)
    available = len(_available_assets(db, product.id, starts_at, ends_at)) if starts_at and ends_at else None
    return {
        **_product_read(product, request, stock, available),
        "business": _business_read(product.business, request),
    }


@extensions.get("/catalog/packages/{package_id}")
def catalog_package_detail(
    package_id: int,
    request: Request,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for availability")
    if starts_at is not None:
        if starts_at.tzinfo is None or ends_at is None or ends_at.tzinfo is None:
            raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")
        starts_at = _as_utc(starts_at)
        ends_at = _as_utc(ends_at)
        if ends_at <= starts_at:
            raise HTTPException(status_code=422, detail="Provide a valid timezone-aware rental window")

    package = db.scalar(
        select(RentalPackage)
        .join(Business, Business.id == RentalPackage.business_id)
        .options(
            selectinload(RentalPackage.components)
            .selectinload(PackageComponent.product)
            .selectinload(Product.quality_tier),
            selectinload(RentalPackage.business),
        )
        .where(
            RentalPackage.id == package_id,
            RentalPackage.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE.value,
            Business.is_listed.is_(True),
        )
    )
    if package is None or not package.components or any(
        component.business_id != package.business_id
        or component.product.business_id != package.business_id
        or not component.product.is_active
        for component in package.components
    ):
        raise HTTPException(status_code=404, detail="Rental package not found")
    available = None
    if starts_at is not None and ends_at is not None:
        available = min(
            len(_available_assets(db, component.product_id, starts_at, ends_at)) // component.quantity
            for component in package.components
        )
    return {
        **_package_read(package, request, available),
        "business": _business_read(package.business, request),
    }


@extensions.delete("/admin/packages/{package_id}")
def delete_package(
    package_id: int,
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
    in_orders = db.scalar(select(OrderLine.id).where(OrderLine.package_id == package.id).limit(1))
    if in_orders is not None:
        raise HTTPException(
            status_code=409,
            detail="This package is referenced by existing rental orders. Deactivate it instead.",
        )
    package_name = package.name
    db.delete(package)
    _audit(db, admin, business_id, "package_deleted", "package", package_id, {"name": package_name})
    db.commit()
    return {"id": package_id, "deleted": True}


@extensions.delete("/admin/inventory/{asset_id}")
def delete_asset(
    asset_id: int,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    asset = db.scalar(
        select(InventoryAsset)
        .where(InventoryAsset.id == asset_id, InventoryAsset.business_id == business_id)
        .with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Inventory asset not found")
    has_allocations = db.scalar(
        select(InventoryAllocation.id).where(InventoryAllocation.asset_id == asset.id).limit(1)
    )
    if has_allocations is not None:
        raise HTTPException(
            status_code=409,
            detail="This unit has rental allocation history. Mark it unavailable instead of deleting it.",
        )
    asset_tag = asset.asset_tag
    db.delete(asset)
    _audit(db, admin, business_id, "inventory_asset_deleted", "inventory_asset", asset_id, {"asset_tag": asset_tag})
    db.commit()
    return {"id": asset_id, "deleted": True}


@extensions.get("/admin/orders/{order_id}")
def admin_order_detail(
    order_id: int,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    order = db.scalar(
        select(RentalOrder).where(RentalOrder.id == order_id, RentalOrder.business_id == business_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    loaded = _load_order(db, order.id)
    allocations = db.execute(
        select(InventoryAllocation, InventoryAsset.asset_tag, Product.name)
        .join(InventoryAsset, InventoryAsset.id == InventoryAllocation.asset_id)
        .join(Product, Product.id == InventoryAsset.product_id)
        .where(
            InventoryAllocation.order_id == order.id,
            InventoryAllocation.business_id == business_id,
        )
        .order_by(InventoryAllocation.id)
    ).all()
    return {
        **_order_read(loaded),
        "customer_email": loaded.customer.email,
        "customer_phone": loaded.customer.phone,
        "allocations": [
            {
                "id": alloc.id,
                "asset_id": alloc.asset_id,
                "asset_tag": asset_tag,
                "product_name": product_name,
                "starts_at": alloc.starts_at,
                "ends_at": alloc.ends_at,
                "released_at": alloc.released_at,
            }
            for alloc, asset_tag, product_name in allocations
        ],
    }


@extensions.get("/admin/payments")
def admin_payments(
    status_filter: PaymentEntryStatus | None = Query(default=None, alias="status"),
    method: PaymentMethod | None = None,
    kind: PaymentEntryKind | None = None,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    business_id = _require_business_id(admin)
    statement = (
        select(PaymentEntry, RentalOrder, User.display_name)
        .join(RentalOrder, RentalOrder.id == PaymentEntry.order_id)
        .join(User, User.id == RentalOrder.customer_id)
        .where(
            PaymentEntry.business_id == business_id,
            RentalOrder.business_id == business_id,
        )
    )
    if status_filter:
        statement = statement.where(PaymentEntry.status == status_filter)
    if method:
        statement = statement.where(PaymentEntry.method == method)
    if kind:
        statement = statement.where(PaymentEntry.kind == kind)
    rows = db.execute(statement.order_by(PaymentEntry.submitted_at.desc(), PaymentEntry.id.desc())).all()
    return [
        {
            "id": entry.id,
            "order_id": entry.order_id,
            "order_status": order.status.value,
            "customer_id": order.customer_id,
            "customer_name": customer_name,
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
        for entry, order, customer_name in rows
    ]


@extensions.get("/admin/calendar")
def admin_calendar(
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    admin: User = Depends(administrator),
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for calendar filtering")
    if starts_at is not None:
        if starts_at.tzinfo is None or ends_at is None or ends_at.tzinfo is None:
            raise HTTPException(status_code=422, detail="Provide timezone-aware calendar dates")
        starts_at = _as_utc(starts_at)
        ends_at = _as_utc(ends_at)
        if ends_at <= starts_at:
            raise HTTPException(status_code=422, detail="ends_at must be later than starts_at")

    business_id = _require_business_id(admin)
    statement = (
        select(RentalOrder)
        .options(selectinload(RentalOrder.customer), selectinload(RentalOrder.lines))
        .where(
            RentalOrder.business_id == business_id,
            RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    )
    if starts_at is not None and ends_at is not None:
        statement = statement.where(RentalOrder.starts_at < ends_at, RentalOrder.ends_at > starts_at)
    orders = db.scalars(statement.order_by(RentalOrder.starts_at.asc(), RentalOrder.id.asc())).all()
    order_ids = [order.id for order in orders]
    allocations_by_order: dict[int, list[dict]] = {}
    if order_ids:
        alloc_rows = db.execute(
            select(InventoryAllocation.order_id, InventoryAsset.asset_tag, Product.name)
            .join(InventoryAsset, InventoryAsset.id == InventoryAllocation.asset_id)
            .join(Product, Product.id == InventoryAsset.product_id)
            .where(
                InventoryAllocation.business_id == business_id,
                InventoryAllocation.order_id.in_(order_ids),
                InventoryAllocation.released_at.is_(None),
            )
            .order_by(InventoryAsset.asset_tag)
        ).all()
        for oid, tag, pname in alloc_rows:
            allocations_by_order.setdefault(oid, []).append({"asset_tag": tag, "product_name": pname})
    return [
        {
            "order_id": order.id,
            "customer_name": order.customer.display_name,
            "starts_at": order.starts_at,
            "ends_at": order.ends_at,
            "status": order.status.value,
            "total_cents": order.total_cents,
            "items": [
                {"name": line.pricing_snapshot["name"], "quantity": line.quantity, "kind": line.line_kind}
                for line in order.lines
                if line.is_current
            ],
            "allocated_assets": allocations_by_order.get(order.id, []),
        }
        for order in orders
    ]


@extensions.get("/platform/users")
def platform_users(
    role: UserRole | None = None,
    search: str | None = Query(default=None, max_length=120),
    is_active: bool | None = None,
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    statement = select(User, Business.name).outerjoin(Business, Business.id == User.business_id)
    if role:
        statement = statement.where(User.role == role)
    if is_active is not None:
        statement = statement.where(User.is_active.is_(is_active))
    if search and search.strip():
        term = _ilike_term(search)
        statement = statement.where(
            User.display_name.ilike(term, escape="\\") | User.email.ilike(term, escape="\\")
        )
    rows = db.execute(statement.order_by(User.created_at.desc(), User.id.desc())).all()
    order_counts = {
        customer_id: count
        for customer_id, count in db.execute(
            select(RentalOrder.customer_id, func.count(RentalOrder.id)).group_by(RentalOrder.customer_id)
        )
    }
    return [
        {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "phone": user.phone,
            "role": user.role.value,
            "business_id": user.business_id,
            "business_name": business_name,
            "is_active": user.is_active,
            "order_count": order_counts.get(user.id, 0),
            "created_at": user.created_at,
        }
        for user, business_name in rows
    ]


@extensions.patch("/platform/users/{user_id}/active")
def platform_set_user_active(
    user_id: int,
    payload: ActiveUpdate,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    if user_id == platform_admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own platform administrator account")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = payload.is_active
    _audit(
        db,
        platform_admin,
        target.business_id,
        "platform_user_status_changed",
        "user",
        target.id,
        {"is_active": payload.is_active, "role": target.role.value},
    )
    db.commit()
    return {"id": target.id, "is_active": target.is_active}


@extensions.get("/platform/products")
def platform_products(
    request: Request,
    business_id: int | None = None,
    search: str | None = Query(default=None, max_length=120),
    is_active: bool | None = None,
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    statement = (
        select(Product)
        .options(selectinload(Product.quality_tier), selectinload(Product.business))
    )
    if business_id is not None:
        statement = statement.where(Product.business_id == business_id)
    if is_active is not None:
        statement = statement.where(Product.is_active.is_(is_active))
    if search and search.strip():
        term = _ilike_term(search)
        statement = statement.where(
            Product.name.ilike(term, escape="\\") | Product.category.ilike(term, escape="\\")
        )
    products = list(db.scalars(statement.order_by(Product.business_id, Product.name, Product.id)))
    stock_counts = _stock_counts_by_product(db, [p.id for p in products])
    return [_product_read(p, request, stock_counts.get(p.id, 0), None) for p in products]


@extensions.patch("/platform/products/{product_id}/active")
def platform_set_product_active(
    product_id: int,
    payload: ActiveUpdate,
    platform_admin: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = payload.is_active
    _audit(
        db,
        platform_admin,
        product.business_id,
        "platform_product_status_changed",
        "product",
        product.id,
        {"is_active": payload.is_active, "name": product.name},
    )
    db.commit()
    return {"id": product.id, "is_active": product.is_active}


@extensions.get("/platform/orders")
def platform_orders(
    business_id: int | None = None,
    status_filter: RentalStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    statement = (
        select(RentalOrder)
        .options(
            selectinload(RentalOrder.customer),
            selectinload(RentalOrder.lines),
            selectinload(RentalOrder.requests),
            selectinload(RentalOrder.payments),
            selectinload(RentalOrder.history),
            selectinload(RentalOrder.business),
        )
    )
    if business_id is not None:
        statement = statement.where(RentalOrder.business_id == business_id)
    if status_filter:
        statement = statement.where(RentalOrder.status == status_filter)
    orders = db.scalars(statement.order_by(RentalOrder.created_at.desc(), RentalOrder.id.desc()).limit(limit))
    return [_order_read(order) for order in orders]


@extensions.get("/platform/payments")
def platform_payments(
    business_id: int | None = None,
    status_filter: PaymentEntryStatus | None = Query(default=None, alias="status"),
    method: PaymentMethod | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    statement = (
        select(PaymentEntry, Business.name, RentalOrder.customer_id, User.display_name)
        .join(Business, Business.id == PaymentEntry.business_id)
        .join(RentalOrder, RentalOrder.id == PaymentEntry.order_id)
        .join(User, User.id == RentalOrder.customer_id)
    )
    if business_id is not None:
        statement = statement.where(PaymentEntry.business_id == business_id)
    if status_filter:
        statement = statement.where(PaymentEntry.status == status_filter)
    if method:
        statement = statement.where(PaymentEntry.method == method)
    rows = db.execute(statement.order_by(PaymentEntry.submitted_at.desc(), PaymentEntry.id.desc()).limit(limit)).all()
    return [
        {
            "id": entry.id,
            "business_id": entry.business_id,
            "business_name": business_name,
            "order_id": entry.order_id,
            "customer_id": customer_id,
            "customer_name": customer_name,
            "kind": entry.kind.value,
            "status": entry.status.value,
            "amount_cents": entry.amount_cents,
            "method": entry.method.value,
            "reference_number": entry.reference_number,
            "paid_at": entry.paid_at,
            "submitted_at": entry.submitted_at,
            "decided_at": entry.decided_at,
        }
        for entry, business_name, customer_id, customer_name in rows
    ]


@extensions.get("/platform/reports/summary")
def platform_reports_summary(
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    _: User = Depends(platform_administrator),
    db: Session = Depends(get_db),
):
    if (starts_at is None) != (ends_at is None):
        raise HTTPException(status_code=422, detail="Both starts_at and ends_at are required for date filtering")
    if starts_at is not None:
        if starts_at.tzinfo is None or ends_at is None or ends_at.tzinfo is None:
            raise HTTPException(status_code=422, detail="Provide timezone-aware report dates")
        starts_at = _as_utc(starts_at)
        ends_at = _as_utc(ends_at)
        if ends_at <= starts_at:
            raise HTTPException(status_code=422, detail="ends_at must be later than starts_at")

    order_stmt = select(RentalOrder)
    payment_stmt = select(PaymentEntry).where(PaymentEntry.status == PaymentEntryStatus.VERIFIED)
    if starts_at is not None and ends_at is not None:
        order_stmt = order_stmt.where(RentalOrder.created_at >= starts_at, RentalOrder.created_at <= ends_at)
        payment_stmt = payment_stmt.where(PaymentEntry.paid_at >= starts_at, PaymentEntry.paid_at <= ends_at)

    orders = list(db.scalars(order_stmt))
    payments = list(db.scalars(payment_stmt))
    businesses = {b.id: b for b in db.scalars(select(Business).order_by(Business.name))}

    orders_by_status = {item.value: 0 for item in RentalStatus}
    per_business: dict[int, dict] = {
        bid: {
            "business_id": bid,
            "business_name": b.name,
            "status": b.status,
            "orders": 0,
            "active_order_value_cents": 0,
            "verified_collections_cents": 0,
        }
        for bid, b in businesses.items()
    }
    total_order_value_cents = 0
    for order in orders:
        orders_by_status[order.status.value] = orders_by_status.get(order.status.value, 0) + 1
        bucket = per_business.get(order.business_id)
        if bucket:
            bucket["orders"] += 1
        if order.status in {
            RentalStatus.PENDING_ADMIN,
            RentalStatus.UNDER_REVIEW,
            RentalStatus.CONFIRMED,
            RentalStatus.ONGOING,
            RentalStatus.COMPLETED,
        }:
            total_order_value_cents += order.total_cents
            if bucket:
                bucket["active_order_value_cents"] += order.total_cents

    total_collections_cents = 0
    for entry in payments:
        delta = entry.amount_cents if entry.kind == PaymentEntryKind.PAYMENT else -entry.amount_cents
        total_collections_cents += delta
        bucket = per_business.get(entry.business_id)
        if bucket:
            bucket["verified_collections_cents"] += delta

    for bucket in per_business.values():
        bucket["verified_collections_cents"] = max(bucket["verified_collections_cents"], 0)

    return {
        "orders": len(orders),
        "orders_by_status": orders_by_status,
        "total_order_value_cents": total_order_value_cents,
        "verified_collections_cents": max(total_collections_cents, 0),
        "businesses": list(per_business.values()),
    }
