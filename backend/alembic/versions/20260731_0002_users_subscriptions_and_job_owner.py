"""users subscriptions and job owner

Revision ID: 20260731_0002
Revises: 20260731_0001
Create Date: 2026-07-31 01:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260731_0002"
down_revision: Union[str, None] = "20260731_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("tier", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_subscriptions_user_id"),
    )

    op.add_column("jobs", sa.Column("owner_id", sa.String(length=36), nullable=True))
    op.add_column("jobs", sa.Column("pdf_asset_key", sa.Text(), nullable=True))
    op.create_index("ix_jobs_owner_id", "jobs", ["owner_id"], unique=False)
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("jobs") as batch:
            batch.create_foreign_key("fk_jobs_owner_id_users", "users", ["owner_id"], ["id"])
    else:
        op.create_foreign_key("fk_jobs_owner_id_users", "jobs", "users", ["owner_id"], ["id"])


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("jobs") as batch:
            batch.drop_constraint("fk_jobs_owner_id_users", type_="foreignkey")
    else:
        op.drop_constraint("fk_jobs_owner_id_users", "jobs", type_="foreignkey")
    op.drop_index("ix_jobs_owner_id", table_name="jobs")
    op.drop_column("jobs", "pdf_asset_key")
    op.drop_column("jobs", "owner_id")

    op.drop_table("subscriptions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
