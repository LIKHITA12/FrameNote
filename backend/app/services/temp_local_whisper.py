"""TEMPORARY local (offline) transcription via openai-whisper.

Bridges uploaded-video transcription while GEMINI_API_KEY/OPENAI_API_KEY are
blocked/unusable on this network (see repo memory for details) and no
audio-capable Azure deployment is available. Runs entirely on-device.
Uses openai-whisper (not faster-whisper) because its model weights are
hosted on openaipublic.azureedge.net, which is reachable here, whereas
huggingface.co (faster-whisper's host) is policy-blocked on this network.

Self-contained and only consumed via a try/except ImportError in
app/services/processing.py, so deleting this file (and optionally
`pip uninstall openai-whisper torch`) requires no other code changes - the
pipeline falls back to the OpenAI/Gemini transcription path.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger("framenote.temp_local_whisper")

_MODEL_SIZE = os.getenv("TEMP_WHISPER_MODEL_SIZE", "base")
_model_lock = threading.Lock()
_model: Any = None


def _get_model() -> Any:
    global _model
    with _model_lock:
        if _model is None:
            import whisper

            logger.info("Loading local Whisper model '%s' (first run downloads weights)", _MODEL_SIZE)
            _model = whisper.load_model(_MODEL_SIZE, device="cpu")
        return _model


def transcribe_locally(audio_path: Path) -> str | None:
    """Return transcript text via local offline Whisper, or None if unusable."""
    result = transcribe_locally_with_segments(audio_path)
    return result[0] if result else None


def transcribe_locally_with_segments(audio_path: Path) -> tuple[str, list[dict[str, Any]]] | None:
    """Return (full_text, timestamped_segments) via local offline Whisper, or None if unusable."""
    try:
        model = _get_model()
        result = model.transcribe(str(audio_path))
        text = str(result.get("text") or "").strip()
        if not text:
            return None
        segments = [
            {
                "start": float(segment.get("start") or 0.0),
                "end": float(segment.get("end") or 0.0),
                "text": str(segment.get("text") or "").strip(),
            }
            for segment in (result.get("segments") or [])
            if str(segment.get("text") or "").strip()
        ]
        return text, segments
    except Exception:
        logger.exception("Local Whisper transcription failed; falling back")
        return None
