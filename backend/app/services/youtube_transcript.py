"""Getting a transcript for a YouTube video, cheapest and fastest method first.

1. Published captions (free, ~1 second) - see processing.get_youtube_captions.
2. Gemini reads the YouTube link itself (Google fetches the video, so YouTube does not block it the
   way it often blocks cloud servers). ~30 seconds for a 30-minute video. YouTube URL input is a Gemini
   preview feature: free for now, with a free-tier cap of 8 hours of YouTube video per day.

If both fail the caller shows YOUTUBE_UNAVAILABLE_MESSAGE, which tells the user to upload the video
or paste its transcript instead (the frontend offers both buttons for failed YouTube jobs).
"""

import logging
from typing import Any, Callable

import httpx

from app.core.config import settings
from app.services.transcript_import import parse_plain_text_transcript

logger = logging.getLogger("framenote.youtube")

YOUTUBE_UNAVAILABLE_MESSAGE = (
    "We couldn't read this YouTube video. It may be private, age-restricted or blocked. "
    "Upload the video file or paste its transcript instead."
)

_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_GEMINI_PROMPT = (
    "Transcribe the spoken audio of this video verbatim, in the language that is spoken. "
    "Output one line per sentence in the form [MM:SS] sentence (use [H:MM:SS] after one hour). "
    "No headings, no commentary, no summary."
)


class YouTubeTranscriptUnavailable(ValueError):
    pass


def gemini_youtube_enabled(duration_seconds: int | None) -> bool:
    if not (settings.youtube_gemini_fallback and settings.gemini_api_key):
        return False
    # Gemini bills video by length; very long videos are refused rather than silently costing a lot.
    return duration_seconds is None or duration_seconds <= settings.youtube_gemini_max_seconds


_GEMINI_ATTEMPTS = 2
_MIN_COVERAGE = 0.8


def transcribe_youtube_with_gemini(
    video_id: str, duration_seconds: int | None = None
) -> tuple[str, list[dict[str, Any]]]:
    """Ask Gemini to watch a public YouTube video and return a timestamped transcript.

    Gemini occasionally errors or stops early, so a second attempt is made when the first one fails,
    does not finish normally, or (when the length is known) covers less than 80% of the video.
    The attempt that covers the most of the video wins.
    """
    best: tuple[str, list[dict[str, Any]]] | None = None
    best_end = -1.0
    for attempt in range(1, _GEMINI_ATTEMPTS + 1):
        try:
            text, finish_reason = _gemini_transcript_once(video_id)
        except YouTubeTranscriptUnavailable:
            continue
        parsed = parse_plain_text_transcript(text)
        if not parsed.text.strip():
            continue
        end = max((float(seg.get("end") or 0) for seg in parsed.segments), default=0.0)
        if end > best_end:
            best, best_end = (parsed.text, parsed.segments), end
        complete = finish_reason == "STOP" and (
            not duration_seconds or not parsed.segments or end >= duration_seconds * _MIN_COVERAGE
        )
        if complete:
            break
        logger.info(
            "Gemini transcript for %s looks incomplete (attempt %s, finish=%s, ends at %ss of %ss)",
            video_id, attempt, finish_reason, int(end), duration_seconds,
        )
    if best is None:
        raise YouTubeTranscriptUnavailable("Gemini could not transcribe this YouTube video")
    return best


def _gemini_transcript_once(video_id: str) -> tuple[str, str | None]:
    body = {
        "contents": [{
            "parts": [
                {"file_data": {"file_uri": f"https://www.youtube.com/watch?v={video_id}"}},
                {"text": _GEMINI_PROMPT},
            ]
        }],
        # Low resolution: we only need the audio, and it costs ~3x fewer tokens than the default.
        "generationConfig": {"mediaResolution": "MEDIA_RESOLUTION_LOW", "maxOutputTokens": 65536},
    }
    try:
        response = httpx.post(
            _GEMINI_URL.format(model=settings.gemini_model),
            # Header, not ?key=: error messages include the URL and would leak the key into logs.
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=body,
            timeout=settings.youtube_gemini_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        candidate = payload["candidates"][0]
        text = "".join(str(part.get("text") or "") for part in candidate["content"]["parts"]).strip()
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError):
            reason = f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        else:
            reason = type(exc).__name__
        logger.warning("Gemini could not transcribe YouTube video %s (%s)", video_id, reason)
        raise YouTubeTranscriptUnavailable("Gemini could not transcribe this YouTube video") from exc

    usage = payload.get("usageMetadata") or {}
    logger.info(
        "Gemini transcribed YouTube video %s (%s input / %s output tokens, finish=%s)",
        video_id, usage.get("promptTokenCount"), usage.get("candidatesTokenCount"), candidate.get("finishReason"),
    )
    return text, candidate.get("finishReason")


def transcribe_youtube(
    video_id: str,
    duration_seconds: int | None = None,
    on_model: Callable[[str], None] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Captions first, then Gemini. Raises YouTubeTranscriptUnavailable when neither works."""
    from app.services.processing import get_youtube_captions

    try:
        text, segments = get_youtube_captions(video_id)
    except ValueError as exc:
        logger.info("No usable captions for YouTube video %s (%s); trying Gemini", video_id, exc)
    else:
        if on_model:
            on_model("YouTube captions")
        return text, segments

    if not gemini_youtube_enabled(duration_seconds):
        raise YouTubeTranscriptUnavailable(YOUTUBE_UNAVAILABLE_MESSAGE)
    text, segments = transcribe_youtube_with_gemini(video_id, duration_seconds=duration_seconds)
    if on_model:
        on_model(f"Gemini {settings.gemini_model} (YouTube link)")
    return text, segments
