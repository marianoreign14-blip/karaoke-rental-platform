from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models import (
    AssetCondition,
    InventoryAllocation,
    InventoryAsset,
    OrderLine,
    Product,
    RentalOrder,
    RentalPackage,
    RentalStatus,
)
from app.schemas import OrderLineInput

ACTIVE_ALLOCATION_STATUSES = (RentalStatus.PENDING_ADMIN, RentalStatus.CONFIRMED)


def price_configured(item: Product | RentalPackage) -> bool:
    if item.price_cents is None or item.pricing_basis is None:
        return False
    return item.pricing_basis == "per_rental" or (
        item.pricing_basis == "duration"
        and item.billing_interval_minutes is not None
        and item.rounding_rule in {"ceil", "pro_rata"}
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def calculate_line_total(
    item: Product | RentalPackage,
    quantity: int,
    starts_at: datetime,
    ends_at: datetime,
) -> int:
    if not price_configured(item):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pricing must be configured by an administrator for {item.name} before checkout.",
        )
    if item.price_cents is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A rental price is not configured")
    price_cents = item.price_cents
    units = Decimal(1)
    if item.pricing_basis == "duration":
        if item.billing_interval_minutes is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A billing interval is not configured")
        minutes = Decimal(str((_as_utc(ends_at) - _as_utc(starts_at)).total_seconds())) / Decimal(60)
        raw_units = minutes / Decimal(item.billing_interval_minutes)
        if item.rounding_rule == "ceil":
            units = raw_units.to_integral_value(rounding=ROUND_CEILING)
        else:
            units = raw_units
    total = Decimal(price_cents) * units * quantity
    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_order_lines(
    db: Session,
    requested_lines: list[OrderLineInput],
    starts_at: datetime,
    ends_at: datetime,
    business_id: int,
) -> tuple[list[dict], dict[int, int], int]:
    result: list[dict] = []
    required_assets: dict[int, int] = {}
    total_cents = 0

    for requested in requested_lines:
        if requested.kind == "product":
            item = db.scalar(
                select(Product).where(Product.id == requested.item_id, Product.business_id == business_id)
            )
            if item is None or not item.is_active:
                raise HTTPException(status_code=404, detail="An order product is unavailable")
            line_total = calculate_line_total(item, requested.quantity, starts_at, ends_at)
            result.append(
                {
                    "line_kind": "product",
                    "product_id": item.id,
                    "package_id": None,
                    "quantity": requested.quantity,
                    "unit_price_cents": item.price_cents,
                    "line_total_cents": line_total,
                    "pricing_snapshot": {
                        "name": item.name,
                        "pricing_basis": item.pricing_basis,
                        "billing_interval_minutes": item.billing_interval_minutes,
                        "rounding_rule": item.rounding_rule,
                    },
                }
            )
            required_assets[item.id] = required_assets.get(item.id, 0) + requested.quantity
        else:
            package = db.scalar(
                select(RentalPackage).where(
                    RentalPackage.id == requested.item_id,
                    RentalPackage.business_id == business_id,
                )
            )
            if package is None or not package.is_active:
                raise HTTPException(status_code=404, detail="An order package is unavailable")
            if not package.components:
                raise HTTPException(status_code=409, detail=f"{package.name} has no inventory components")
            line_total = calculate_line_total(package, requested.quantity, starts_at, ends_at)
            component_snapshot = []
            for component in package.components:
                product = component.product
                if (
                    component.business_id != business_id
                    or product.business_id != business_id
                    or not product.is_active
                ):
                    raise HTTPException(status_code=409, detail=f"{product.name} is not available for rental")
                required_assets[product.id] = (
                    required_assets.get(product.id, 0) + component.quantity * requested.quantity
                )
                component_snapshot.append(
                    {"product_id": product.id, "name": product.name, "quantity": component.quantity}
                )
            result.append(
                {
                    "line_kind": "package",
                    "product_id": None,
                    "package_id": package.id,
                    "quantity": requested.quantity,
                    "unit_price_cents": package.price_cents,
                    "line_total_cents": line_total,
                    "pricing_snapshot": {
                        "name": package.name,
                        "pricing_basis": package.pricing_basis,
                        "billing_interval_minutes": package.billing_interval_minutes,
                        "rounding_rule": package.rounding_rule,
                        "components": component_snapshot,
                    },
                }
            )
        total_cents += line_total
    return result, required_assets, total_cents


def lock_products(db: Session, product_ids: set[int], business_id: int | None = None) -> None:
    if not product_ids:
        return
    statement = select(Product.id).where(Product.id.in_(product_ids))
    if business_id is not None:
        statement = statement.where(Product.business_id == business_id)
    locked_ids = db.scalars(
        statement
        .order_by(Product.id)
        .with_for_update()
    ).all()
    if len(locked_ids) != len(product_ids):
        raise HTTPException(status_code=404, detail="A selected product is unavailable")


def lock_requested_items(db: Session, requested_lines: list[OrderLineInput], business_id: int) -> None:
    package_ids = {line.item_id for line in requested_lines if line.kind == "package"}
    product_ids = {line.item_id for line in requested_lines if line.kind == "product"}
    if package_ids:
        packages = db.scalars(
            select(RentalPackage)
            .where(RentalPackage.id.in_(package_ids), RentalPackage.business_id == business_id)
            .order_by(RentalPackage.id)
            .with_for_update()
        ).all()
        if len(packages) != len(package_ids):
            raise HTTPException(status_code=404, detail="A selected package is unavailable")
        product_ids.update(
            component.product_id for package in packages for component in package.components
        )
    lock_products(db, product_ids, business_id)
    db.expire_all()


def allocate_assets(
    db: Session,
    order: RentalOrder,
    order_lines: list[OrderLine],
    required_assets: dict[int, int],
) -> None:
    line_by_product: dict[int, list[OrderLine]] = {}
    for line in order_lines:
        product_ids = (
            [line.product_id]
            if line.line_kind == "product"
            else [component["product_id"] for component in line.pricing_snapshot["components"]]
        )
        for product_id in product_ids:
            if product_id is not None:
                line_by_product.setdefault(product_id, []).append(line)

    for product_id, requested_count in required_assets.items():
        conflicting_allocation = exists(
            select(InventoryAllocation.id)
            .join(RentalOrder, RentalOrder.id == InventoryAllocation.order_id)
            .where(
                InventoryAllocation.asset_id == InventoryAsset.id,
                InventoryAllocation.released_at.is_(None),
                RentalOrder.status.in_(ACTIVE_ALLOCATION_STATUSES),
                RentalOrder.id != order.id,
                InventoryAllocation.starts_at < order.ends_at,
                InventoryAllocation.ends_at > order.starts_at,
            )
        )
        assets = db.scalars(
            select(InventoryAsset)
            .where(
                InventoryAsset.product_id == product_id,
                InventoryAsset.business_id == order.business_id,
                InventoryAsset.condition == AssetCondition.AVAILABLE,
                ~conflicting_allocation,
            )
            .order_by(InventoryAsset.id)
            .with_for_update()
            .limit(requested_count)
        ).all()
        if len(assets) < requested_count:
            product = db.get(Product, product_id)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Not enough available inventory for {product.name if product else 'a selected product'}.",
            )

        remaining = assets
        for line in line_by_product[product_id]:
            if line.line_kind == "product":
                quantity = line.quantity
            else:
                component = next(
                    part for part in line.pricing_snapshot["components"] if part["product_id"] == product_id
                )
                quantity = component["quantity"] * line.quantity
            for asset in remaining[:quantity]:
                db.add(
                    InventoryAllocation(
                        business_id=order.business_id,
                        order_id=order.id,
                        order_line_id=line.id,
                        asset_id=asset.id,
                        starts_at=order.starts_at,
                        ends_at=order.ends_at,
                    )
                )
            remaining = remaining[quantity:]


def release_allocations(db: Session, order: RentalOrder) -> None:
    now = datetime.now(timezone.utc)
    for allocation in db.scalars(
        select(InventoryAllocation).where(
            InventoryAllocation.order_id == order.id,
            InventoryAllocation.released_at.is_(None),
        )
    ):
        allocation.released_at = now
