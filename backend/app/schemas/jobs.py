from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


# "url" covers any other public video link (Vimeo, Loom, a direct .mp4, ...) ingested via
# POST /videos/from-url; YouTube links keep their own type so the embedded player still works.
SourceType = Literal["upload", "youtube", "url"]
SentimentLabel = Literal["Positive", "Neutral", "Negative"]


class JobCreateRequest(BaseModel):
    source_type: SourceType
    source_url: str | None = None
    file_name: str | None = None
    upload_object_key: str | None = None
    # Optional user-supplied transcript file (VTT/SRT/DOCX/TXT); when set, the pipeline uses it
    # instead of running audio transcription.
    transcript_object_key: str | None = None
    transcript_file_name: str | None = None


class KeyPoint(BaseModel):
    title: str
    description: str
    timestamp_seconds: int = Field(ge=0)
    frame_image_url: str | None = None


class TimelineSection(BaseModel):
    title: str
    start_seconds: int = Field(ge=0)
    end_seconds: int = Field(ge=0)
    bullets: list[str] = Field(default_factory=list)


class QAItem(BaseModel):
    time_seconds: int = Field(ge=0)
    asked_by: str
    question: str
    answer: str


class GlossaryTerm(BaseModel):
    term: str
    meaning: str


class ParticipantsInfo(BaseModel):
    names: list[str] = Field(default_factory=list)
    count: int = 0
    source: str = "not available"


class SpeakerAirtime(BaseModel):
    speaker: str
    seconds: int
    percent: float
    turns: int = 0
    turn_start_seconds: list[int] = Field(default_factory=list)


class TranscriptSegment(BaseModel):
    start: float = 0.0
    end: float = 0.0
    text: str = ""
    speaker: str | None = None


class ActionItemDetail(BaseModel):
    title: str
    owner: str | None = None
    due: str | None = None
    priority: Literal["high", "medium", "low"] | None = None


class JobAnalysis(BaseModel):
    """Mirrors the payload shape produced by services/analysis.py::build_detailed_analysis."""

    overview: str = ""
    headlines: list[str] = Field(default_factory=list)
    timeline: list[TimelineSection] = Field(default_factory=list)
    questions_and_answers: list[QAItem] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    action_item_details: list[ActionItemDetail] = Field(default_factory=list)
    terms: list[GlossaryTerm] = Field(default_factory=list)
    participants: ParticipantsInfo = Field(default_factory=ParticipantsInfo)
    duration_seconds: int | None = None


class StageEvent(BaseModel):
    """One real pipeline transition, replayed as a line in the Analyzing page's processing log."""

    stage: int | None = None
    message: str
    at: datetime


class JobCreateResponse(BaseModel):
    job_id: str
    project_id: str | None = None
    project_name: str | None = None
    is_owner: bool = True
    status: Literal["queued", "processing", "completed", "failed"]
    processing_stage: int = 0
    summary: str
    key_points: list[KeyPoint]
    tags: list[str] = Field(default_factory=list)
    sentiment: SentimentLabel = "Neutral"
    analysis: JobAnalysis | None = None
    custom_action_items: list[str] = Field(default_factory=list)
    # Positions within [analysis.action_items, *custom_action_items] that the user has ticked off.
    completed_action_items: list[int] = Field(default_factory=list)
    stage_events: list[StageEvent] = Field(default_factory=list)
    created_at: datetime
    youtube_video_id: str | None = None
    youtube_embed_url: str | None = None
    video_url: str | None = None
    transcript_text: str | None = None
    transcription_model: str | None = None
    summary_model: str | None = None
    transcript_source: Literal["generated", "user_provided"] = "generated"
    speaker_airtime: list[SpeakerAirtime] = Field(default_factory=list)
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    source_type: SourceType
    source_url: str | None = None
    file_name: str | None = None
    error_message: str | None = None
    pdf_url: str | None = None
    # Media runtime, derived from the analysis payload (falls back to transcript segment spans).
    duration_seconds: int | None = None
    # Total discrete insights extracted (key points, headlines, decisions, action items, Q&A).
    insights_count: int = 0


class TagCount(BaseModel):
    tag: str
    count: int


class HistoryFacets(BaseModel):
    popular_tags: list[TagCount] = Field(default_factory=list)
    source_counts: dict[str, int] = Field(default_factory=dict)
    total_library: int = 0


class HistoryListResponse(BaseModel):
    items: list[JobCreateResponse] = Field(default_factory=list)
    total: int = 0
    has_more: bool = False
    facets: HistoryFacets = Field(default_factory=HistoryFacets)


class ProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    job_count: int = 0


class JobProjectRequest(BaseModel):
    project_id: str | None = None


class ShareRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class CollaboratorResponse(BaseModel):
    user_id: str
    email: str
    role: Literal["viewer"] = "viewer"


class JobNotesUpdateRequest(BaseModel):
    summary: str | None = Field(default=None, max_length=20000)
    decisions: list[str] | None = Field(default=None, max_length=100)
    action_items: list[str] | None = Field(default=None, max_length=100)


class JobClipRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    start_seconds: int = Field(ge=0)
    end_seconds: int = Field(gt=0)


class JobClipResponse(BaseModel):
    clip_id: str
    job_id: str
    title: str
    start_seconds: int
    end_seconds: int
    created_at: datetime


class CustomActionItemRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class ActionItemCompletionRequest(BaseModel):
    completed: bool


class PublicVideoUrlRequest(BaseModel):
    url: str = Field(
        min_length=8,
        max_length=2048,
        description="Public link to a video page (YouTube, Vimeo, Loom, ...) or to a video/audio file",
    )
    # False produces the short summary-only report instead of the full timeline/Q&A report.
    detailed: bool = True


class PublicVideoPreviewResponse(BaseModel):
    url: str
    provider: str
    title: str | None = None
    duration_seconds: int | None = None
    is_youtube: bool = False
    youtube_video_id: str | None = None


class UploadPresignRequest(BaseModel):
    file_name: str
    content_type: str = "application/octet-stream"
    file_size: int = Field(gt=0)


class LocalPipelineRequest(BaseModel):
    file_name: str


class UploadPresignResponse(BaseModel):
    object_key: str
    upload_url: str
    method: Literal["PUT", "POST"] = "PUT"
    headers: dict[str, str]
    fields: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int


class UserProfileResponse(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None
    tier: str
    subscription_status: str


class BillingCheckoutResponse(BaseModel):
    checkout_url: str


class PdfGenerateResponse(BaseModel):
    pdf_url: str


PipelineStatusValue = Literal["idle", "running", "completed", "failed"]


class PipelineProgress(BaseModel):
    key_points_extracted: int = 0
    pdf_generated: bool = False


class PipelineStatusResponse(BaseModel):
    status: PipelineStatusValue
    job_id: str | None = None
    source_type: SourceType | None = None
    source_url: str | None = None
    file_name: str | None = None
    progress: PipelineProgress | None = None
    pdf_url: str | None = None
    error: str | None = None
