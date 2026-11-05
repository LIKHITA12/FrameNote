"""add job analysis_json

Revision ID: 20260926_0005
Revises: 20260924_0004
Create Date: 2026-09-26 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260926_0005"
down_revision: Union[str, None] = "20260924_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("analysis_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "analysis_json")
