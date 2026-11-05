"""add job sentiment

Revision ID: 20261002_0008
Revises: 20260927_0007
Create Date: 2026-10-02 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261002_0008"
down_revision: Union[str, None] = "20260927_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs", sa.Column("sentiment", sa.String(length=20), nullable=False, server_default=sa.text("'Neutral'"))
    )


def downgrade() -> None:
    op.drop_column("jobs", "sentiment")
