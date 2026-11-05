"""add projects and viewer sharing

Revision ID: 20261023_0019
Revises: 20261022_0018
"""

from alembic import op
import sqlalchemy as sa

revision = "20261023_0019"
down_revision = "20261022_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    with op.batch_alter_table("jobs") as batch:
        batch.add_column(sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", name="fk_jobs_project_id_projects", ondelete="SET NULL"), nullable=True))
        batch.create_index("ix_jobs_project_id", ["project_id"])
    op.create_table(
        "job_collaborators",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="viewer"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("job_id", "user_id", name="uq_job_collaborator_user"),
    )
    op.create_index("ix_job_collaborators_job_id", "job_collaborators", ["job_id"])
    op.create_index("ix_job_collaborators_user_id", "job_collaborators", ["user_id"])


def downgrade() -> None:
    op.drop_table("job_collaborators")
    with op.batch_alter_table("jobs") as batch:
        batch.drop_index("ix_jobs_project_id")
        batch.drop_column("project_id")
    op.drop_table("projects")
