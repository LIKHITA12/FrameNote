"""add job processing_stage

Revision ID: 20260927_0006
Revises: 20260926_0005
Create Date: 2026-09-27 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260927_0006"
down_revision: Union[str, None] = "20260926_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("processing_stage", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("jobs", "processing_stage")
