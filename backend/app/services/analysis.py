"""Deep, section-by-section analysis of a transcript for the detailed PDF report.

The plain summary path in processing.py produces a short blurb plus three key
points. This module produces the richer structure the PDF report renders:
a step-by-step timeline, the questions people asked with their answers,
decisions, action items, a glossary, and the list of participants.

Long recordings are analysed in chunks (map step) and then merged into one
overview (reduce step), so the whole recording is covered instead of only the
first ~16k characters.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.core.config import settings

logger = logging.getLogger("framenote.analysis")

CHUNK_TARGET_SECONDS = 420
CHUNK_MAX_CHARS = 9000
MAX_TIMELINE_SECTIONS = 24
MAX_QA_ITEMS = 20

_PLAIN_ENGLISH_RULES = (
    "Write for a reader who did not attend and is not a technical expert. "
    "Use simple, everyday English words. Keep every sentence under 22 words. "
    "Never write long paragraphs: always use short bullet points. "
    "If a technical term is unavoidable, add a short plain-English meaning in brackets. "
    "Only use information that is actually in the transcript. Never invent facts."
)

_CHUNK_PROMPT = (
    "You are a meeting-notes assistant. You get one part of a recording transcript, with timestamps in seconds. "
    f"{_PLAIN_ENGLISH_RULES}\n"
    "Return JSON with exactly this shape:\n"
    '{"sections": [{"title": string, "start_seconds": integer, "end_seconds": integer, '
    '"bullets": [string]}], '
    '"questions_and_answers": [{"time_seconds": integer, "asked_by": string, "question": string, "answer": string}], '
    '"decisions": [string], "action_items": [string], '
    '"action_item_details": [{"title": string, "owner": string or null, "due": string or null, "priority": "high" or "medium" or "low" or null}], '
    '"terms": [{"term": string, "meaning": string}], "people_mentioned": [string]}\n'
    "Rules: 1-3 sections for this part. Each section gets 3-7 bullets covering what was actually said or shown. "
    "Each bullet is one short, complete sentence. "
    "Capture every question someone asked and the answer that was given. "
    "Use \"asked_by\" only if a name is clear in the transcript, otherwise use \"A participant\". "
    "Use empty lists when something is not present in this part. For each action item, add a matching "
    "action_item_details entry. Only fill owner, due, or priority when stated clearly; otherwise use null."
)

_REDUCE_PROMPT = (
    "You are a meeting-notes assistant. You get the section titles and bullets of a full recording. "
    f"{_PLAIN_ENGLISH_RULES}\n"
    "Return JSON with exactly this shape:\n"
    '{"overview": string, "headlines": [string], "decisions": [string], "action_items": [string]}\n'
    "Rules: \"overview\" is 2-4 short sentences saying what the recording was about. "
    "\"headlines\" is 4-7 bullets with the most important takeaways. "
    "Merge duplicate decisions and action items, and drop anything that is not clearly stated."
)

_PARTICIPANT_VISION_PROMPT = (
    "You read names from screenshots of an online meeting. "
    "Look at the participant tiles and name labels in the images. "
    'Return JSON: {"names": [string], "notes": string}. '
    "Copy each name exactly as it appears on screen. Do not guess or complete names that are cut off. "
    "List every distinct person you can see across all images, with no duplicates. "
    "If you cannot read any names, return an empty list."
)


def build_detailed_analysis(
    transcript: str,
    segments: list[dict[str, Any]],
    duration_seconds: int | None,
    participant_frames: list[Path] | None = None,
) -> dict[str, Any]:
    """Build the full analysis payload. Never raises - degrades to a minimal payload."""

    try:
        chunks = _build_chunks(transcript=transcript, segments=segments, duration_seconds=duration_seconds)
        chunk_results = [result for chunk in chunks if (result := _analyse_chunk(chunk)) is not None]
    except Exception:
        logger.exception("Chunked analysis failed")
        chunk_results = []

    timeline = _merge_sections(chunk_results, duration_seconds=duration_seconds)
    questions = _merge_questions(chunk_results)
    terms = _merge_terms(chunk_results)
    decisions = _merge_strings(chunk_results, key="decisions")
    action_items = _merge_strings(chunk_results, key="action_items")
    chunk_action_items = action_items
    action_item_details = _merge_action_details(chunk_results)

    overview = ""
    headlines: list[str] = []
    if timeline:
        reduced = _reduce_sections(timeline)
        if reduced:
            overview = str(reduced.get("overview") or "")
            headlines = _clean_strings(reduced.get("headlines"))
            decisions = _clean_strings(reduced.get("decisions")) or decisions
            action_items = _clean_strings(reduced.get("action_items")) or action_items

    if action_item_details:
        # Keep existing string consumers (PDF, completion checkboxes) in sync with details.
        detailed_titles = {item["title"].casefold() for item in action_item_details}
        action_items = [item["title"] for item in action_item_details] + [
            item for item in chunk_action_items if item.casefold() not in detailed_titles
        ]

    participants = _detect_participants(
        frames=participant_frames or [],
        people_mentioned=_merge_strings(chunk_results, key="people_mentioned"),
    )

    return {
        "overview": overview,
        "headlines": headlines,
        "timeline": timeline,
        "questions_and_answers": questions,
        "decisions": decisions,
        "action_items": action_items,
        "action_item_details": action_item_details,
        "terms": terms,
        "participants": participants,
        "duration_seconds": duration_seconds,
    }


def _build_chunks(
    transcript: str, segments: list[dict[str, Any]], duration_seconds: int | None
) -> list[dict[str, Any]]:
    """Group timestamped segments into chunks the model can analyse in one call."""

    if not segments:
        return _chunks_without_timestamps(transcript=transcript, duration_seconds=duration_seconds)

    chunks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0

    for segment in segments:
        current.append(segment)
        current_chars += len(segment["text"]) + 12
        span = segment["end"] - current[0]["start"]
        if span >= CHUNK_TARGET_SECONDS or current_chars >= CHUNK_MAX_CHARS:
            chunks.append(_chunk_from_segments(current))
            current = []
            current_chars = 0

    if current:
        chunks.append(_chunk_from_segments(current))
    return chunks


def _chunk_from_segments(segments: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [f"[{_clock(segment['start'])}] {segment['text']}" for segment in segments]
    return {
        "start_seconds": int(segments[0]["start"]),
        "end_seconds": int(segments[-1]["end"]),
        "text": "\n".join(lines),
    }


def _chunks_without_timestamps(transcript: str, duration_seconds: int | None) -> list[dict[str, Any]]:
    words = transcript.split()
    if not words:
        return []

    total = len(words)
    per_chunk = max(400, CHUNK_MAX_CHARS // 6)
    chunks: list[dict[str, Any]] = []
    for index in range(0, total, per_chunk):
        window = words[index : index + per_chunk]
        start_ratio = index / total
        end_ratio = min(1.0, (index + len(window)) / total)
        chunks.append(
            {
                "start_seconds": int((duration_seconds or 0) * start_ratio),
                "end_seconds": int((duration_seconds or 0) * end_ratio),
                "text": " ".join(window),
            }
        )
    return chunks


def _analyse_chunk(chunk: dict[str, Any]) -> dict[str, Any] | None:
    user_content = (
        f"This part of the recording runs from {_clock(chunk['start_seconds'])} "
        f"to {_clock(chunk['end_seconds'])} "
        f"(seconds {chunk['start_seconds']} to {chunk['end_seconds']}).\n\n"
        f"Transcript part:\n{chunk['text']}"
    )
    content = _llm_json(system_prompt=_CHUNK_PROMPT, user_content=user_content)
    if not content:
        return None
    try:
        parsed = json.loads(content)
    except Exception:
        logger.warning("Chunk analysis returned non-JSON content; skipping chunk")
        return None
    return parsed if isinstance(parsed, dict) else None


def _reduce_sections(timeline: list[dict[str, Any]]) -> dict[str, Any] | None:
    outline = "\n\n".join(
        f"{section['title']} ({_clock(section['start_seconds'])}-{_clock(section['end_seconds'])})\n"
        + "\n".join(f"- {bullet}" for bullet in section["bullets"])
        for section in timeline
    )
    content = _llm_json(system_prompt=_REDUCE_PROMPT, user_content=outline[:24000])
    if not content:
        return None
    try:
        parsed = json.loads(content)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _llm_json(system_prompt: str, user_content: str) -> str | None:
    content = _try_temp_azure_json(system_prompt=system_prompt, user_content=user_content)
    if content:
        return content

    if settings.openai_api_key:
        try:
            client = OpenAI(api_key=settings.openai_api_key)
            response = client.chat.completions.create(
                model=settings.openai_summary_model,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
            )
            return response.choices[0].message.content
        except Exception:
            logger.exception("OpenAI analysis call failed")

    if settings.gemini_api_key:
        try:
            import google.generativeai as genai

            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel(settings.gemini_model)
            response = model.generate_content(
                f"{system_prompt}\n\n{user_content}",
                generation_config={"response_mime_type": "application/json"},
            )
            return getattr(response, "text", None)
        except Exception:
            logger.exception("Gemini analysis call failed")

    return None


def _try_temp_azure_json(system_prompt: str, user_content: str) -> str | None:
    """Optional stopgap path; delete app/services/temp_azure_llm.py to fully remove it."""
    if not settings.temp_providers_enabled:
        return None
    try:
        from app.services.temp_azure_llm import chat_json_with_temp_azure
    except ImportError:
        return None
    return chat_json_with_temp_azure(system_prompt=system_prompt, user_content=user_content)


def _detect_participants(frames: list[Path], people_mentioned: list[str]) -> dict[str, Any]:
    names = _read_participant_names_from_frames(frames)
    if names:
        return {"names": names, "count": len(names), "source": "names shown on the video"}

    cleaned = [name for name in people_mentioned if _looks_like_name(name)]
    if cleaned:
        return {"names": cleaned, "count": len(cleaned), "source": "names heard in the conversation"}

    return {"names": [], "count": 0, "source": "not available"}


def _read_participant_names_from_frames(frames: list[Path]) -> list[str]:
    if not frames or not settings.temp_providers_enabled:
        return []
    try:
        from app.services.temp_azure_llm import chat_json_with_images
    except ImportError:
        return []

    content = chat_json_with_images(
        system_prompt=_PARTICIPANT_VISION_PROMPT,
        user_text="Read the participant names shown in these frames from the same meeting recording.",
        image_paths=frames,
    )
    if not content:
        return []
    try:
        parsed = json.loads(content)
    except Exception:
        return []

    names: list[str] = []
    seen: set[frozenset[str]] = set()
    for name in _clean_strings(parsed.get("names")):
        if not _looks_like_name(name):
            continue
        # "Bura, Ramadas" and "Ramadas, Bura" are the same person read from two tiles.
        key = frozenset(re.findall(r"[a-z]+", name.lower()))
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def _looks_like_name(value: str) -> bool:
    text = value.strip()
    if len(text) < 2 or len(text) > 60:
        return False
    return bool(re.search(r"[A-Za-z]", text))


def _merge_sections(chunk_results: list[dict[str, Any]], duration_seconds: int | None) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for result in chunk_results:
        for raw in result.get("sections") or []:
            bullets = _clean_strings(raw.get("bullets"))
            if not bullets:
                continue
            start = _clamp_seconds(raw.get("start_seconds"), duration_seconds)
            end = max(start, _clamp_seconds(raw.get("end_seconds"), duration_seconds))
            sections.append(
                {
                    "title": str(raw.get("title") or "Part of the discussion").strip(),
                    "start_seconds": start,
                    "end_seconds": end,
                    "bullets": bullets[:8],
                }
            )

    sections.sort(key=lambda section: section["start_seconds"])
    return sections[:MAX_TIMELINE_SECTIONS]


def _merge_questions(chunk_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in chunk_results:
        for raw in result.get("questions_and_answers") or []:
            question = str(raw.get("question") or "").strip()
            if not question:
                continue
            key = question.lower()[:80]
            if key in seen:
                continue
            seen.add(key)
            questions.append(
                {
                    "time_seconds": _clamp_seconds(raw.get("time_seconds"), None),
                    "asked_by": str(raw.get("asked_by") or "A participant").strip(),
                    "question": question,
                    "answer": str(raw.get("answer") or "").strip(),
                }
            )
    questions.sort(key=lambda item: item["time_seconds"])
    return questions[:MAX_QA_ITEMS]


def _merge_terms(chunk_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    terms: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in chunk_results:
        for raw in result.get("terms") or []:
            term = str(raw.get("term") or "").strip()
            meaning = str(raw.get("meaning") or "").strip()
            if not term or not meaning or term.lower() in seen:
                continue
            seen.add(term.lower())
            terms.append({"term": term, "meaning": meaning})
    return terms[:12]


def _merge_strings(chunk_results: list[dict[str, Any]], key: str) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for result in chunk_results:
        for value in _clean_strings(result.get(key)):
            lowered = value.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            merged.append(value)
    return merged[:15]


def _merge_action_details(chunk_results: list[dict[str, Any]]) -> list[dict[str, str | None]]:
    merged: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for result in chunk_results:
        for raw in result.get("action_item_details") or []:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title") or "").strip()
            if len(title) < 2 or title.casefold() in seen:
                continue
            seen.add(title.casefold())
            priority = str(raw.get("priority") or "").strip().lower()
            merged.append({
                "title": title,
                "owner": str(raw.get("owner") or "").strip() or None,
                "due": str(raw.get("due") or "").strip() or None,
                "priority": priority if priority in {"high", "medium", "low"} else None,
            })
    return merged[:15]


def _clean_strings(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = [str(value).strip() for value in values if str(value or "").strip()]
    return [value for value in cleaned if len(value) > 1]


def _clamp_seconds(value: Any, duration_seconds: int | None) -> int:
    try:
        seconds = max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0
    if duration_seconds:
        seconds = min(seconds, max(0, duration_seconds - 1))
    return seconds


def _clock(seconds: Any) -> str:
    total = max(0, int(float(seconds or 0)))
    minutes, secs = divmod(total, 60)
    return f"{minutes}:{secs:02d}"
