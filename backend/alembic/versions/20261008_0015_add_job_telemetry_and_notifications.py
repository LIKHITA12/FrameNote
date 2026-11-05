"""add job telemetry, action item completion, and notification read marker

Revision ID: 20261008_0015
Revises: 20261007_0014
Create Date: 2026-10-08 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261008_0015"
down_revision: Union[str, None] = "20261007_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("processing_completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "jobs",
        sa.Column("stage_events_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column(
        "jobs",
        sa.Column("completed_action_items_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column(
        "user_settings",
        sa.Column("notifications_read_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "notifications_read_at")
    op.drop_column("jobs", "completed_action_items_json")
    op.drop_column("jobs", "stage_events_json")
    op.drop_column("jobs", "processing_completed_at")
    op.drop_column("jobs", "processing_started_at")
