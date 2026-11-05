"""add job transcript upload fields

Revision ID: 20261002_0010
Revises: 20261002_0009
Create Date: 2026-10-02 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261002_0010"
down_revision: Union[str, None] = "20261002_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("transcript_object_key", sa.Text(), nullable=True))
    op.add_column("jobs", sa.Column("transcript_file_name", sa.Text(), nullable=True))
    op.add_column(
        "jobs",
        sa.Column("transcript_source", sa.String(length=20), nullable=False, server_default=sa.text("'generated'")),
    )
    op.add_column(
        "jobs",
        sa.Column("speaker_airtime_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("jobs", "speaker_airtime_json")
    op.drop_column("jobs", "transcript_source")
    op.drop_column("jobs", "transcript_file_name")
    op.drop_column("jobs", "transcript_object_key")
