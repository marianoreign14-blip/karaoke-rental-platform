import argparse
from datetime import datetime, timedelta, timezone
from getpass import getpass
import hashlib
import secrets

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import (
    Business,
    BusinessCategory,
    PasswordResetToken,
    Product,
    ProductCategory,
    QualityTier,
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
    args = parser.parse_args()
    if args.command == "create-admin":
        create_admin(args.email, args.name)
    elif args.command == "issue-password-reset":
        issue_password_reset(args.email, args.minutes)
    else:
        seed_catalog()


if __name__ == "__main__":
    main()
