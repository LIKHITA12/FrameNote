import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import desc, exists, or_, select, update
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.job_collaborator import JobCollaborator
from app.models.user import User
from app.core.config import settings
from app.schemas.jobs import (
    JobAnalysis,
    JobCreateRequest,
    JobCreateResponse,
    KeyPoint,
    SentimentLabel,
    SpeakerAirtime,
    StageEvent,
    TranscriptSegment,
)
from app.services.pipeline import extract_youtube_video_id
from app.services.media_access import sign_asset_url, sign_existing_asset_url
from app.services.usage import ensure_job_creation_allowed, job_duration_seconds, job_insight_count
from app.services.transcript_import import SUPPORTED_EXTENSIONS


def create_job_record(
    db: Session, payload: JobCreateRequest, owner: User, is_pipeline_run: bool = False
) -> Job:
    ensure_job_creation_allowed(db=db, user=owner, source_type=payload.source_type)
    if payload.source_type == "upload" and not payload.upload_object_key:
        raise HTTPException(status_code=400, detail="upload_object_key is required for upload source")
    if payload.source_type == "upload" and not payload.upload_object_key.startswith(f"uploads/{owner.id}/"):
        raise HTTPException(status_code=403, detail="Upload does not belong to this account")
    if payload.source_type in {"youtube", "url"} and not payload.source_url:
        raise HTTPException(
            status_code=400, detail=f"source_url is required for {payload.source_type} source"
        )

    youtube_video_id: str | None = None
    youtube_embed_url: str | None = None
    if payload.source_type == "youtube" and payload.source_url:
        youtube_video_id = extract_youtube_video_id(payload.source_url)
        if not youtube_video_id:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        youtube_embed_url = f"https://www.youtube.com/embed/{youtube_video_id}"

    transcript_object_key = payload.transcript_object_key if payload.source_type == "upload" else None
    if transcript_object_key and not transcript_object_key.startswith(f"uploads/{owner.id}/"):
        raise HTTPException(status_code=403, detail="Transcript does not belong to this account")
    transcript_file_name = payload.transcript_file_name if transcript_object_key else None
    if transcript_file_name and not transcript_file_name.lower().endswith(SUPPORTED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported transcript file type. Supported: {', '.join(SUPPORTED_EXTENSIONS)}",
        )

    job = Job(
        owner_id=owner.id,
        source_type=payload.source_type,
        source_url=payload.source_url,
        file_name=payload.file_name,
        upload_object_key=payload.upload_object_key,
        transcript_object_key=transcript_object_key,
        transcript_file_name=transcript_file_name,
        status="queued",
        summary="Job accepted. Worker will start processing shortly.",
        key_points_json="[]",
        youtube_video_id=youtube_video_id,
        youtube_embed_url=youtube_embed_url,
        is_pipeline_run=is_pipeline_run,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job_or_404(db: Session, job_id: str, owner_id: str | None = None) -> Job:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if owner_id and job.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def accessible_jobs_filter(user_id: str):
    return or_(
        Job.owner_id == user_id,
        exists(select(JobCollaborator.id).where(JobCollaborator.job_id == Job.id, JobCollaborator.user_id == user_id)),
    )


def get_accessible_job_or_404(db: Session, job_id: str, user_id: str) -> Job:
    job = db.scalar(select(Job).where(Job.id == job_id, accessible_jobs_filter(user_id)))
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def list_jobs_for_owner(db: Session, owner_id: str, limit: int = 30) -> list[Job]:
    query = select(Job).where(accessible_jobs_filter(owner_id)).order_by(desc(Job.created_at)).limit(limit)
    return list(db.scalars(query).all())


def get_latest_pipeline_run(db: Session, owner_id: str) -> Job | None:
    query = (
        select(Job)
        .where(Job.owner_id == owner_id, Job.is_pipeline_run.is_(True))
        .order_by(desc(Job.created_at))
        .limit(1)
    )
    return db.scalars(query).first()


def build_pdf_url(job: Job, viewer_id: str | None = None) -> str | None:
    if not job.pdf_asset_key:
        return None
    return sign_asset_url(job, job.pdf_asset_key, viewer_id or job.owner_id)


def build_video_url(job: Job, viewer_id: str | None = None) -> str | None:
    if job.source_type != "upload" or not job.upload_object_key:
        return None
    return sign_asset_url(job, job.upload_object_key, viewer_id or job.owner_id)


def reset_pipeline_run_state(db: Session, owner_id: str) -> None:
    # Un-flags past pipeline jobs so GET /pipeline/status stops surfacing them and reports idle.
    query = select(Job).where(Job.owner_id == owner_id, Job.is_pipeline_run.is_(True))
    jobs = list(db.scalars(query).all())
    for job in jobs:
        job.is_pipeline_run = False
        db.add(job)
    if jobs:
        db.commit()


_VALID_SENTIMENTS: set[str] = {"Positive", "Neutral", "Negative"}


def _coerce_sentiment(value: str | None) -> SentimentLabel:
    return value if value in _VALID_SENTIMENTS else "Neutral"  # type: ignore[return-value]


def _parse_job_analysis(job: Job) -> JobAnalysis | None:
    raw = get_job_analysis(job)
    if not raw:
        return None
    try:
        return JobAnalysis.model_validate(raw)
    except ValidationError:
        # LLM-produced payload didn't match the expected shape; degrade to no analysis rather than 500.
        return None


def to_job_response(job: Job, viewer_id: str | None = None) -> JobCreateResponse:
    viewer_id = viewer_id or job.owner_id
    raw_points = json.loads(job.key_points_json or "[]")
    key_points = [KeyPoint(**point) for point in raw_points]
    for point in key_points:
        point.frame_image_url = sign_existing_asset_url(job, point.frame_image_url, viewer_id)
    analysis = _parse_job_analysis(job)
    if analysis:
        for section in analysis.timeline:
            if hasattr(section, "frame_image_url"):
                section.frame_image_url = sign_existing_asset_url(job, section.frame_image_url, viewer_id)
    tags = json.loads(job.tags_json or "[]")
    raw_airtime = json.loads(job.speaker_airtime_json or "[]")
    speaker_airtime = [SpeakerAirtime(**entry) for entry in raw_airtime] if isinstance(raw_airtime, list) else []
    raw_segments = json.loads(job.transcript_segments_json or "[]")
    transcript_segments = (
        [TranscriptSegment(**entry) for entry in raw_segments] if isinstance(raw_segments, list) else []
    )
    custom_action_items = json.loads(job.custom_action_items_json or "[]")
    raw_completed = json.loads(job.completed_action_items_json or "[]")
    completed_action_items = (
        [int(value) for value in raw_completed if isinstance(value, int)]
        if isinstance(raw_completed, list)
        else []
    )
    raw_events = json.loads(job.stage_events_json or "[]")
    stage_events = (
        [StageEvent(**entry) for entry in raw_events if isinstance(entry, dict)]
        if isinstance(raw_events, list)
        else []
    )
    return JobCreateResponse(
        job_id=job.id,
        project_id=job.project_id,
        project_name=job.project.name if job.project else None,
        is_owner=job.owner_id == viewer_id,
        status=job.status,
        processing_stage=job.processing_stage,
        source_type=job.source_type,
        source_url=job.source_url,
        file_name=job.file_name,
        summary=job.summary,
        key_points=key_points,
        tags=tags if isinstance(tags, list) else [],
        sentiment=_coerce_sentiment(job.sentiment),
        analysis=analysis,
        custom_action_items=custom_action_items if isinstance(custom_action_items, list) else [],
        completed_action_items=completed_action_items,
        stage_events=stage_events,
        created_at=job.created_at,
        youtube_video_id=job.youtube_video_id,
        youtube_embed_url=job.youtube_embed_url,
        video_url=build_video_url(job, viewer_id),
        transcript_text=job.transcript_text,
        transcription_model=job.transcription_model,
        summary_model=job.summary_model,
        transcript_source="user_provided" if job.transcript_source == "user_provided" else "generated",
        speaker_airtime=speaker_airtime,
        transcript_segments=transcript_segments,
        error_message=job.error_message,
        pdf_url=build_pdf_url(job, viewer_id),
        duration_seconds=job_duration_seconds(job),
        insights_count=job_insight_count(job),
    )


# Human-readable names for the pipeline stages recorded in stage_events_json. Stage numbers are
# the same contract documented on Job.processing_stage and emitted by run_job_pipeline's on_stage.
STAGE_LABELS: dict[int, str] = {
    1: "Audio extracted from source media",
    2: "Transcription complete",
    3: "AI summary generated",
    4: "Formatted brief ready",
}


def _append_stage_event(job: Job, message: str, stage: int | None = None) -> None:
    try:
        events = json.loads(job.stage_events_json or "[]")
    except ValueError:
        events = []
    if not isinstance(events, list):
        events = []
    events.append(
        {"stage": stage, "message": message, "at": datetime.now(timezone.utc).isoformat()}
    )
    job.stage_events_json = json.dumps(events)


def mark_job_processing(db: Session, job: Job) -> None:
    job.status = "processing"
    job.processing_stage = 0
    job.error_message = None
    job.processing_started_at = datetime.now(timezone.utc)
    job.processing_completed_at = None
    # Retries replay the pipeline from scratch, so the previous run's log would be misleading.
    job.stage_events_json = "[]"
    _append_stage_event(job, "Processing started", stage=0)
    db.add(job)
    db.commit()


def mark_job_completed(db: Session, job: Job, result: dict[str, Any]) -> None:
    job.status = "completed"
    job.processing_stage = 4
    job.processing_completed_at = datetime.now(timezone.utc)
    job.summary = str(result.get("summary") or "Summary unavailable")
    job.key_points_json = json.dumps(result.get("key_points") or [])
    job.tags_json = json.dumps(result.get("tags") or [])
    job.sentiment = _coerce_sentiment(result.get("sentiment"))
    analysis = result.get("analysis")
    job.analysis_json = json.dumps(analysis) if analysis else None
    transcript = str(result.get("transcript") or "").strip()
    job.transcript_text = transcript or None
    job.media_duration_seconds = result.get("duration_seconds") or job.media_duration_seconds
    job.transcription_model = result.get("transcription_model")
    job.summary_model = result.get("summary_model")
    job.transcript_source = "user_provided" if job.transcript_object_key else "generated"
    job.speaker_airtime_json = json.dumps(result.get("speaker_airtime") or [])
    job.transcript_segments_json = json.dumps(result.get("segments") or [])
    _append_stage_event(job, "Brief ready", stage=4)
    db.add(job)
    db.commit()


def advance_job_stage(db: Session, job_id: str, stage: int) -> None:
    """Bump the job's processing_stage forward (never backward) and commit immediately
    so polling clients see progress as each pipeline phase completes."""
    job = db.get(Job, job_id)
    if job is None or job.processing_stage >= stage:
        return
    job.processing_stage = stage
    _append_stage_event(job, STAGE_LABELS.get(stage, f"Stage {stage} complete"), stage=stage)
    db.add(job)
    db.commit()


def get_job_analysis(job: Job) -> dict[str, Any] | None:
    if not job.analysis_json:
        return None
    try:
        parsed = json.loads(job.analysis_json)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def set_job_source_title(db: Session, job: Job, title: str | None) -> None:
    """Name a link-sourced job after the video's own title, so history/PDF show something readable."""
    cleaned = " ".join(str(title or "").split())
    if not cleaned or job.file_name:
        return
    job.file_name = cleaned[:300]
    db.add(job)
    db.commit()


def set_job_pdf_asset_key(db: Session, job: Job, asset_key: str) -> None:
    job.pdf_asset_key = asset_key
    db.add(job)
    db.commit()


def add_custom_action_item(db: Session, job: Job, text: str) -> Job:
    items = json.loads(job.custom_action_items_json or "[]")
    if not isinstance(items, list):
        items = []
    items.append(text)
    job.custom_action_items_json = json.dumps(items)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_failed(db: Session, job: Job, reason: str) -> None:
    job.status = "failed"
    job.summary = "Processing failed. Please retry."
    job.error_message = reason[:4000]
    job.processing_completed_at = datetime.now(timezone.utc)
    _append_stage_event(job, f"Processing failed: {reason[:200]}")
    db.add(job)
    db.commit()


STALE_JOB_REASON = "Processing was interrupted before it finished. Please retry."


def fail_stale_jobs(db: Session, now: datetime | None = None) -> int:
    """Fail jobs a lost worker left behind, so clients stop polling and the user can retry.

    A job is stale when it has been "processing" longer than the worker's hard time limit
    (the worker that owned it is gone) or "queued" longer than stale_queued_job_seconds.
    """
    now = now or datetime.now(timezone.utc)
    processing_cutoff = now - timedelta(seconds=settings.job_hard_time_limit_seconds + 300)
    queued_cutoff = now - timedelta(seconds=settings.stale_queued_job_seconds)
    stale_ids = db.scalars(
        select(Job.id).where(
            or_(
                (Job.status == "processing") & (Job.processing_started_at < processing_cutoff),
                (Job.status == "queued") & (Job.updated_at < queued_cutoff),
            )
        )
    ).all()
    failed = 0
    for job_id in stale_ids:
        # Re-check the status in the UPDATE so a job that finished meanwhile is left alone.
        changed = db.execute(
            update(Job)
            .where(Job.id == job_id, Job.status.in_(("processing", "queued")))
            .values(status="failed", summary="Processing failed. Please retry.", error_message=STALE_JOB_REASON, processing_completed_at=now)
        )
        failed += changed.rowcount
    db.commit()
    return failed


def prepare_job_retry(db: Session, job: Job) -> Job:
    """Return a failed workspace job to the queue without exposing stale results."""
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried")
    if job.is_pipeline_run:
        raise HTTPException(status_code=400, detail="Pipeline jobs must be restarted from the pipeline endpoint")
    changed = db.execute(
        update(Job)
        .where(Job.id == job.id, Job.status == "failed")
        .values(
            status="queued",
            processing_stage=0,
            summary="Retry queued. Worker will start processing shortly.",
            error_message=None,
            processing_started_at=None,
            processing_completed_at=None,
            stage_events_json="[]",
            analysis_json=None,
            key_points_json="[]",
            pdf_asset_key=None,
            transcript_text=None,
            transcript_segments_json="[]",
            media_duration_seconds=None,
            transcription_model=None,
            summary_model=None,
        )
    )
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This job is already queued for retry")
    db.commit()
    db.refresh(job)
    return job


def set_action_item_completed(db: Session, job: Job, index: int, completed: bool) -> Job:
    """Tick/untick an action item by its position in the combined LLM + custom list."""
    total = len(get_job_action_items(job))
    if index < 0 or index >= total:
        raise HTTPException(status_code=404, detail="Action item not found")

    try:
        done = json.loads(job.completed_action_items_json or "[]")
    except ValueError:
        done = []
    indices = {int(value) for value in done if isinstance(value, int)} if isinstance(done, list) else set()

    if completed:
        indices.add(index)
    else:
        indices.discard(index)

    job.completed_action_items_json = json.dumps(sorted(indices))
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job_action_items(job: Job) -> list[str]:
    """The combined action-item list the Insights page renders: LLM-generated first, then custom."""
    analysis = get_job_analysis(job) or {}
    generated = analysis.get("action_items")
    items = [str(item) for item in generated] if isinstance(generated, list) else []

    try:
        custom = json.loads(job.custom_action_items_json or "[]")
    except ValueError:
        custom = []
    if isinstance(custom, list):
        items.extend(str(item) for item in custom)
    return items
