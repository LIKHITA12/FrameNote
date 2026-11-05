from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UserSettings(Base):
    """Per-user preferences surfaced on the Settings page.

    One row per user, created lazily on first read so existing accounts don't need a backfill.
    """

    __tablename__ = "user_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, unique=True, index=True)

    # --- Profile & identity ---
    role_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="UTC", server_default=sa.text("'UTC'")
    )
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set whenever the user changes their password from Settings; powers the "last changed" hint.
    password_changed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- AI synthesis & pipeline ---
    transcription_language: Mapped[str] = mapped_column(
        String(32), nullable=False, default="auto", server_default=sa.text("'auto'")
    )
    transcription_backend: Mapped[str] = mapped_column(
        String(64), nullable=False, default="whisper-v3", server_default=sa.text("'whisper-v3'")
    )
    reasoning_llm: Mapped[str] = mapped_column(
        String(64), nullable=False, default="sonnet", server_default=sa.text("'sonnet'")
    )
    summary_format: Mapped[str] = mapped_column(
        String(32), nullable=False, default="executive_brief", server_default=sa.text("'executive_brief'")
    )
    smart_diarization: Mapped[bool] = mapped_column(nullable=False, default=True, server_default=sa.true())
    # Domain glossary / custom terms that improve phonetic hit-rate (JSON list of strings).
    glossary_terms_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )

    # --- Notifications & delivery ---
    notify_on_ready: Mapped[bool] = mapped_column(nullable=False, default=True, server_default=sa.true())
    weekly_digest: Mapped[bool] = mapped_column(nullable=False, default=False, server_default=sa.false())
    # Watermark for the topbar bell: job finishes after this instant count as unread.
    notifications_read_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Connected integrations --- (JSON object of {integration_id: bool})
    integrations_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="{}", server_default=sa.text("'{}'")
    )

    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="settings")
