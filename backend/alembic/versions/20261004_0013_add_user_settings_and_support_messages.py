"""add user settings and support messages

Revision ID: 20261004_0013
Revises: 20261004_0012
Create Date: 2026-10-04 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261004_0013"
down_revision: Union[str, None] = "20261004_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role_title", sa.String(length=120), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default=sa.text("'UTC'")),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "transcription_language", sa.String(length=32), nullable=False, server_default=sa.text("'auto'")
        ),
        sa.Column(
            "transcription_backend", sa.String(length=64), nullable=False, server_default=sa.text("'whisper-v3'")
        ),
        sa.Column("reasoning_llm", sa.String(length=64), nullable=False, server_default=sa.text("'sonnet'")),
        sa.Column(
            "summary_format", sa.String(length=32), nullable=False, server_default=sa.text("'executive_brief'")
        ),
        sa.Column("smart_diarization", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("glossary_terms_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("notify_on_ready", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("weekly_digest", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("integrations_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_user_settings_user_id"), "user_settings", ["user_id"], unique=True)

    op.create_table(
        "support_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("topic", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'received'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_support_messages_user_id"), "support_messages", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_support_messages_user_id"), table_name="support_messages")
    op.drop_table("support_messages")
    op.drop_index(op.f("ix_user_settings_user_id"), table_name="user_settings")
    op.drop_table("user_settings")
