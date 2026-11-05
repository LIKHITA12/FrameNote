"""add selected UI contexts to video chat messages

Revision ID: 20261020_0017
Revises: 20261020_0016
Create Date: 2026-10-20 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261020_0017"
down_revision: Union[str, None] = "20261020_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("chat_messages")}
    if "contexts_json" not in columns:
        op.add_column(
            "chat_messages",
            sa.Column("contexts_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("chat_messages")}
    if "contexts_json" in columns:
        op.drop_column("chat_messages", "contexts_json")
