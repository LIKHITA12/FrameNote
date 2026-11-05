"""add saved video clips

Revision ID: 20261023_0020
Revises: 20261023_0019
"""

from alembic import op
import sqlalchemy as sa

revision = "20261023_0020"
down_revision = "20261023_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_clips",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("start_seconds", sa.Integer(), nullable=False),
        sa.Column("end_seconds", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("end_seconds > start_seconds", name="ck_job_clips_positive_range"),
    )
    op.create_index("ix_job_clips_job_id", "job_clips", ["job_id"])


def downgrade() -> None:
    op.drop_table("job_clips")
