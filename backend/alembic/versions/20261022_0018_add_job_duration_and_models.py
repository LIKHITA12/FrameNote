"""record media runtime and model attribution

Revision ID: 20261022_0018
Revises: 20261020_0017
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261022_0018"
down_revision: Union[str, None] = "20261020_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("jobs")}
    if "media_duration_seconds" not in columns:
        op.add_column("jobs", sa.Column("media_duration_seconds", sa.Integer(), nullable=True))
    if "transcription_model" not in columns:
        op.add_column("jobs", sa.Column("transcription_model", sa.String(length=100), nullable=True))
    if "summary_model" not in columns:
        op.add_column("jobs", sa.Column("summary_model", sa.String(length=100), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("jobs")}
    for column in ("summary_model", "transcription_model", "media_duration_seconds"):
        if column in columns:
            op.drop_column("jobs", column)
