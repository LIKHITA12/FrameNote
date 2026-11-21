"""Hand a job to the Celery worker, with an in-process fallback for local development only."""

import logging
from typing import Any

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.job import Job
from app.services.jobs import mark_job_failed

logger = logging.getLogger("framenote.dispatch")

QUEUE_UNAVAILABLE_REASON = "The processing queue was unavailable. Please retry in a few minutes."


def enqueue_job_task(task: Any, args: tuple, background_tasks: BackgroundTasks, db: Session, job: Job) -> None:
    try:
        if settings.environment != "production":
            # Check for a live worker *before* queueing: a task left in Redis would otherwise be picked up
            # by the next worker that starts, on top of the in-process run below (the job processed twice).
            inspector = task.app.control.inspect(timeout=0.5)
            if not (inspector and inspector.ping()):
                raise RuntimeError("No Celery worker is responding")
        task.apply_async(args=args, retry=False)
        return
    except Exception as exc:
        if settings.environment != "production":
            # No broker running locally: run the same task in-process after the response is sent,
            # so the client still gets the job id immediately and can poll for stage progress.
            logger.info("Using local in-process processing for job %s: %s", job.id, exc)
            background_tasks.add_task(task, *args)
            return
        logger.exception("Could not enqueue job %s", job.id)

    # In production the API must never run ffmpeg/Whisper/LLM work itself. Failed jobs don't count
    # toward plan limits, so the user can simply retry once the queue is back.
    mark_job_failed(db=db, job=job, reason=QUEUE_UNAVAILABLE_REASON)
    raise HTTPException(status_code=503, detail="Processing is temporarily unavailable. Please try again shortly.")
