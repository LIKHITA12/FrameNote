from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    # Highest pipeline stage completed so far: 0=queued, 1=audio extracted, 2=transcribed,
    # 3=AI summarizing done, 4=formatted brief ready. Drives the processing modal's step UI.
    processing_stage: Mapped[int] = mapped_column(default=0, server_default=sa.text("0"), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    key_points_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # Full detailed report payload (timeline, Q&A, participants...) rendered into the PDF.
    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full transcript text produced during transcription, persisted for the Raw Transcript tab.
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_duration_seconds: Mapped[int | None] = mapped_column(nullable=True)
    transcription_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    summary_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Object key of a user-uploaded transcript file (VTT/SRT/DOCX/TXT). When set, the pipeline parses
    # this file instead of running audio transcription.
    transcript_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "generated" (auto transcription/captions) or "user_provided" (uploaded transcript file).
    transcript_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="generated", server_default=sa.text("'generated'")
    )
    # Per-speaker airtime breakdown (JSON list of {speaker, seconds, percent}), derived from a
    # user-provided transcript's timestamps - only available when transcript_source is user_provided.
    speaker_airtime_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )
    # Timestamped transcript lines (JSON list of {start, end, text, speaker}), used to power the
    # Raw Transcript tab's click-to-seek and video-synced highlighting.
    transcript_segments_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )
    # Short badge keywords describing the video (content type, format, topic), e.g. ["Team Meeting", "Sage"].
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default=sa.text("'[]'"))
    # User-added action items (manually typed in on the Insights page), on top of the LLM-generated ones.
    custom_action_items_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )
    # Indices of ticked-off action items within the combined [analysis.action_items, custom] list.
    # Index-keyed rather than text-keyed because custom items only ever append, so positions are stable.
    completed_action_items_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )
    # Overall tone of the recording: "Positive", "Neutral", or "Negative".
    sentiment: Mapped[str] = mapped_column(
        String(20), nullable=False, default="Neutral", server_default=sa.text("'Neutral'")
    )

    youtube_video_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    youtube_embed_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_asset_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # True only for jobs started via POST /pipeline/process-and-export-pdf, used by GET /pipeline/status.
    is_pipeline_run: Mapped[bool] = mapped_column(default=False, server_default=sa.false(), nullable=False)

    # Pipeline wall-clock, used to report real throughput (processing time vs media runtime) on Settings.
    processing_started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Append-only record of stage transitions (JSON list of {stage, at}), replayed as the live
    # processing log on the Analyzing page. Reset when a job starts or is retried.
    stage_events_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default=sa.text("'[]'")
    )

    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    owner = relationship("User", back_populates="jobs")
    project = relationship("Project", back_populates="jobs")
    collaborators = relationship("JobCollaborator", back_populates="job", passive_deletes=True)
    clips = relationship("JobClip", back_populates="job", passive_deletes=True)
    chat_messages = relationship("ChatMessage", back_populates="job", passive_deletes=True)
