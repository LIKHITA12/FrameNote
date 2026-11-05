"""add job is_pipeline_run

Revision ID: 20260924_0004
Revises: 20260920_0003
Create Date: 2026-09-24 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260924_0004"
down_revision: Union[str, None] = "20260920_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("is_pipeline_run", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("jobs", "is_pipeline_run")
