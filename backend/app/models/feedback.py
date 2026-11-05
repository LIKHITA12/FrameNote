from datetime import datetime, timezone
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Feedback(Base):
    """A rating and comment from Settings > Feedback.

    Deliberately small: one star rating and one comment, the two things we ask for. Entries
    are shown back to other signed-in users, so the form tells people that up front.

    Kept separate from SupportMessage: that table is a help-desk queue someone has to
    answer, while this is public product feedback we aggregate.
    """

    __tablename__ = "feedback_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    # Nullable so an entry survives the account being deleted.
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)

    # Overall satisfaction, 1 (poor) to 5 (excellent).
    rating: Mapped[int] = mapped_column(nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)

    # Lets us hide an entry from the shared list without deleting it (moderation).
    is_public: Mapped[bool] = mapped_column(nullable=False, default=True, server_default=sa.true())
    # Triage state shown back to the author only: new -> reviewed -> planned/declined.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new", server_default=sa.text("'new'"))

    # Set in Python as well as the DB: SQLite's CURRENT_TIMESTAMP only has second
    # resolution, which left entries posted in the same second in arbitrary order.
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    user = relationship("User", back_populates="feedback_entries")
