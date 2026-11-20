import argparse
from datetime import datetime, timedelta, timezone
from getpass import getpass
import hashlib
import secrets

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.catalog_data import (
    CATEGORY_IMAGES,
    EQUIPMENT_CATALOG,
    PACKAGE_CATALOG,
    PACKAGE_IMAGE,
    catalog_image_bytes,
    equipment_description,
    equipment_specifications,
)
from app.models import (
    AssetCondition,
    Business,
    BusinessCategory,
    InventoryAsset,
    PackageComponent,
    PasswordResetToken,
    Product,
    ProductCategory,
    QualityTier,
    RentalPackage,
    User,
    UserRole,
)

SAMPLE_PRICES_CENTS = {
    ProductCategory.KARAOKE: {"Basic": 50_000, "Standard": 100_000, "Premium": 150_000},
    ProductCategory.TABLE: {"Basic": 15_000, "Standard": 20_000, "Premium": 25_000},
    ProductCategory.CHAIR: {"Basic": 2_000, "Standard": 5_000, "Premium": 7_000},
}


def create_admin(email: str, display_name: str):
    normalized_email = email.strip().lower()
    normalized_name = display_name.strip()
    if "@" not in normalized_email or "." not in normalized_email.split("@", 1)[-1]:
        raise SystemExit("Provide a valid administrator email address.")
    if not normalized_name:
        raise SystemExit("Administrator display name is required.")
    password = getpass("Administrator password (12+ characters): ")
    confirmation = getpass("Confirm password: ")
    if len(password) < 12:
        raise SystemExit("Password must contain at least 12 characters.")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == normalized_email)) is not None:
            raise SystemExit("An account with that email already exists.")
        admin = User(
            email=normalized_email,
            password_hash=hash_password(password),
            display_name=normalized_name,
            role=UserRole.PLATFORM_ADMIN,
        )
        db.add(admin)
        db.commit()
        print(f"Administrator created: {admin.email}")


def seed_catalog():
    with SessionLocal() as db:
        business = db.scalar(select(Business).where(Business.slug == "legacy-karaoke"))
        if business is None:
            raise SystemExit("Apply database migrations before seeding the catalog.")
        tiers = {
            tier.name: tier
            for tier in db.scalars(select(QualityTier).where(QualityTier.business_id == business.id))
        }
        for tier_name in ("Basic", "Standard", "Premium"):
            if tier_name not in tiers:
                tier = QualityTier(business_id=business.id, name=tier_name)
                db.add(tier)
                tiers[tier_name] = tier
        categories = {
            category.name.lower()
            for category in db.scalars(
                select(BusinessCategory).where(BusinessCategory.business_id == business.id)
            )
        }
        for category in ("karaoke", "table", "chair"):
            if category.lower() not in categories:
                db.add(BusinessCategory(business_id=business.id, name=category))
        db.flush()
        existing = {
            (product.category, product.quality_tier_id)
            for product in db.scalars(select(Product).where(Product.business_id == business.id))
        }
        for category, prices in SAMPLE_PRICES_CENTS.items():
            for tier_name, price_cents in prices.items():
                tier = tiers[tier_name]
                if (category.value, tier.id) in existing:
                    continue
                db.add(
                    Product(
                        business_id=business.id,
                        name=f"{tier_name} {category.value.title()}",
                        category=category.value,
                        quality_tier_id=tier.id,
                        price_cents=price_cents,
                        pricing_basis=None,
                        billing_interval_minutes=None,
                        rounding_rule=None,
                    )
                )
        db.commit()
        print("Initial quality labels and sample catalog prices are ready.")
        print("Prices remain non-billable until an administrator configures their basis.")


def populate_marketplace(db):
    business_slugs = {item[0] for item in EQUIPMENT_CATALOG}
    businesses = {
        business.slug: business
        for business in db.scalars(select(Business).where(Business.slug.in_(business_slugs)))
    }
    missing = business_slugs - businesses.keys()
    unavailable = {
        slug
        for slug, business in businesses.items()
        if business.status != "active" or not business.is_listed
    }
    if missing or unavailable:
        details = []
        if missing:
            details.append(f"missing businesses: {', '.join(sorted(missing))}")
        if unavailable:
            details.append(f"businesses not publicly active: {', '.join(sorted(unavailable))}")
        raise SystemExit(f"Cannot seed marketplace: {'; '.join(details)}.")

    tiers = {}
    for slug, business in businesses.items():
        tier = db.scalar(
            select(QualityTier).where(
                QualityTier.business_id == business.id,
                func.lower(func.trim(QualityTier.name)) == "standard",
            )
        )
        if tier is None:
            tier = QualityTier(business_id=business.id, name="Standard")
            db.add(tier)
            db.flush()
        tiers[slug] = tier

        existing_categories = {
            name.strip().lower()
            for name in db.scalars(
                select(BusinessCategory.name).where(BusinessCategory.business_id == business.id)
            )
        }
        for category in CATEGORY_IMAGES:
            if category.lower() not in existing_categories:
                db.add(BusinessCategory(business_id=business.id, name=category, is_active=True))

    db.flush()
    products_by_business: dict[str, dict[str, Product]] = {slug: {} for slug in business_slugs}
    added_products = 0
    added_assets = 0
    updated_images = 0
    for slug, name, category, price_cents, stock in EQUIPMENT_CATALOG:
        business = businesses[slug]
        product = db.scalar(
            select(Product).where(
                Product.business_id == business.id,
                func.lower(func.trim(Product.name)) == name.lower(),
            )
        )
        if product is None:
            product = Product(
                business_id=business.id,
                name=name,
                description=equipment_description(name, category),
                specifications=equipment_specifications(name, category),
                category=category,
                quality_tier_id=tiers[slug].id,
                price_cents=price_cents,
                pricing_basis="per_rental",
                image_data=catalog_image_bytes(CATEGORY_IMAGES[category]),
                image_media_type="image/svg+xml",
                is_active=True,
            )
            db.add(product)
            db.flush()
            for sequence in range(1, stock + 1):
                db.add(
                    InventoryAsset(
                        business_id=business.id,
                        product_id=product.id,
                        asset_tag=f"CAT-{product.id:06d}-{sequence:04d}",
                        condition=AssetCondition.AVAILABLE,
                    )
                )
            added_products += 1
            added_assets += stock
        elif (
            not product.is_active
            or product.category != category
            or product.quality_tier_id != tiers[slug].id
        ):
            continue
        elif (
            product.image_data is None
            and product.image_url == CATEGORY_IMAGES[category]
        ):
            product.image_data = catalog_image_bytes(CATEGORY_IMAGES[category])
            product.image_media_type = "image/svg+xml"
            product.image_url = None
            updated_images += 1
        products_by_business[slug][name] = product

    added_packages = 0
    added_components = 0
    updated_package_images = 0
    for slug, name, category, description, price_cents, component_names in PACKAGE_CATALOG:
        business = businesses[slug]
        if db.scalar(
            select(RentalPackage.id).where(
                RentalPackage.business_id == business.id,
                func.lower(func.trim(RentalPackage.name)) == name.lower(),
            )
        ) is not None:
            existing_package = db.scalar(
                select(RentalPackage).where(
                    RentalPackage.business_id == business.id,
                    func.lower(func.trim(RentalPackage.name)) == name.lower(),
                )
            )
            if (
                existing_package is not None
                and existing_package.image_data is None
                and existing_package.image_url == PACKAGE_IMAGE
            ):
                existing_package.image_data = catalog_image_bytes(PACKAGE_IMAGE)
                existing_package.image_media_type = "image/svg+xml"
                existing_package.image_url = None
                updated_package_images += 1
            continue
        components = [products_by_business[slug].get(product_name) for product_name in component_names]
        if any(product is None for product in components):
            continue
        component_stock = {
            product.id: db.scalar(
                select(func.count(InventoryAsset.id)).where(
                    InventoryAsset.business_id == business.id,
                    InventoryAsset.product_id == product.id,
                    InventoryAsset.condition == AssetCondition.AVAILABLE,
                )
            )
            or 0
            for product in components
        }
        if any(component_stock[product.id] < 1 for product in components):
            continue
        package = RentalPackage(
            business_id=business.id,
            name=name,
            category=category,
            description=description,
            price_cents=price_cents,
            pricing_basis="per_rental",
            image_data=catalog_image_bytes(PACKAGE_IMAGE),
            image_media_type="image/svg+xml",
            is_active=True,
        )
        db.add(package)
        db.flush()
        db.add_all(
            [
                PackageComponent(
                    business_id=business.id,
                    package_id=package.id,
                    product_id=product.id,
                    quantity=1,
                )
                for product in components
            ]
        )
        added_packages += 1
        added_components += len(components)

    return {
        "products": added_products,
        "assets": added_assets,
        "packages": added_packages,
        "components": added_components,
        "images": added_products + updated_images,
        "package_images": added_packages + updated_package_images,
    }


def seed_marketplace():
    with SessionLocal.begin() as db:
        result = populate_marketplace(db)
    print(
        "Marketplace catalog ready: "
        f"{result['products']} products, {result['assets']} inventory units, "
        f"{result['packages']} packages, and {result['components']} package components added; "
        f"{result['images']} product images and {result['package_images']} package covers added."
    )


def issue_password_reset(email: str, ttl_minutes: int = 30):
    normalized_email = email.strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == normalized_email, User.is_active.is_(True)))
        if user is None:
            raise SystemExit("No active account found for that email address.")
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
        db.commit()
        print(f"One-time password reset token created for {user.email} (expires in {ttl_minutes} minutes):")
        print(raw_token)


def main():
    parser = argparse.ArgumentParser(prog="karaokewebapp")
    commands = parser.add_subparsers(dest="command", required=True)
    admin_parser = commands.add_parser("create-admin", help="Create an administrator account")
    admin_parser.add_argument("--email", required=True)
    admin_parser.add_argument("--name", required=True)
    commands.add_parser("seed-catalog", help="Seed initial quality labels and sample catalog prices")
    reset_parser = commands.add_parser("issue-password-reset", help="Generate a one-time password reset token")
    reset_parser.add_argument("--email", required=True)
    reset_parser.add_argument("--minutes", type=int, default=30)
    commands.add_parser("seed-marketplace", help="Seed the public marketplace with rental products and packages")
    args = parser.parse_args()
    if args.command == "create-admin":
        create_admin(args.email, args.name)
    elif args.command == "issue-password-reset":
        issue_password_reset(args.email, args.minutes)
    elif args.command == "seed-marketplace":
        seed_marketplace()
    else:
        seed_catalog()


if __name__ == "__main__":
    main()
