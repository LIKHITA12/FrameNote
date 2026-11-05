"""Parses a user-supplied meeting transcript file into plain text + timestamped,
per-speaker segments, so the pipeline can skip auto-transcription and compute a
per-speaker airtime breakdown.

Supported formats (the ones Microsoft Teams recordings commonly produce, plus
generic fallbacks for other meeting tools):
  - .vtt   WebVTT captions, optionally with "<v Speaker Name>" voice tags.
  - .srt   SubRip captions (no speaker tags).
  - .docx  Teams "Download transcript" export (speaker name + timestamp per line).
  - .txt / .md  Plain text, used verbatim with no segments/airtime.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SUPPORTED_EXTENSIONS = (".vtt", ".srt", ".docx", ".txt", ".md")

_VTT_TIMING = re.compile(r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})")
_SRT_TIMING = _VTT_TIMING
_VOICE_TAG = re.compile(r"^<v\s+([^>]+)>(.*)$", re.DOTALL)
_STRIP_TAGS = re.compile(r"</?v[^>]*>")
# Teams .docx utterance line: optional "Speaker Name", then a short timestamp ("0:16" or "1:02:03"),
# immediately followed by the spoken text (no separator), e.g. "Tekale, Vishal B   0:16I hope...".
_DOCX_UTTERANCE = re.compile(r"^(?P<speaker>.*?)\s*(?P<ts>\d{1,2}(?::\d{2}){1,2})(?P<text>.*)$", re.DOTALL)
_TRANSCRIPTION_MARKER = re.compile(r"started (transcription|recording)", re.IGNORECASE)


class UnsupportedTranscriptFormat(ValueError):
    pass


@dataclass
class ParsedTranscript:
    text: str
    segments: list[dict[str, Any]] = field(default_factory=list)
    speaker_airtime: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None


def parse_transcript_file(path: Path, original_filename: str) -> ParsedTranscript:
    suffix = Path(original_filename).suffix.lower()
    if suffix == ".vtt":
        return _finalize(_parse_vtt(path.read_text(encoding="utf-8", errors="ignore")))
    if suffix == ".srt":
        return _finalize(_parse_srt(path.read_text(encoding="utf-8", errors="ignore")))
    if suffix == ".docx":
        return _finalize(_parse_teams_docx(path))
    if suffix in (".txt", ".md"):
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
        return ParsedTranscript(text=text, segments=[], speaker_airtime=[])
    raise UnsupportedTranscriptFormat(
        f"Unsupported transcript file type '{suffix or original_filename}'. "
        f"Supported types: {', '.join(SUPPORTED_EXTENSIONS)}"
    )


def _parse_vtt(content: str) -> list[_Segment]:
    segments: list[_Segment] = []
    last_speaker: str | None = None
    for block in re.split(r"\n\s*\n", content.replace("\r\n", "\n")):
        lines = [line for line in block.split("\n") if line.strip()]
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        times = _VTT_TIMING.search(lines[timing_index])
        if not times:
            continue
        start = _hms_to_seconds(times.group(1), times.group(2), times.group(3), times.group(4))
        end = _hms_to_seconds(times.group(5), times.group(6), times.group(7), times.group(8))

        raw_text = " ".join(lines[timing_index + 1 :]).strip()
        if not raw_text:
            continue
        speaker = last_speaker
        voice_match = _VOICE_TAG.match(raw_text)
        if voice_match:
            speaker = voice_match.group(1).strip()
            raw_text = voice_match.group(2)
        raw_text = _STRIP_TAGS.sub("", raw_text).strip()
        if not raw_text:
            continue
        last_speaker = speaker
        segments.append(_Segment(start=start, end=end, text=raw_text, speaker=speaker))
    return segments


def _parse_srt(content: str) -> list[_Segment]:
    segments: list[_Segment] = []
    for block in re.split(r"\n\s*\n", content.replace("\r\n", "\n")):
        lines = [line for line in block.split("\n") if line.strip()]
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        times = _SRT_TIMING.search(lines[timing_index])
        if not times:
            continue
        start = _hms_to_seconds(times.group(1), times.group(2), times.group(3), times.group(4))
        end = _hms_to_seconds(times.group(5), times.group(6), times.group(7), times.group(8))
        text = " ".join(lines[timing_index + 1 :]).strip()
        if not text:
            continue
        segments.append(_Segment(start=start, end=end, text=text, speaker=None))
    return segments


def _parse_teams_docx(path: Path) -> list[_Segment]:
    import docx  # python-docx; imported lazily so the dep is only needed when this path is used.

    document = docx.Document(str(path))
    paragraphs = [p.text.strip() for p in document.paragraphs if p.text.strip()]

    segments: list[_Segment] = []
    started = False
    last_speaker: str | None = None

    for paragraph in paragraphs:
        if not started:
            if _TRANSCRIPTION_MARKER.search(paragraph):
                started = True
            continue

        match = _DOCX_UTTERANCE.match(paragraph)
        if not match:
            # No timestamp on this line: treat as a continuation of the previous utterance.
            if segments:
                segments[-1].text = f"{segments[-1].text} {paragraph}".strip()
            continue

        speaker_part = match.group("speaker").strip()
        text_part = match.group("text").strip()
        if text_part.upper() in ("AM", "PM", ""):
            # Looks like a date/time header (e.g. "January 14, 2026, 3:04PM"), not an utterance.
            continue

        start = _docx_timestamp_to_seconds(match.group("ts"))
        speaker = speaker_part or last_speaker
        last_speaker = speaker
        segments.append(_Segment(start=start, end=start, text=text_part, speaker=speaker))

    # Teams' transcript export only has a start time per utterance; approximate each one's end
    # as the next utterance's start so we can estimate per-speaker airtime.
    for index, segment in enumerate(segments):
        if index + 1 < len(segments):
            segment.end = max(segment.start, segments[index + 1].start)
        else:
            segment.end = segment.start + 3.0
    return segments


def _hms_to_seconds(hours: str, minutes: str, seconds: str, millis: str) -> float:
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def _docx_timestamp_to_seconds(value: str) -> float:
    parts = [int(part) for part in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    hours, minutes, seconds = parts
    return float(hours * 3600 + minutes * 60 + seconds)


def _finalize(segments: list[_Segment]) -> ParsedTranscript:
    if not segments:
        return ParsedTranscript(text="", segments=[], speaker_airtime=[])

    lines: list[str] = []
    out_segments: list[dict[str, Any]] = []
    airtime: dict[str, float] = {}
    turn_starts: dict[str, list[int]] = {}

    for segment in segments:
        line = f"{segment.speaker}: {segment.text}" if segment.speaker else segment.text
        lines.append(line)
        out_segments.append({"start": segment.start, "end": segment.end, "text": line, "speaker": segment.speaker})
        if segment.speaker:
            airtime[segment.speaker] = airtime.get(segment.speaker, 0.0) + max(0.0, segment.end - segment.start)
            turn_starts.setdefault(segment.speaker, []).append(round(segment.start))

    total = sum(airtime.values()) or 1.0
    speaker_airtime = [
        {
            "speaker": name,
            "seconds": round(seconds),
            "percent": round(seconds / total * 100, 1),
            "turns": len(turn_starts.get(name, [])),
            "turn_start_seconds": turn_starts.get(name, []),
        }
        for name, seconds in sorted(airtime.items(), key=lambda item: item[1], reverse=True)
    ]

    return ParsedTranscript(text="\n".join(lines), segments=out_segments, speaker_airtime=speaker_airtime)
