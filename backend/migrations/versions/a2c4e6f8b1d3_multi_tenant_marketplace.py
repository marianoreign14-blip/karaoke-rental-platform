"""introduce business tenants and scoped rental data

Revision ID: a2c4e6f8b1d3
Revises: 98e3c2a14f7b
Create Date: 2026-11-20 12:56:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a2c4e6f8b1d3"
down_revision: Union[str, None] = "98e3c2a14f7b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANTS = (
    {
        "name": "Legacy Karaoke",
        "slug": "legacy-karaoke",
        "description": "Existing rental catalog and records migrated from the original single-business system.",
        "brand_primary": "#7E3F3F",
        "brand_secondary": "#F5EFE6",
        "brand_accent": "#B88A5A",
    },
    {
        "name": "EchoVibe Karaoke Rentals",
        "slug": "echovibe-karaoke-rentals",
        "description": "Premium karaoke equipment rental services.",
        "brand_primary": "#111111",
        "brand_secondary": "#F5EEDC",
        "brand_accent": "#D4AF37",
    },
    {
        "name": "MicDrop Karaoke Hub",
        "slug": "micdrop-karaoke-hub",
        "description": "Karaoke entertainment and party rentals.",
        "brand_primary": "#7028A0",
        "brand_secondary": "#17131D",
        "brand_accent": "#FF38B8",
    },
    {
        "name": "SoundWave Rentals",
        "slug": "soundwave-rentals",
        "description": "Professional audio and karaoke equipment rentals.",
        "brand_primary": "#102A43",
        "brand_secondary": "#FFFFFF",
        "brand_accent": "#53B7E8",
    },
    {
        "name": "PartyPulse Karaoke",
        "slug": "partypulse-karaoke",
        "description": "Karaoke equipment for parties, celebrations, and events.",
        "brand_primary": "#F17A22",
        "brand_secondary": "#FFD84D",
        "brand_accent": "#303238",
    },
    {
        "name": "EncoreBeat Rentals",
        "slug": "encorebeat-rentals",
        "description": "Premium sound systems and karaoke rentals.",
        "brand_primary": "#741F3B",
        "brand_secondary": "#191719",
        "brand_accent": "#BFC3C7",
    },
)


TENANT_TABLES = (
    "products",
    "inventory_assets",
    "rental_packages",
    "package_components",
    "rental_orders",
    "order_lines",
    "inventory_allocations",
    "order_requests",
    "order_history",
    "payments",
)


def upgrade() -> None:
    op.create_table(
        "businesses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("contact_email", sa.String(length=320), nullable=True),
        sa.Column("contact_phone", sa.String(length=40), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("logo_data", sa.LargeBinary(), nullable=True),
        sa.Column("logo_media_type", sa.String(length=32), nullable=True),
        sa.Column("banner_data", sa.LargeBinary(), nullable=True),
        sa.Column("banner_media_type", sa.String(length=32), nullable=True),
        sa.Column("brand_primary", sa.String(length=7), nullable=False, server_default="#7E3F3F"),
        sa.Column("brand_secondary", sa.String(length=7), nullable=False, server_default="#F5EFE6"),
        sa.Column("brand_accent", sa.String(length=7), nullable=False, server_default="#B88A5A"),
        sa.Column("is_listed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("subscription_plan", sa.String(length=40), nullable=False, server_default="demo"),
        sa.Column("subscription_status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("subscription_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_businesses_slug", "businesses", ["slug"], unique=True)
    op.create_index("ix_businesses_status", "businesses", ["status"], unique=False)

    business_table = sa.table(
        "businesses",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("brand_primary", sa.String()),
        sa.column("brand_secondary", sa.String()),
        sa.column("brand_accent", sa.String()),
        sa.column("status", sa.String()),
        sa.column("subscription_plan", sa.String()),
        sa.column("subscription_status", sa.String()),
    )
    op.bulk_insert(
        business_table,
        [
            {
                **tenant,
                "status": "active",
                "subscription_plan": "demo",
                "subscription_status": "active",
            }
            for tenant in TENANTS
        ],
    )
    connection = op.get_bind()
    tenant_ids = dict(connection.execute(sa.select(business_table.c.slug, business_table.c.id)).all())
    legacy_id = tenant_ids["legacy-karaoke"]
    connection.execute(
        sa.text("UPDATE businesses SET is_listed = false WHERE id = :business_id"),
        {"business_id": legacy_id},
    )

    op.add_column("users", sa.Column("business_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_business_id_businesses",
        "users",
        "businesses",
        ["business_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_users_business_id", "users", ["business_id"], unique=False)
    op.alter_column(
        "users",
        "role",
        existing_type=sa.String(length=8),
        type_=sa.String(length=24),
        postgresql_using="role::text",
    )
    connection.execute(sa.text("UPDATE users SET role = 'platform_admin' WHERE role = 'admin'"))

    op.drop_constraint("quality_tiers_name_key", "quality_tiers", type_="unique")
    op.add_column("quality_tiers", sa.Column("business_id", sa.Integer(), nullable=True))
    connection.execute(
        sa.text("UPDATE quality_tiers SET business_id = :business_id"),
        {"business_id": legacy_id},
    )
    op.alter_column("quality_tiers", "business_id", nullable=False)
    op.create_foreign_key(
        "fk_quality_tiers_business_id_businesses",
        "quality_tiers",
        "businesses",
        ["business_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_quality_tiers_business_id", "quality_tiers", ["business_id"], unique=False)
    op.create_index(
        "uq_quality_tiers_business_name",
        "quality_tiers",
        ["business_id", sa.text("lower(trim(name))")],
        unique=True,
    )

    op.create_table(
        "business_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_business_categories_business_id", "business_categories", ["business_id"], unique=False)
    op.create_index(
        "uq_business_categories_business_name",
        "business_categories",
        ["business_id", sa.text("lower(trim(name))")],
        unique=True,
    )

    op.create_table(
        "business_customers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "customer_id", name="uq_business_customer"),
    )
    op.create_index("ix_business_customers_business_id", "business_customers", ["business_id"], unique=False)
    op.create_index("ix_business_customers_customer_id", "business_customers", ["customer_id"], unique=False)
    connection.execute(
        sa.text(
            "INSERT INTO business_customers (business_id, customer_id, is_active) "
            "SELECT :business_id, id, true FROM users WHERE role = 'customer'"
        ),
        {"business_id": legacy_id},
    )

    category_table = sa.table(
        "business_categories",
        sa.column("business_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("is_active", sa.Boolean()),
    )
    for business_id in tenant_ids.values():
        op.bulk_insert(
            category_table,
            [
                {"business_id": business_id, "name": name, "is_active": True}
                for name in ("karaoke", "table", "chair")
            ],
        )

    for table_name in TENANT_TABLES:
        op.add_column(table_name, sa.Column("business_id", sa.Integer(), nullable=True))
        connection.execute(
            sa.text(f"UPDATE {table_name} SET business_id = :business_id"),
            {"business_id": legacy_id},
        )
        op.alter_column(table_name, "business_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table_name}_business_id_businesses",
            table_name,
            "businesses",
            ["business_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(f"ix_{table_name}_business_id", table_name, ["business_id"], unique=False)

    op.add_column("payments", sa.Column("proof_data", sa.LargeBinary(), nullable=True))
    op.add_column("payments", sa.Column("proof_media_type", sa.String(length=32), nullable=True))

    op.alter_column(
        "products",
        "category",
        existing_type=sa.String(length=7),
        type_=sa.String(length=80),
        postgresql_using="category::text",
    )
    op.drop_index("uq_products_category_quality_name", table_name="products")
    op.create_index(
        "uq_products_business_category_quality_name",
        "products",
        ["business_id", "category", "quality_tier_id", sa.text("lower(trim(name))")],
        unique=True,
    )

    quality_table = sa.table(
        "quality_tiers",
        sa.column("business_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("is_active", sa.Boolean()),
    )
    for business_id in tenant_ids.values():
        existing = {
            name.strip().lower()
            for name in connection.execute(
                sa.select(quality_table.c.name).where(quality_table.c.business_id == business_id)
            ).scalars()
        }
        op.bulk_insert(
            quality_table,
            [
                {"business_id": business_id, "name": name, "is_active": True}
                for name in ("Basic", "Standard", "Premium")
                if name.lower() not in existing
            ],
        )

    op.create_table(
        "business_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_business_audit_logs_business_id", "business_audit_logs", ["business_id"], unique=False)
    op.create_index("ix_business_audit_logs_actor_id", "business_audit_logs", ["actor_id"], unique=False)
    op.create_index("ix_business_audit_logs_created_at", "business_audit_logs", ["created_at"], unique=False)
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", sa.String(length=1000), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
    op.drop_index("ix_business_audit_logs_created_at", table_name="business_audit_logs")
    op.drop_index("ix_business_audit_logs_actor_id", table_name="business_audit_logs")
    op.drop_index("ix_business_audit_logs_business_id", table_name="business_audit_logs")
    op.drop_table("business_audit_logs")
    op.drop_index("ix_business_customers_customer_id", table_name="business_customers")
    op.drop_index("ix_business_customers_business_id", table_name="business_customers")
    op.drop_table("business_customers")

    op.drop_column("payments", "proof_media_type")
    op.drop_column("payments", "proof_data")
    op.drop_index("uq_products_business_category_quality_name", table_name="products")
    op.create_index(
        "uq_products_category_quality_name",
        "products",
        ["category", "quality_tier_id", sa.text("lower(trim(name))")],
        unique=True,
    )
    op.alter_column(
        "products",
        "category",
        existing_type=sa.String(length=80),
        type_=sa.String(length=7),
        postgresql_using="category::text",
    )
    for table_name in reversed(TENANT_TABLES):
        op.drop_index(f"ix_{table_name}_business_id", table_name=table_name)
        op.drop_constraint(f"fk_{table_name}_business_id_businesses", table_name, type_="foreignkey")
        op.drop_column(table_name, "business_id")

    op.drop_index("uq_business_categories_business_name", table_name="business_categories")
    op.drop_index("ix_business_categories_business_id", table_name="business_categories")
    op.drop_table("business_categories")

    op.drop_index("uq_quality_tiers_business_name", table_name="quality_tiers")
    op.drop_index("ix_quality_tiers_business_id", table_name="quality_tiers")
    op.drop_constraint("fk_quality_tiers_business_id_businesses", "quality_tiers", type_="foreignkey")
    op.drop_column("quality_tiers", "business_id")
    op.create_unique_constraint("quality_tiers_name_key", "quality_tiers", ["name"])

    connection = op.get_bind()
    connection.execute(sa.text("UPDATE users SET role = 'admin' WHERE role = 'platform_admin'"))
    op.drop_index("ix_users_business_id", table_name="users")
    op.drop_constraint("fk_users_business_id_businesses", "users", type_="foreignkey")
    op.drop_column("users", "business_id")
    op.alter_column(
        "users",
        "role",
        existing_type=sa.String(length=24),
        type_=sa.String(length=8),
        postgresql_using="role::text",
    )

    op.drop_index("ix_businesses_status", table_name="businesses")
    op.drop_index("ix_businesses_slug", table_name="businesses")
    op.drop_table("businesses")
