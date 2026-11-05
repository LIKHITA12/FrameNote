from typing import Any

from app.models.job import Job
from app.schemas.key_moments import DetailedKeyMoment, DetailedKeyMomentsResponse
from app.services.jobs import get_job_analysis


def frame_timestamp(start_seconds: int, end_seconds: int) -> int:
    """Match the frame position used by the video processing pipeline."""
    return start_seconds + min(20, max(0, (end_seconds - start_seconds) // 4))


def build_detailed_key_moments(job: Job) -> DetailedKeyMomentsResponse:
    analysis = get_job_analysis(job) or {}
    raw_timeline = analysis.get("timeline")
    if not isinstance(raw_timeline, list):
        return DetailedKeyMomentsResponse(job_id=job.id, total=0, items=[])

    items: list[DetailedKeyMoment] = []
    for raw in raw_timeline:
        item = _parse_moment(raw)
        if item is not None:
            items.append(item)

    items.sort(key=lambda item: (item.start_seconds, item.end_seconds, item.title.lower()))
    return DetailedKeyMomentsResponse(job_id=job.id, total=len(items), items=items)


def _parse_moment(raw: Any) -> DetailedKeyMoment | None:
    if not isinstance(raw, dict):
        return None

    title = str(raw.get("title") or "").strip()
    bullets = _clean_bullets(raw.get("bullets"))
    if not title or not bullets:
        return None

    start = _non_negative_seconds(raw.get("start_seconds"))
    end = max(start, _non_negative_seconds(raw.get("end_seconds")))
    stored_frame_timestamp = raw.get("frame_timestamp_seconds")
    capture_at = (
        _non_negative_seconds(stored_frame_timestamp)
        if stored_frame_timestamp is not None
        else frame_timestamp(start, end)
    )
    capture_at = min(max(start, capture_at), end) if end > start else start

    frame_url = raw.get("frame_image_url")
    if not isinstance(frame_url, str) or not frame_url.strip():
        frame_url = None

    return DetailedKeyMoment(
        title=title,
        start_seconds=start,
        end_seconds=end,
        frame_timestamp_seconds=capture_at,
        bullets=bullets,
        frame_image_url=frame_url,
    )


def _clean_bullets(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [text for value in raw if (text := str(value or "").strip())]


def _non_negative_seconds(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0
