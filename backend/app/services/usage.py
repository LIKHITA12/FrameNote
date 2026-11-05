"""Derives real consumption numbers (hours transcribed, storage, throughput) from the user's jobs.

Powers the Settings tier card, the sidebar quota meter, and the Pricing page's "current plan" state.
"""

import json
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.core.config import settings as app_settings
from app.models.job import Job
from app.models.user import User
from app.schemas.settings import UsageMeter, UsageSummaryResponse
from app.services.auth import get_user_subscription

# Per-tier allowances. Mirrors the published plan matrix in services/plans.py.
TIER_QUOTAS: dict[str, dict[str, float | None]] = {
    "free": {"hours": 0.25, "storage_gb": 0.5, "price": 0},
    "pro": {"hours": 5.0, "storage_gb": 5.0, "price": 10},
}

TIER_LABELS: dict[str, str] = {
    "free": "Free Starter",
    "pro": "Solo Pro",
}


def _billing_period_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_billing_reset(now: datetime) -> datetime:
    days_in_month = monthrange(now.year, now.month)[1]
    return _billing_period_start(now) + timedelta(days=days_in_month)


def _job_duration_seconds(job: Job) -> float:
    """Media runtime for a job, preferring the analysis duration and falling back to transcript spans."""
    if job.media_duration_seconds and job.media_duration_seconds > 0:
        return float(job.media_duration_seconds)
    if job.analysis_json:
        try:
            analysis = json.loads(job.analysis_json)
        except ValueError:
            analysis = None
        if isinstance(analysis, dict):
            duration = analysis.get("duration_seconds")
            if isinstance(duration, (int, float)) and duration > 0:
                return float(duration)

    try:
        segments = json.loads(job.transcript_segments_json or "[]")
    except ValueError:
        segments = []
    if isinstance(segments, list) and segments:
        ends = [float(entry.get("end") or 0) for entry in segments if isinstance(entry, dict)]
        if ends:
            return max(ends)
    return 0.0


def job_insight_count(job: Job) -> int:
    """How many discrete insights were extracted - the number shown on each History row."""
    total = 0
    try:
        total += len(json.loads(job.key_points_json or "[]"))
    except ValueError:
        pass

    if job.analysis_json:
        try:
            analysis = json.loads(job.analysis_json)
        except ValueError:
            analysis = None
        if isinstance(analysis, dict):
            for key in ("headlines", "decisions", "action_items", "questions_and_answers"):
                value = analysis.get(key)
                if isinstance(value, list):
                    total += len(value)

    try:
        total += len(json.loads(job.custom_action_items_json or "[]"))
    except ValueError:
        pass
    return total


def job_duration_seconds(job: Job) -> int | None:
    seconds = _job_duration_seconds(job)
    return int(seconds) if seconds > 0 else None


def _upload_bytes(job: Job) -> int:
    if not job.upload_object_key:
        return 0
    try:
        path = Path(app_settings.local_upload_dir) / job.upload_object_key
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _average_turn_ratio(jobs: list[Job]) -> float:
    """Measured throughput: pipeline wall-clock divided by media runtime, averaged over completed jobs.

    Labelled "Average turn ratio" in the UI, where lower is faster (0.2x = a 10-minute video
    processed in 2 minutes). Jobs recorded before timing was instrumented are skipped, so this
    returns 0 until at least one job has run end-to-end with both timestamps.
    """
    ratios: list[float] = []
    for job in jobs:
        if job.status != "completed" or not job.processing_started_at or not job.processing_completed_at:
            continue
        media_seconds = _job_duration_seconds(job)
        if media_seconds <= 0:
            continue
        started = job.processing_started_at
        finished = job.processing_completed_at
        # SQLite hands back naive datetimes; assume they are already UTC.
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        elapsed = (finished - started).total_seconds()
        if elapsed <= 0:
            continue
        ratios.append(elapsed / media_seconds)

    if not ratios:
        return 0.0
    # Floor at 0.01 so a very fast run stays distinguishable from "nothing measured yet" (0.0).
    return max(0.01, round(sum(ratios) / len(ratios), 2))


def _meter(used: float, limit: float | None, unit: str) -> UsageMeter:
    if limit is None or limit <= 0:
        return UsageMeter(used=round(used, 1), limit=None, unit=unit, percent=0)
    percent = min(100.0, round((used / limit) * 100, 1))
    return UsageMeter(used=round(used, 1), limit=limit, unit=unit, percent=percent)


def build_usage_summary(db: Session, user: User) -> UsageSummaryResponse:
    subscription = get_user_subscription(db=db, user_id=user.id)
    tier = subscription.tier if subscription.tier in TIER_QUOTAS else "free"
    quota = TIER_QUOTAS[tier]

    now = datetime.now(timezone.utc)
    period_start = _billing_period_start(now)

    jobs = list(db.scalars(select(Job).where(Job.owner_id == user.id)).all())

    period_seconds = 0.0
    total_bytes = 0
    videos_this_period = 0
    insights_total = 0

    for job in jobs:
        total_bytes += _upload_bytes(job)
        insights_total += job_insight_count(job)

        created = job.created_at
        if created is not None:
            # SQLite hands back naive datetimes; assume they are already UTC.
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created >= period_start:
                videos_this_period += 1
                period_seconds += _job_duration_seconds(job)

    hours_used = period_seconds / 3600
    storage_used_gb = total_bytes / (1024**3)

    avg_turn_ratio = _average_turn_ratio(jobs)

    reset_at = _next_billing_reset(now)
    resets_in_days = max(0, (reset_at - now).days)

    return UsageSummaryResponse(
        tier=tier,
        plan_label=TIER_LABELS.get(tier, "Free Starter"),
        plan_price_monthly=int(quota["price"]) if quota["price"] is not None else None,
        subscription_status=subscription.status,
        transcription_hours=_meter(hours_used, quota["hours"], "hrs"),
        storage_gb=_meter(storage_used_gb, quota["storage_gb"], "GB"),
        videos_processed=videos_this_period,
        insights_extracted=insights_total,
        avg_turn_ratio=avg_turn_ratio,
        resets_in_days=resets_in_days,
        renews_on=reset_at,
    )


def ensure_job_creation_allowed(db: Session, user: User, source_type: str) -> None:
    """Apply the published monthly job limits before queueing new processing work."""
    subscription = get_user_subscription(db=db, user_id=user.id)
    tier = subscription.tier if subscription.status.lower() == "active" else "free"
    now = datetime.now(timezone.utc)
    period_start = _billing_period_start(now)
    jobs = list(db.scalars(select(Job).where(Job.owner_id == user.id, Job.created_at >= period_start)).all())
    # A failed job may be retried, so it must not consume a separate monthly slot.
    jobs = [job for job in jobs if job.status != "failed"]

    if tier != "pro":
        if source_type == "youtube":
            used = sum(job.source_type == "youtube" for job in jobs)
            if used >= 3:
                raise HTTPException(status_code=403, detail="Free Starter includes 3 YouTube notes per month. Upgrade or wait for the monthly reset.")
        else:
            used = sum(job.source_type in {"upload", "url"} for job in jobs)
            if used >= 1:
                raise HTTPException(status_code=403, detail="Free Starter includes 1 uploaded or linked video per month. Upgrade or wait for the monthly reset.")
        return

    used_seconds = sum(_job_duration_seconds(job) for job in jobs if job.source_type in {"upload", "url"})
    if used_seconds >= 5 * 3600:
        raise HTTPException(status_code=403, detail="Your 5 monthly transcription hours are used. Please wait for the monthly reset or contact support.")


def reserve_media_duration(db: Session, job: Job, duration_seconds: int | None) -> None:
    """Check runtime before transcription, then reserve it for concurrent submissions."""
    if not duration_seconds or job.source_type == "youtube":
        return
    user = db.get(User, job.owner_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    subscription = get_user_subscription(db=db, user_id=user.id)
    tier = subscription.tier if subscription.status.lower() == "active" else "free"
    per_video_limit = 90 * 60 if tier == "pro" else 15 * 60
    if duration_seconds > per_video_limit:
        raise HTTPException(status_code=403, detail=f"This video exceeds the {90 if tier == 'pro' else 15}-minute limit for your plan.")

    period_start = _billing_period_start(datetime.now(timezone.utc))
    other_jobs = db.scalars(select(Job).where(Job.owner_id == user.id, Job.created_at >= period_start, Job.id != job.id)).all()
    used_seconds = sum(
        _job_duration_seconds(other)
        for other in other_jobs
        if other.status != "failed" and other.source_type in {"upload", "url"}
    )
    monthly_limit = 5 * 3600 if tier == "pro" else 15 * 60
    if used_seconds + duration_seconds > monthly_limit:
        raise HTTPException(status_code=403, detail="This video would exceed your monthly transcription allowance. Try a shorter video or wait for the reset.")
    job.media_duration_seconds = duration_seconds
    db.add(job)
    db.commit()
