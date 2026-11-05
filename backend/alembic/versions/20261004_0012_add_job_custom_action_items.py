"""add job custom action items

Revision ID: 20261004_0012
Revises: 20261003_0011
Create Date: 2026-10-04 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261004_0012"
down_revision: Union[str, None] = "20261003_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("custom_action_items_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("jobs", "custom_action_items_json")
