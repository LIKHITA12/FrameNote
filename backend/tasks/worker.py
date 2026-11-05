import json
import logging

from celery import Celery
from celery.exceptions import SoftTimeLimitExceeded

from app.core.config import settings
from app.db import SessionLocal
from app.services.jobs import (
    advance_job_stage,
    fail_stale_jobs,
    get_job_analysis,
    get_job_or_404,
    mark_job_completed,
    mark_job_failed,
    mark_job_processing,
    set_job_pdf_asset_key,
    set_job_source_title,
)
from app.services.pdf import generate_job_pdf, generate_job_summary_pdf
from app.services.processing import run_job_pipeline
from app.services.video_url import run_public_video_pipeline
from app.services.local_pipeline import export_pdf_to_local_output
from app.services.storage import build_processed_asset_path
from app.services.usage import reserve_media_duration

logger = logging.getLogger("framenote.worker")

celery_app = Celery("framenote", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    # Ack only after a task finishes, and requeue it if the worker process dies mid-job
    # (deploy, OOM), so a crash never leaves a job stuck in "processing".
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=settings.job_soft_time_limit_seconds,
    task_time_limit=settings.job_hard_time_limit_seconds,
    # Redis redelivers unacked tasks after this timeout; it must outlast the longest allowed job.
    broker_transport_options={"visibility_timeout": settings.job_hard_time_limit_seconds + 600},
    beat_schedule={
        "fail-stale-jobs": {
            "task": "tasks.fail_stale_jobs",
            "schedule": float(settings.stale_job_sweep_interval_seconds),
        }
    },
)

TIMEOUT_REASON = "Processing took too long and was stopped. Try a shorter video or retry later."


def _claim_job(db, job_id: str):
    """Load the job and mark it processing, or return None if a redelivered task already finished it."""
    job = get_job_or_404(db=db, job_id=job_id)
    if job.status == "completed":
        logger.info("Skipping job %s: already completed", job_id)
        return None
    mark_job_processing(db=db, job=job)
    return job


def _fail_job(db, job_id: str, exc: Exception) -> None:
    if isinstance(exc, SoftTimeLimitExceeded):
        logger.warning("Job %s hit the soft time limit", job_id)
        reason = TIMEOUT_REASON
    else:
        logger.exception("Job %s failed", job_id)
        reason = str(exc)
    try:
        db.rollback()
        job = get_job_or_404(db=db, job_id=job_id)
        mark_job_failed(db=db, job=job, reason=reason)
    except Exception:
        logger.exception("Could not mark job %s as failed", job_id)


def _stage_reporter(job_id: str):
    """Returns an on_stage callback that persists progress on its own short-lived DB session,
    so polling clients see each pipeline stage as soon as it completes."""

    def report(stage: int) -> None:
        db = SessionLocal()
        try:
            advance_job_stage(db=db, job_id=job_id, stage=stage)
        finally:
            db.close()

    return report


@celery_app.task
def ping() -> str:
    return "pong"


@celery_app.task(name="tasks.process_job")
def process_job(job_id: str, detailed: bool = False) -> None:
    db = SessionLocal()
    try:
        job = _claim_job(db, job_id)
        if job is None:
            return
        result = run_job_pipeline(job=job, detailed=detailed, on_stage=_stage_reporter(job_id), on_duration=lambda duration: reserve_media_duration(db, job, duration))
        mark_job_completed(db=db, job=job, result=result)
    except Exception as exc:
        _fail_job(db, job_id, exc)
    finally:
        db.close()


@celery_app.task(name="tasks.run_video_processing_pipeline")
def run_video_processing_pipeline(job_id: str) -> None:
    """End-to-end worker job: transcribe/analyze the source, then render the final PDF report."""
    db = SessionLocal()
    try:
        job = _claim_job(db, job_id)
        if job is None:
            return
        result = run_job_pipeline(job=job, on_stage=_stage_reporter(job_id), on_duration=lambda duration: reserve_media_duration(db, job, duration))
        mark_job_completed(db=db, job=job, result=result)

        job = get_job_or_404(db=db, job_id=job_id)
        key_points = json.loads(job.key_points_json or "[]")
        asset_key = generate_job_pdf(job=job, key_points=key_points, analysis=get_job_analysis(job))
        set_job_pdf_asset_key(db=db, job=job, asset_key=asset_key)
    except Exception as exc:
        _fail_job(db, job_id, exc)
    finally:
        db.close()


@celery_app.task(name="tasks.run_summary_pdf_pipeline")
def run_summary_pdf_pipeline(job_id: str) -> None:
    """Lighter worker job: transcribe, summarize, then render the summary-only PDF report."""
    db = SessionLocal()
    try:
        job = _claim_job(db, job_id)
        if job is None:
            return
        result = run_job_pipeline(job=job, detailed=False, on_stage=_stage_reporter(job_id), on_duration=lambda duration: reserve_media_duration(db, job, duration))
        mark_job_completed(db=db, job=job, result=result)

        job = get_job_or_404(db=db, job_id=job_id)
        key_points = json.loads(job.key_points_json or "[]")
        asset_key = generate_job_summary_pdf(job=job, key_points=key_points)
        set_job_pdf_asset_key(db=db, job=job, asset_key=asset_key)
    except Exception as exc:
        _fail_job(db, job_id, exc)
    finally:
        db.close()


@celery_app.task(name="tasks.process_public_video_url")
def process_public_video_url(job_id: str, detailed: bool = True) -> None:
    """Public-link pipeline: resolve the URL, transcribe its audio, then render the PDF.

    The report is always rendered with include_frames=False: nothing is ever screenshotted
    from a video we only have a link to.
    """
    db = SessionLocal()
    try:
        job = _claim_job(db, job_id)
        if job is None:
            return
        result = run_public_video_pipeline(job=job, detailed=detailed, on_stage=_stage_reporter(job_id), on_duration=lambda duration: reserve_media_duration(db, job, duration))
        mark_job_completed(db=db, job=job, result=result)
        set_job_source_title(db=db, job=job, title=result.get("source_title"))

        job = get_job_or_404(db=db, job_id=job_id)
        key_points = json.loads(job.key_points_json or "[]")
        if detailed:
            asset_key = generate_job_pdf(
                job=job, key_points=key_points, analysis=get_job_analysis(job), include_frames=False
            )
        else:
            asset_key = generate_job_summary_pdf(job=job, key_points=key_points, include_frames=False)
        set_job_pdf_asset_key(db=db, job=job, asset_key=asset_key)
    except Exception as exc:
        _fail_job(db, job_id, exc)
    finally:
        db.close()


@celery_app.task(name="tasks.run_local_test_pipeline")
def run_local_test_pipeline(job_id: str) -> None:
    """Same as run_video_processing_pipeline, plus copies the finished PDF into backend/output/ for local testing."""
    db = SessionLocal()
    try:
        job = _claim_job(db, job_id)
        if job is None:
            return
        result = run_job_pipeline(job=job, on_stage=_stage_reporter(job_id))
        mark_job_completed(db=db, job=job, result=result)

        job = get_job_or_404(db=db, job_id=job_id)
        key_points = json.loads(job.key_points_json or "[]")
        asset_key = generate_job_pdf(job=job, key_points=key_points, analysis=get_job_analysis(job))
        set_job_pdf_asset_key(db=db, job=job, asset_key=asset_key)

        pdf_path = build_processed_asset_path(asset_key)
        export_pdf_to_local_output(pdf_path=pdf_path, job_id=job_id)
    except Exception as exc:
        _fail_job(db, job_id, exc)
    finally:
        db.close()


@celery_app.task(name="tasks.fail_stale_jobs")
def fail_stale_jobs_task() -> int:
    """Periodic sweep (celery beat) that fails jobs a lost worker left in processing/queued."""
    db = SessionLocal()
    try:
        failed = fail_stale_jobs(db=db)
        if failed:
            logger.warning("Marked %s stale job(s) as failed", failed)
        return failed
    finally:
        db.close()
