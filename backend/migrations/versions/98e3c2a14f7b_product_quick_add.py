"""support product images and duplicate checks

Revision ID: 98e3c2a14f7b
Revises: 6b91e4a7b3cd
Create Date: 2026-11-20 12:25:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "98e3c2a14f7b"
down_revision: Union[str, None] = "6b91e4a7b3cd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("image_data", sa.LargeBinary(), nullable=True))
    op.add_column("products", sa.Column("image_media_type", sa.String(length=32), nullable=True))
    op.create_index(
        "uq_products_category_quality_name",
        "products",
        ["category", "quality_tier_id", sa.text("lower(trim(name))")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_products_category_quality_name", table_name="products")
    op.drop_column("products", "image_media_type")
    op.drop_column("products", "image_data")
