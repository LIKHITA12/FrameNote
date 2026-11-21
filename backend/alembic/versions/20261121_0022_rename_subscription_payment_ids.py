"""Rename Stripe-specific subscription columns to provider-neutral payment ids (billing moved to Dodo Payments).

Revision ID: 20261121_0022
Revises: 20261105_0021
"""

from alembic import op

revision = "20261121_0022"
down_revision = "20261105_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("subscriptions") as batch:
        batch.alter_column("stripe_customer_id", new_column_name="payment_customer_id")
        batch.alter_column("stripe_subscription_id", new_column_name="payment_subscription_id")


def downgrade() -> None:
    with op.batch_alter_table("subscriptions") as batch:
        batch.alter_column("payment_customer_id", new_column_name="stripe_customer_id")
        batch.alter_column("payment_subscription_id", new_column_name="stripe_subscription_id")
