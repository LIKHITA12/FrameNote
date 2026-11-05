"""Filtering, sorting, and paging for the Analysis History page."""

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.schemas.jobs import HistoryFacets, HistoryListResponse, TagCount
from app.services.jobs import accessible_jobs_filter, to_job_response

SORT_OPTIONS = {"newest", "oldest", "title", "longest"}
DATE_RANGES = {"all", "7d", "30d", "custom"}
SOURCE_FILTERS = {"youtube", "upload", "url", "zoom"}

MAX_POPULAR_TAGS = 8


def _range_start(date_range: str, now: datetime) -> datetime | None:
    if date_range == "7d":
        return now - timedelta(days=7)
    if date_range == "30d":
        return now - timedelta(days=30)
    return None


def _job_tags(job: Job) -> list[str]:
    try:
        tags = json.loads(job.tags_json or "[]")
    except ValueError:
        return []
    return [str(tag) for tag in tags] if isinstance(tags, list) else []


def list_history(
    db: Session,
    owner_id: str,
    search: str | None = None,
    sources: list[str] | None = None,
    tags: list[str] | None = None,
    date_range: str = "all",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "newest",
    limit: int = 10,
    offset: int = 0,
    project_id: str | None = None,
) -> HistoryListResponse:
    now = datetime.now(timezone.utc)

    # Facets are computed over the owner's full library so the counts stay stable while filtering.
    all_jobs = list(db.scalars(select(Job).where(accessible_jobs_filter(owner_id))).all())
    tag_counter: Counter[str] = Counter()
    for job in all_jobs:
        tag_counter.update(_job_tags(job))
    source_counts = Counter(job.source_type for job in all_jobs)

    facets = HistoryFacets(
        popular_tags=[TagCount(tag=tag, count=count) for tag, count in tag_counter.most_common(MAX_POPULAR_TAGS)],
        source_counts={
            "youtube": source_counts.get("youtube", 0),
            "upload": source_counts.get("upload", 0),
            "url": source_counts.get("url", 0),
            "zoom": 0,
        },
        total_library=len(all_jobs),
    )

    query = select(Job).where(accessible_jobs_filter(owner_id))
    if project_id:
        query = query.where(Job.project_id == project_id)

    if search:
        needle = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(func.coalesce(Job.file_name, "")).like(needle),
                func.lower(func.coalesce(Job.source_url, "")).like(needle),
                func.lower(func.coalesce(Job.summary, "")).like(needle),
                func.lower(func.coalesce(Job.tags_json, "")).like(needle),
            )
        )

    # "zoom" has no ingestion path yet, so selecting only it must return nothing rather than everything.
    selected_sources = [source for source in (sources or []) if source in SOURCE_FILTERS]
    if sources is not None:
        db_sources = [source for source in selected_sources if source in {"youtube", "upload", "url"}]
        if not db_sources:
            query = query.where(Job.id.is_(None))
        else:
            query = query.where(Job.source_type.in_(db_sources))

    start = _range_start(date_range, now)
    if date_range == "custom":
        start = date_from
        if date_to:
            query = query.where(Job.created_at <= date_to)
    if start:
        query = query.where(Job.created_at >= start)

    if sort == "oldest":
        query = query.order_by(asc(Job.created_at))
    elif sort == "title":
        query = query.order_by(asc(func.lower(func.coalesce(Job.file_name, Job.source_url, Job.id))))
    else:
        # "longest" needs the derived media duration, so it is ordered in Python below.
        query = query.order_by(desc(Job.created_at))

    matched = list(db.scalars(query).all())

    # Tag filtering uses the parsed JSON list (substring matching on the raw column would be wrong).
    wanted_tags = {tag.strip().lower() for tag in (tags or []) if tag.strip()}
    if wanted_tags:
        matched = [job for job in matched if wanted_tags & {tag.lower() for tag in _job_tags(job)}]

    responses = [to_job_response(job, viewer_id=owner_id) for job in matched]

    if sort == "longest":
        responses.sort(key=lambda item: item.duration_seconds or 0, reverse=True)

    total = len(responses)
    page = responses[offset : offset + limit]

    return HistoryListResponse(
        items=page,
        total=total,
        has_more=offset + len(page) < total,
        facets=facets,
    )
