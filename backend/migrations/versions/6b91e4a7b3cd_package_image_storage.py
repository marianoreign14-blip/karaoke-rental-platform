"""store package images in PostgreSQL

Revision ID: 6b91e4a7b3cd
Revises: 7f0dcf2f2163
Create Date: 2026-11-20 01:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6b91e4a7b3cd"
down_revision: Union[str, None] = "7f0dcf2f2163"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rental_packages", sa.Column("image_data", sa.LargeBinary(), nullable=True))
    op.add_column("rental_packages", sa.Column("image_media_type", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("rental_packages", "image_media_type")
    op.drop_column("rental_packages", "image_data")
