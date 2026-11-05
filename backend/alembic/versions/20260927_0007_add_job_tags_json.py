"""add job tags_json

Revision ID: 20260927_0007
Revises: 20260927_0006
Create Date: 2026-09-27 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260927_0007"
down_revision: Union[str, None] = "20260927_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("tags_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")))


def downgrade() -> None:
    op.drop_column("jobs", "tags_json")
