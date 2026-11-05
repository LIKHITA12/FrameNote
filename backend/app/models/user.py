from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Nullable: legacy header-authenticated accounts have no password until they set one.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Set once an identity provider vouches for the address; password signups stay unverified until then.
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # Access tokens issued before this instant are rejected (e.g. after an unverified password is revoked).
    sessions_revoked_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    jobs = relationship("Job", back_populates="owner")
    projects = relationship("Project", back_populates="owner")
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    settings = relationship("UserSettings", back_populates="user", uselist=False)
    support_messages = relationship("SupportMessage", back_populates="user")
    feedback_entries = relationship("Feedback", back_populates="user")
    chat_messages = relationship("ChatMessage", back_populates="user", passive_deletes=True)
