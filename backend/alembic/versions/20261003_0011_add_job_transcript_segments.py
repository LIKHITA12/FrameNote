"""add job transcript segments

Revision ID: 20261003_0011
Revises: 20261002_0010
Create Date: 2026-10-03 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261003_0011"
down_revision: Union[str, None] = "20261002_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("transcript_segments_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("jobs", "transcript_segments_json")
