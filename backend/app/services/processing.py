import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any, Callable

from openai import OpenAI

from app.core.config import settings
from app.models.job import Job
from app.services.analysis import build_detailed_analysis
from app.services.storage import resolve_uploaded_object_path

# Frames sampled purely so the analyzer can read the on-screen participant names.
PARTICIPANT_FRAME_RATIOS = (0.002, 0.02, 0.25, 0.55, 0.95)

OnStage = Callable[[int], None]


def analyse_transcript(
    transcript: str,
    segments: list[dict[str, Any]],
    source_type: str,
    duration_seconds: int | None,
    detailed: bool = True,
    participant_frames: list[Path] | None = None,
    on_summary_done: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Summary, key points, tags, sentiment and (when detailed) the full report analysis.

    Shared by the local-media pipeline below and the public-link pipeline in
    services/video_url.py. It never produces frame images: a caller whose source allows
    screenshots attaches them to the returned payload afterwards.
    """
    summary, key_points, tags, sentiment, summary_model = _summarize_transcript(transcript=transcript, source_type=source_type)
    if on_summary_done:
        on_summary_done()

    analysis = None
    if detailed:
        analysis = build_detailed_analysis(
            transcript=transcript,
            segments=segments,
            duration_seconds=duration_seconds,
            participant_frames=participant_frames or [],
        )

    return {
        "summary": summary,
        "key_points": _normalize_key_points(key_points=key_points, duration_seconds=duration_seconds),
        "tags": tags,
        "sentiment": sentiment,
        "analysis": analysis,
        "transcript": transcript,
        "segments": segments,
        "duration_seconds": duration_seconds,
        "summary_model": summary_model,
    }


def run_job_pipeline(job: Job, detailed: bool = True, on_stage: OnStage | None = None, on_duration: Callable[[int | None], None] | None = None) -> dict[str, Any]:
    """Transcribe and analyse a local/captioned source. With detailed=False only the short summary is produced.

    on_stage(n), when provided, is invoked as each of the 4 client-facing stages completes:
    1=audio extracted, 2=transcribed, 3=AI summarizing done, 4=formatted brief ready.
    """
    transcription_models: list[str] = []
    transcript, segments, media_path, duration_seconds, speaker_airtime = _build_transcript(
        job, on_stage=on_stage, on_duration=on_duration, on_model=transcription_models.append
    )

    participant_frames: list[Path] = []
    if detailed and media_path is not None:
        participant_frames = _extract_participant_frames(
            job_id=job.id, media_path=media_path, duration_seconds=duration_seconds
        )

    result = analyse_transcript(
        transcript=transcript,
        segments=segments,
        source_type=job.source_type,
        duration_seconds=duration_seconds,
        detailed=detailed,
        participant_frames=participant_frames,
        on_summary_done=(lambda: on_stage(3)) if on_stage else None,
    )
    result["speaker_airtime"] = speaker_airtime
    result["transcription_model"] = transcription_models[-1] if transcription_models else None

    if job.source_type == "upload" and media_path is not None:
        result["key_points"] = _attach_upload_frames(
            job_id=job.id, media_path=media_path, key_points=result["key_points"]
        )
        if result["analysis"]:
            result["analysis"]["timeline"] = _attach_timeline_frames(
                job_id=job.id, media_path=media_path, sections=result["analysis"].get("timeline") or []
            )

    if on_stage:
        on_stage(4)

    return result


def _build_transcript(
    job: Job, on_stage: OnStage | None = None, on_duration: Callable[[int | None], None] | None = None,
    on_model: Callable[[str], None] | None = None,
) -> tuple[str, list[dict[str, Any]], Path | None, int | None, list[dict[str, Any]]]:
    if job.source_type == "youtube":
        if not job.youtube_video_id:
            raise ValueError("YouTube video id is missing")
        # No separate audio-extraction phase for captions-based sources.
        if on_stage:
            on_stage(1)
        text, segments = get_youtube_captions(job.youtube_video_id)
        if on_model:
            on_model("YouTube captions")
        if on_stage:
            on_stage(2)
        return text, segments, None, None, []

    if not job.upload_object_key:
        raise ValueError("upload_object_key is missing for upload job")

    local_path = resolve_uploaded_object_path(job.upload_object_key)
    duration = probe_duration_seconds(local_path)
    if on_duration:
        on_duration(duration)

    if job.transcript_object_key:
        # A user-supplied transcript file replaces audio transcription entirely.
        if on_stage:
            on_stage(1)
        text, segments, speaker_airtime = _load_user_transcript(job)
        if on_model:
            on_model("User-provided transcript")
        if on_stage:
            on_stage(2)
        return text, segments, local_path, duration, speaker_airtime

    on_audio_extracted = (lambda: on_stage(1)) if on_stage else None
    text, segments = _transcribe_uploaded_media(local_path, on_audio_extracted=on_audio_extracted, on_model=on_model)
    if on_stage:
        on_stage(2)
    return text, segments, local_path, duration, []


def _load_user_transcript(job: Job) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    from app.services.transcript_import import parse_transcript_file

    transcript_path = resolve_uploaded_object_path(job.transcript_object_key)
    parsed = parse_transcript_file(transcript_path, job.transcript_file_name or job.transcript_object_key)
    if not parsed.text.strip():
        raise ValueError("Uploaded transcript file did not contain any readable text")
    return parsed.text, parsed.segments, parsed.speaker_airtime


def get_youtube_captions(video_id: str) -> tuple[str, list[dict[str, Any]]]:
    """Read a YouTube video's published captions. Raises ValueError when none are usable."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        transcript_items = YouTubeTranscriptApi.get_transcript(video_id, languages=["en"])
    except Exception as exc:
        raise ValueError("Captions unavailable for this YouTube video") from exc

    lines = [item.get("text", "").strip() for item in transcript_items if item.get("text")]
    merged = " ".join(lines).strip()
    if not merged:
        raise ValueError("Transcript is empty")

    segments = [
        {
            "start": float(item.get("start") or 0.0),
            "end": float(item.get("start") or 0.0) + float(item.get("duration") or 0.0),
            "text": str(item.get("text") or "").strip(),
        }
        for item in transcript_items
        if str(item.get("text") or "").strip()
    ]
    return merged, segments


def _transcribe_uploaded_media(
    local_path: Any, on_audio_extracted: Callable[[], None] | None = None,
    on_model: Callable[[str], None] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    audio_path = extract_audio_track(Path(local_path))
    if on_audio_extracted:
        on_audio_extracted()
    return transcribe_audio_file(audio_path, on_model=on_model)


def transcribe_audio_file(audio_path: Path, on_model: Callable[[str], None] | None = None) -> tuple[str, list[dict[str, Any]]]:
    """Transcribe an already-extracted audio file, trying local Whisper, then OpenAI, then Gemini."""
    local_result = _try_temp_local_whisper(audio_path)
    if local_result is not None:
        if on_model:
            on_model(f"Local Whisper ({os.getenv('TEMP_WHISPER_MODEL_SIZE', 'base')})")
        return local_result

    if settings.openai_api_key:
        client = OpenAI(api_key=settings.openai_api_key)
        with open(audio_path, "rb") as media_file:
            transcript = client.audio.transcriptions.create(
                model=settings.openai_transcription_model,
                file=media_file,
                response_format="verbose_json",
            )
        text = getattr(transcript, "text", "")
        if not text:
            raise ValueError("Transcription returned empty output")
        if on_model:
            on_model(settings.openai_transcription_model)
        raw_segments = getattr(transcript, "segments", None) or []
        segments = [
            {
                "start": float(getattr(segment, "start", 0.0) or 0.0),
                "end": float(getattr(segment, "end", 0.0) or 0.0),
                "text": str(getattr(segment, "text", "") or "").strip(),
            }
            for segment in raw_segments
        ]
        return text, [segment for segment in segments if segment["text"]]

    if settings.gemini_api_key:
        if on_model:
            on_model(settings.gemini_model)
        return _transcribe_with_gemini(audio_path), []

    if settings.environment == "production":
        raise ValueError("No transcription provider is configured")
    if on_model:
        on_model("Placeholder transcript")
    return ("No AI key is configured, so this is a placeholder transcript for local development.", [])


def _try_temp_local_whisper(audio_path: Path) -> tuple[str, list[dict[str, Any]]] | None:
    """Optional stopgap path; delete app/services/temp_local_whisper.py to fully remove it."""
    if not settings.temp_providers_enabled:
        return None
    try:
        from app.services.temp_local_whisper import transcribe_locally_with_segments
    except ImportError:
        return None
    return transcribe_locally_with_segments(audio_path)


def _transcribe_with_gemini(audio_path: Path) -> str:
    import google.generativeai as genai

    genai.configure(api_key=settings.gemini_api_key)
    uploaded_file = genai.upload_file(str(audio_path))
    model = genai.GenerativeModel(settings.gemini_model)
    response = model.generate_content(
        [uploaded_file, "Transcribe this audio verbatim. Return only the transcript text, no commentary."]
    )
    text = (getattr(response, "text", "") or "").strip()
    if not text:
        raise ValueError("Gemini transcription returned empty output")
    return text


_SUMMARY_PROMPT = (
    "You are a video analysis assistant. Return JSON with this exact shape: "
    "{\"summary\": string, \"key_points\": [{\"title\": string, \"description\": string, "
    "\"timestamp_seconds\": integer}], \"tags\": [string], \"sentiment\": string}. "
    "Use 3 concise key points. If exact timestamps are unknown, estimate plausible timestamps in seconds. "
    "\"tags\" is exactly 3 short badge labels (1-3 words each, Title Case, no punctuation) describing the "
    "content, in this order: "
    "(1) the format of the recording, e.g. \"Teams Meeting\", \"Product Demo\", \"Tutorial\", \"Interview\", "
    "\"Webinar\", \"Lecture\", \"Screen Recording\"; "
    "(2) the main product, project, or team the video is about, using the actual name said in the transcript "
    "(e.g. \"Sage\", \"Billing Platform\"); "
    "(3) the main theme or activity discussed, e.g. \"Onboarding\", \"Roadmap Review\", \"Troubleshooting\", "
    "\"AI Governance\". "
    "Never output generic labels like \"Video\", \"Upload\", \"Recording\", or \"Meeting\" on their own, and only "
    "use what is actually said in the transcript. "
    "\"sentiment\" is exactly one of \"Positive\", \"Neutral\", or \"Negative\", describing the overall tone/mood "
    "of the people speaking (e.g. enthusiastic and upbeat vs. frustrated or critical vs. matter-of-fact)."
)

_VALID_SENTIMENTS = {"Positive", "Neutral", "Negative"}


def _clean_sentiment(raw_sentiment: Any) -> str:
    text = str(raw_sentiment or "").strip().title()
    return text if text in _VALID_SENTIMENTS else "Neutral"


# First badge on every job, naming where the recording came from.
_SOURCE_TAGS = {"upload": "Upload", "youtube": "YouTube", "url": "Video Link"}


def _source_tag(source_type: str) -> str:
    return _SOURCE_TAGS.get(source_type, "Video Link")


def _merge_tags(source_type: str, content_tags: list[str]) -> list[str]:
    merged = [_source_tag(source_type)]
    for tag in content_tags:
        if tag.casefold() not in {existing.casefold() for existing in merged}:
            merged.append(tag)
    return merged[:4]


def _summarize_transcript(
    transcript: str, source_type: str
) -> tuple[str, list[dict[str, Any]], list[str], str, str]:
    content = _try_temp_azure_summary(transcript)
    if content is not None:
        deployment = (
            os.getenv("LLM_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI_LLM_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI_MODEL")
        )
        return (*_parse_summary_json(content=content, transcript=transcript, source_type=source_type), deployment or "Azure OpenAI")

    if settings.openai_api_key:
        content = _summarize_with_openai(transcript)
        model = settings.openai_summary_model
    elif settings.gemini_api_key:
        content = _summarize_with_gemini(transcript)
        model = settings.gemini_model
    elif settings.environment == "production":
        raise ValueError("No summary provider is configured")
    else:
        return (*_fallback_summary(transcript=transcript, source_type=source_type), "Fallback summary")

    return (*_parse_summary_json(content=content, transcript=transcript, source_type=source_type), model)


def _try_temp_azure_summary(transcript: str) -> str | None:
    """Optional stopgap path; delete app/services/temp_azure_llm.py to fully remove it."""
    if not settings.temp_providers_enabled:
        return None
    try:
        from app.services.temp_azure_llm import summarize_with_temp_azure
    except ImportError:
        return None
    return summarize_with_temp_azure(transcript, _SUMMARY_PROMPT)


def _summarize_with_openai(transcript: str) -> str:
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_summary_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SUMMARY_PROMPT},
            {"role": "user", "content": transcript[:16000]},
        ],
    )
    return response.choices[0].message.content or "{}"


def _summarize_with_gemini(transcript: str) -> str:
    import google.generativeai as genai

    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(settings.gemini_model)
    response = model.generate_content(
        f"{_SUMMARY_PROMPT}\n\nTranscript:\n{transcript[:16000]}",
        generation_config={"response_mime_type": "application/json"},
    )
    return getattr(response, "text", None) or "{}"


def _parse_summary_json(
    content: str, transcript: str, source_type: str
) -> tuple[str, list[dict[str, Any]], list[str], str]:
    try:
        parsed = json.loads(content)
        summary = str(parsed.get("summary") or "Summary unavailable")
        raw_points = parsed.get("key_points") or []
        key_points = []
        for point in raw_points[:5]:
            key_points.append(
                {
                    "title": str(point.get("title") or "Key point"),
                    "description": str(point.get("description") or ""),
                    "timestamp_seconds": max(0, int(point.get("timestamp_seconds") or 0)),
                    "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
                }
            )
        content_tags = _clean_tags(parsed.get("tags"))
        sentiment = _clean_sentiment(parsed.get("sentiment"))
        if not key_points:
            fallback_summary, fallback_points, fallback_tags, fallback_sentiment = _fallback_summary(
                transcript=transcript, source_type=source_type
            )
            return (
                fallback_summary,
                fallback_points,
                _merge_tags(source_type, content_tags) or fallback_tags,
                sentiment or fallback_sentiment,
            )
        return summary, key_points, _merge_tags(source_type, content_tags), sentiment
    except Exception:
        return _fallback_summary(transcript=transcript, source_type=source_type)


_GENERIC_TAGS = {"video", "upload", "uploaded video", "youtube", "youtube video", "recording", "meeting", "n/a"}

_TAGS_ONLY_PROMPT = (
    "You label already-summarized videos. Return JSON {\"tags\": [string]} with exactly 3 short badge labels "
    "(1-3 words each, Title Case, no punctuation) in this order: the format of the recording (e.g. "
    "\"Teams Meeting\", \"Product Demo\", \"Tutorial\"), the main product/project/team named in the notes, and the "
    "main theme discussed. Never output generic labels like \"Video\", \"Upload\", or \"Recording\" on their own, "
    "and only use what the notes actually say."
)


def generate_tags_from_notes(summary: str, key_points: list[dict[str, Any]], source_type: str) -> list[str]:
    """Derive badge tags from an already-stored summary (used to backfill older jobs)."""
    notes = summary.strip()
    for point in key_points:
        notes += f"\n- {point.get('title') or ''}: {point.get('description') or ''}"

    content = _try_temp_azure_tags(notes)
    if content is None and settings.openai_api_key:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model=settings.openai_summary_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _TAGS_ONLY_PROMPT},
                {"role": "user", "content": notes[:8000]},
            ],
        )
        content = response.choices[0].message.content

    content_tags: list[str] = []
    if content:
        try:
            content_tags = _clean_tags(json.loads(content).get("tags"))
        except Exception:
            content_tags = []
    return _merge_tags(source_type, content_tags)


def _try_temp_azure_tags(notes: str) -> str | None:
    if not settings.temp_providers_enabled:
        return None
    try:
        from app.services.temp_azure_llm import chat_json_with_temp_azure
    except ImportError:
        return None
    return chat_json_with_temp_azure(system_prompt=_TAGS_ONLY_PROMPT, user_content=notes[:8000])


def _clean_tags(raw_tags: Any) -> list[str]:
    if not isinstance(raw_tags, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in raw_tags:
        text = " ".join(str(tag or "").split()).strip(" .,-")
        key = text.casefold()
        if not text or key in seen or key in _GENERIC_TAGS or len(text) > 28:
            continue
        seen.add(key)
        cleaned.append(text)
    return cleaned[:3]


def _normalize_key_points(key_points: list[dict[str, Any]], duration_seconds: int | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    max_timestamp = max(0, duration_seconds - 1) if duration_seconds else None

    for point in key_points:
        timestamp = max(0, int(point.get("timestamp_seconds") or 0))
        if max_timestamp is not None:
            timestamp = min(timestamp, max_timestamp)

        normalized.append(
            {
                "title": str(point.get("title") or "Key point"),
                "description": str(point.get("description") or ""),
                "timestamp_seconds": timestamp,
                "frame_image_url": point.get("frame_image_url"),
            }
        )
    return normalized


def _attach_upload_frames(job_id: str, media_path: Path, key_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    frame_root = Path(settings.local_processed_dir) / "frames" / job_id
    frame_root.mkdir(parents=True, exist_ok=True)
    api_base = settings.public_api_base_url.rstrip("/")

    for index, point in enumerate(key_points):
        timestamp = int(point["timestamp_seconds"])
        frame_name = f"{index + 1:02d}-{timestamp}.jpg"
        frame_path = frame_root / frame_name
        try:
            _extract_frame_at_timestamp(media_path=media_path, timestamp_seconds=timestamp, output_path=frame_path)
            asset_key = f"frames/{job_id}/{frame_name}"
            point["frame_image_url"] = f"{api_base}{settings.api_v1_prefix}/assets/{asset_key}"
        except Exception:
            point["frame_image_url"] = None
    return key_points


def _attach_timeline_frames(
    job_id: str, media_path: Path, sections: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Grab one screenshot per timeline section so the PDF can show what was on screen."""
    frame_root = Path(settings.local_processed_dir) / "frames" / job_id
    frame_root.mkdir(parents=True, exist_ok=True)
    api_base = settings.public_api_base_url.rstrip("/")

    for index, section in enumerate(sections):
        start = int(section.get("start_seconds") or 0)
        end = int(section.get("end_seconds") or start)
        # A few seconds in, so we capture the slide/screen rather than a transition.
        timestamp = start + min(20, max(0, (end - start) // 4))
        section["frame_timestamp_seconds"] = timestamp
        frame_name = f"section-{index + 1:02d}-{timestamp}.jpg"
        frame_path = frame_root / frame_name
        try:
            _extract_frame_at_timestamp(media_path=media_path, timestamp_seconds=timestamp, output_path=frame_path)
            asset_key = f"frames/{job_id}/{frame_name}"
            section["frame_image_url"] = f"{api_base}{settings.api_v1_prefix}/assets/{asset_key}"
        except Exception:
            section["frame_image_url"] = None
    return sections


def _extract_participant_frames(
    job_id: str, media_path: Path, duration_seconds: int | None
) -> list[Path]:
    frame_root = Path(settings.local_processed_dir) / "frames" / job_id / "participants"
    frame_root.mkdir(parents=True, exist_ok=True)

    total = duration_seconds or 0
    frames: list[Path] = []
    for index, ratio in enumerate(PARTICIPANT_FRAME_RATIOS):
        timestamp = int(total * ratio) if total else index * 30
        frame_path = frame_root / f"people-{index + 1:02d}.jpg"
        try:
            _extract_frame_at_timestamp(media_path=media_path, timestamp_seconds=timestamp, output_path=frame_path)
            frames.append(frame_path)
        except Exception:
            continue
    return frames


def extract_audio_track(media_path: Path) -> Path:
    if shutil.which("ffmpeg") is None:
        raise ValueError("ffmpeg is not available in the runtime")

    temp_dir = Path(tempfile.mkdtemp(prefix="framenote-audio-"))
    output_path = temp_dir / "audio.mp3"
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(media_path),
        "-vn",
        "-acodec",
        "libmp3lame",
        str(output_path),
    ]
    _run_command(command=command, error_message="Failed to extract audio from uploaded media")
    return output_path


def _extract_frame_at_timestamp(media_path: Path, timestamp_seconds: int, output_path: Path) -> None:
    if shutil.which("ffmpeg") is None:
        raise ValueError("ffmpeg is not available in the runtime")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(timestamp_seconds),
        "-i",
        str(media_path),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(output_path),
    ]
    _run_command(command=command, error_message="Failed to extract frame image")


def probe_duration_seconds(media_path: Path) -> int | None:
    if shutil.which("ffprobe") is None:
        return None

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        output = _run_command(command=command, error_message="Failed to inspect media duration")
        duration = float(output.strip())
        if duration <= 0:
            return None
        return int(duration)
    except Exception:
        return None


def _run_command(command: list[str], error_message: str) -> str:
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, check=False, timeout=settings.job_soft_time_limit_seconds
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError(f"{error_message}: timed out") from exc
    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        raise ValueError(f"{error_message}: {stderr or 'unknown error'}")
    return completed.stdout


def _fallback_summary(transcript: str, source_type: str) -> tuple[str, list[dict[str, Any]], list[str], str]:
    short = transcript.strip().replace("\n", " ")
    short = " ".join(short.split())
    summary = short[:260] + ("..." if len(short) > 260 else "")
    if not summary:
        summary = "No transcript content was produced."

    key_points = [
        {
            "title": "Opening context",
            "description": "Initial discussion and framing of the topic.",
            "timestamp_seconds": 20,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
        {
            "title": "Core details",
            "description": "Primary explanation, decisions, or walkthrough content.",
            "timestamp_seconds": 90,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
        {
            "title": "Outcome",
            "description": "Conclusions, action items, or final recap.",
            "timestamp_seconds": 160,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
    ]
    return summary, key_points, [_source_tag(source_type)], "Neutral"
