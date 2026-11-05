"""Derives the topbar bell feed from real job activity.

There is no separate notifications table: every notification is a job that finished or failed,
so the feed can never drift out of sync with what actually happened. "Read" is tracked as a single
watermark on the user's settings row.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.user import User
from app.schemas.notifications import NotificationItem, NotificationListResponse
from app.services.user_settings import get_or_create_settings

FEED_LIMIT = 15


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    # SQLite hands back naive datetimes; assume they are already UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _occurred_at(job: Job) -> datetime | None:
    """When the job reached its terminal state. Falls back to updated_at for jobs that
    finished before processing timestamps were instrumented."""
    return _as_utc(job.processing_completed_at) or _as_utc(job.updated_at)


def _job_title(job: Job) -> str:
    if job.file_name:
        return job.file_name
    if job.source_url:
        return job.source_url
    return "Untitled recording"


def build_notification_feed(db: Session, user: User) -> NotificationListResponse:
    jobs = list(
        db.scalars(
            select(Job)
            .where(Job.owner_id == user.id, Job.status.in_(("completed", "failed")))
            .order_by(Job.updated_at.desc())
            .limit(FEED_LIMIT)
        ).all()
    )

    read_at = _as_utc(get_or_create_settings(db=db, user=user).notifications_read_at)

    items: list[NotificationItem] = []
    for job in jobs:
        occurred_at = _occurred_at(job)
        if occurred_at is None:
            continue
        completed = job.status == "completed"
        items.append(
            NotificationItem(
                job_id=job.id,
                title=_job_title(job),
                kind="completed" if completed else "failed",
                message=(
                    "Your notes are ready to read."
                    if completed
                    else (job.error_message or "Processing failed. Please retry.")
                ),
                occurred_at=occurred_at,
                unread=read_at is None or occurred_at > read_at,
            )
        )

    items.sort(key=lambda item: item.occurred_at, reverse=True)
    return NotificationListResponse(
        items=items,
        unread_count=sum(1 for item in items if item.unread),
    )


def mark_notifications_read(db: Session, user: User) -> NotificationListResponse:
    user_settings = get_or_create_settings(db=db, user=user)
    user_settings.notifications_read_at = datetime.now(timezone.utc)
    db.add(user_settings)
    db.commit()
    return build_notification_feed(db=db, user=user)
