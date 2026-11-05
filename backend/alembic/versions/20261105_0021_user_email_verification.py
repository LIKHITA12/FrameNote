"""add user email verification and session revocation

Revision ID: 20261105_0021
Revises: 20261023_0020
"""

from alembic import op
import sqlalchemy as sa

revision = "20261105_0021"
down_revision = "20261023_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("sessions_revoked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sessions_revoked_at")
    op.drop_column("users", "email_verified")
