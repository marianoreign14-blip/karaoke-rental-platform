"""add product specifications and package categories

Revision ID: c1728a9d4e61
Revises: b4d7f9e2c1a5
Create Date: 2026-11-22 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c1728a9d4e61"
down_revision: Union[str, None] = "b4d7f9e2c1a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("specifications", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "rental_packages",
        sa.Column("category", sa.String(length=80), nullable=False, server_default="Karaoke Packages"),
    )
    op.create_index("ix_rental_packages_category", "rental_packages", ["category"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_rental_packages_category", table_name="rental_packages")
    op.drop_column("rental_packages", "category")
    op.drop_column("products", "specifications")
