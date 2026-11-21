"""add shared rental checkout references and idempotency

Revision ID: d6e9a1f4c2b7
Revises: c1728a9d4e61
Create Date: 2026-11-23 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6e9a1f4c2b7"
down_revision: Union[str, None] = "c1728a9d4e61"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rental_checkouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("submission_key", sa.String(length=128), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("payment_method", sa.String(length=32), nullable=False),
        sa.Column("event_details", sa.Text(), nullable=True),
        sa.Column("customer_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference", name="uq_rental_checkouts_reference"),
        sa.UniqueConstraint(
            "customer_id",
            "submission_key",
            name="uq_rental_checkout_customer_submission",
        ),
    )
    op.create_index("ix_rental_checkouts_customer_id", "rental_checkouts", ["customer_id"], unique=False)

    op.add_column("rental_orders", sa.Column("checkout_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_rental_orders_checkout_id_rental_checkouts",
        "rental_orders",
        "rental_checkouts",
        ["checkout_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_rental_orders_checkout_id", "rental_orders", ["checkout_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_rental_orders_checkout_id", table_name="rental_orders")
    op.drop_constraint("fk_rental_orders_checkout_id_rental_checkouts", "rental_orders", type_="foreignkey")
    op.drop_column("rental_orders", "checkout_id")
    op.drop_index("ix_rental_checkouts_customer_id", table_name="rental_checkouts")
    op.drop_table("rental_checkouts")
