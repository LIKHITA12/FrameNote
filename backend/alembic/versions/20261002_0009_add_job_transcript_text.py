"""add job transcript_text

Revision ID: 20261002_0009
Revises: 20261002_0008
Create Date: 2026-10-02 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261002_0009"
down_revision: Union[str, None] = "20261002_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("transcript_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "transcript_text")
