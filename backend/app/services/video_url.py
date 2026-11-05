"""Turn a public video link into notes, without ever touching the video picture.

services/processing.py is the local-media path: it works from a file on disk and samples
video frames for the report. This module is the remote-link counterpart. It resolves a
public URL, pulls down the *audio only*, transcribes that, and then reuses the shared
transcript analysis. No frame is ever decoded, saved, or embedded, so a report built from
someone else's video never reproduces their footage.

How a link is resolved, in order:

1. YouTube -> the published captions, so nothing is downloaded at all. Only if captions
   are unavailable do we fall back to the audio stream.
2. Any other page yt-dlp understands (Vimeo, Loom, Dailymotion, ...) -> the audio-only
   stream of that video.
3. A link that already points at a media file (``.../talk.mp4``, or a URL whose
   Content-Type is video/audio) -> streamed download, audio track extracted with ffmpeg.
"""

from __future__ import annotations

import ipaddress
import logging
import shutil
import socket
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import unquote, urlparse

import httpx

from app.core.config import settings
from app.models.job import Job
from app.services.pipeline import extract_youtube_video_id
from app.services.processing import (
    analyse_transcript,
    extract_audio_track,
    get_youtube_captions,
    probe_duration_seconds,
    transcribe_audio_file,
)

logger = logging.getLogger("framenote.video_url")

OnStage = Callable[[int], None]

MAX_URL_LENGTH = 2048
ALLOWED_SCHEMES = {"http", "https"}

# Links ending in one of these are treated as the media file itself, with no page to scrape.
MEDIA_SUFFIXES = (
    ".mp4",
    ".m4v",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
    ".flv",
    ".wmv",
    ".mpeg",
    ".mpg",
    ".ogv",
    ".m4a",
    ".mp3",
    ".wav",
    ".aac",
    ".flac",
    ".ogg",
    ".opus",
)

_DOWNLOAD_CHUNK_SIZE = 1024 * 1024


class PublicVideoUrlError(ValueError):
    """A link we cannot (or should not) process. Surfaced to the client as a 400."""


@dataclass(frozen=True)
class PublicVideoSource:
    """A resolved public link, before any media is fetched."""

    url: str
    provider: str
    title: str | None = None
    duration_seconds: int | None = None
    youtube_video_id: str | None = None
    is_direct_media: bool = False

    @property
    def is_youtube(self) -> bool:
        return bool(self.youtube_video_id)


# --- URL validation ---------------------------------------------------------


def validate_public_video_url(url: str) -> str:
    """Return the cleaned URL, or raise PublicVideoUrlError if it isn't a usable public link."""
    cleaned = str(url or "").strip()
    if not cleaned:
        raise PublicVideoUrlError("A video URL is required")
    if len(cleaned) > MAX_URL_LENGTH:
        raise PublicVideoUrlError(f"URL is too long (max {MAX_URL_LENGTH} characters)")

    parsed = urlparse(cleaned)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise PublicVideoUrlError("Only http:// and https:// video links are supported")
    if not parsed.hostname:
        raise PublicVideoUrlError("That URL is missing a host name")

    _assert_public_host(parsed.hostname)
    return cleaned


def _is_public_ip(raw: str) -> bool:
    try:
        address = ipaddress.ip_address(raw.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    # is_global excludes private, loopback, link-local (cloud metadata), CGNAT 100.64/10 and reserved ranges.
    return address.is_global and not address.is_multicast


def _assert_public_host(hostname: str) -> None:
    """Reject links that point back into our own network (SSRF guard)."""
    if settings.allow_private_video_urls:
        return

    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise PublicVideoUrlError("Could not resolve the host for that link") from exc

    if not addresses or not all(_is_public_ip(info[4][0]) for info in addresses):
        raise PublicVideoUrlError("Only publicly reachable video links are allowed")


# Checking the link once is not enough: redirects, and DNS answers that change between the check
# and the fetch, can still reach internal hosts. So while a link is being fetched, every hostname
# lookup on that thread (httpx, yt-dlp and their redirect hops) only returns public addresses.
_public_only = threading.local()
_real_getaddrinfo = socket.getaddrinfo
_guard_install_lock = threading.Lock()


def _public_only_getaddrinfo(host, port, *args, **kwargs):
    results = _real_getaddrinfo(host, port, *args, **kwargs)
    if not getattr(_public_only, "active", False):
        return results
    public = [info for info in results if _is_public_ip(info[4][0])]
    if not public:
        raise socket.gaierror(socket.EAI_NONAME, "Only publicly reachable hosts are allowed")
    return public


@contextmanager
def public_network_only() -> Iterator[None]:
    if settings.allow_private_video_urls:
        yield
        return
    with _guard_install_lock:
        if socket.getaddrinfo is not _public_only_getaddrinfo:
            socket.getaddrinfo = _public_only_getaddrinfo
    previous = getattr(_public_only, "active", False)
    _public_only.active = True
    try:
        yield
    finally:
        _public_only.active = previous


# --- resolving the link -----------------------------------------------------


def probe_public_video(url: str) -> PublicVideoSource:
    """Work out what a link is and read its title/duration, without downloading the media."""
    clean_url = validate_public_video_url(url)
    with public_network_only():
        return _probe_public_video(clean_url)


def _probe_public_video(clean_url: str) -> PublicVideoSource:

    youtube_video_id = extract_youtube_video_id(clean_url)
    if youtube_video_id:
        info = _probe_with_ytdlp(clean_url) or {}
        return PublicVideoSource(
            url=clean_url,
            provider="YouTube",
            title=_clean_title(info.get("title")),
            duration_seconds=_clean_duration(info.get("duration")),
            youtube_video_id=youtube_video_id,
        )

    if _looks_like_media_url(clean_url):
        return _direct_media_source(clean_url)

    info = _probe_with_ytdlp(clean_url)
    if info:
        return PublicVideoSource(
            url=clean_url,
            provider=str(info.get("extractor_key") or "Web"),
            title=_clean_title(info.get("title")),
            duration_seconds=_clean_duration(info.get("duration")),
        )

    if _content_type_is_media(clean_url):
        return _direct_media_source(clean_url)

    raise PublicVideoUrlError(
        "That link could not be read as a public video. Use a link to a video page "
        "(YouTube, Vimeo, Loom, ...) or a direct link to a video file."
    )


def _direct_media_source(url: str) -> PublicVideoSource:
    return PublicVideoSource(
        url=url,
        provider="Direct media link",
        title=_title_from_url(url),
        is_direct_media=True,
    )


def _looks_like_media_url(url: str) -> bool:
    path = unquote(urlparse(url).path).lower()
    return path.endswith(MEDIA_SUFFIXES)


def _content_type_is_media(url: str) -> bool:
    """Last resort for extension-less links: ask the server what it serves."""
    try:
        with httpx.Client(follow_redirects=True, timeout=30.0) as client:
            response = client.head(url)
            if response.status_code >= 400:
                # Some CDNs reject HEAD; a 1-byte ranged GET tells us the same thing.
                response = client.get(url, headers={"Range": "bytes=0-0"})
    except httpx.HTTPError as exc:
        logger.info("Could not reach %s: %s", url, exc)
        raise PublicVideoUrlError("Could not reach that link") from exc

    if response.status_code >= 400:
        logger.info("%s returned HTTP %s", url, response.status_code)
        raise PublicVideoUrlError("That link could not be opened. Check that the video is public.")

    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    return content_type.startswith(("video/", "audio/")) or content_type in {
        "application/octet-stream",
        "application/mp4",
    }


def _probe_with_ytdlp(url: str) -> dict[str, Any] | None:
    """Read a video page's metadata. Returns None when yt-dlp can't handle the link."""
    try:
        import yt_dlp
    except ImportError:
        logger.info("yt-dlp is not installed; only direct media links can be processed")
        return None

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 30,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
    except Exception as exc:
        logger.info("yt-dlp could not read %s: %s", url, exc)
        return None

    if not isinstance(info, dict):
        return None
    # A playlist/channel link still resolves; take its first entry so we analyse one video.
    entries = info.get("entries")
    if entries:
        first = next((entry for entry in entries if isinstance(entry, dict)), None)
        if first is None:
            return None
        info = first
    return info


# --- fetching the audio -----------------------------------------------------


def fetch_audio_track(source: PublicVideoSource, workdir: Path) -> Path:
    """Download the source's audio into workdir and return the audio file's path."""
    with public_network_only():
        if source.is_direct_media:
            media_path = _download_media_file(source.url, workdir)
        else:
            return _download_audio_with_ytdlp(source.url, workdir)
    return extract_audio_track(media_path)


def _download_media_file(url: str, workdir: Path) -> Path:
    """Stream a direct media link to disk, stopping if it exceeds the configured size cap."""
    workdir.mkdir(parents=True, exist_ok=True)
    suffix = Path(unquote(urlparse(url).path)).suffix.lower()
    destination = workdir / f"source{suffix if suffix in MEDIA_SUFFIXES else '.bin'}"
    max_bytes = settings.video_url_max_bytes

    try:
        with httpx.Client(follow_redirects=True, timeout=settings.video_url_timeout_seconds) as client:
            with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    logger.info("%s returned HTTP %s", url, response.status_code)
                    raise PublicVideoUrlError("That link could not be opened. Check that the video is public.")

                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise PublicVideoUrlError(f"That video is larger than the {_mb(max_bytes)} MB limit")

                written = 0
                with destination.open("wb") as handle:
                    for chunk in response.iter_bytes(_DOWNLOAD_CHUNK_SIZE):
                        written += len(chunk)
                        if written > max_bytes:
                            raise PublicVideoUrlError(
                                f"That video is larger than the {_mb(max_bytes)} MB limit"
                            )
                        handle.write(chunk)
    except httpx.HTTPError as exc:
        logger.info("Could not download %s: %s", url, exc)
        raise PublicVideoUrlError("Could not download that video") from exc

    if destination.stat().st_size == 0:
        raise PublicVideoUrlError("That link returned an empty file")
    return destination


def _download_audio_with_ytdlp(url: str, workdir: Path) -> Path:
    """Pull only the audio stream of a video page, transcoded to mp3 by ffmpeg."""
    try:
        import yt_dlp
    except ImportError as exc:
        raise PublicVideoUrlError(
            "This link needs yt-dlp to read its audio. Install it with 'pip install yt-dlp'."
        ) from exc

    workdir.mkdir(parents=True, exist_ok=True)
    options = {
        # Audio-only formats first: we never need, request, or store the video picture.
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "source.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 60,
        "concurrent_fragment_downloads": 1,
        "max_filesize": settings.video_url_max_bytes,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}
        ],
    }

    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.download([url])
    except Exception as exc:
        logger.info("yt-dlp could not download %s: %s", url, exc)
        raise PublicVideoUrlError("Could not download the audio for that video") from exc

    audio_files = sorted(
        (path for path in workdir.iterdir() if path.is_file() and path.stat().st_size > 0),
        key=lambda path: (path.suffix.lower() != ".mp3", -path.stat().st_size),
    )
    if not audio_files:
        raise PublicVideoUrlError("No audio could be downloaded from that video")
    return audio_files[0]


# --- transcript + pipeline --------------------------------------------------


def build_transcript(
    source: PublicVideoSource, on_stage: OnStage | None = None,
    on_model: Callable[[str], None] | None = None,
) -> tuple[str, list[dict[str, Any]], int | None]:
    """Transcribe a resolved link, preferring published captions over downloading audio."""
    if source.is_youtube and source.youtube_video_id:
        try:
            text, segments = get_youtube_captions(source.youtube_video_id)
        except Exception as exc:
            logger.info("No usable captions for %s (%s); falling back to audio", source.url, exc)
        else:
            if on_model:
                on_model("YouTube captions")
            if on_stage:
                on_stage(1)
                on_stage(2)
            return text, segments, source.duration_seconds or _duration_from_segments(segments)

    workdir = Path(tempfile.mkdtemp(prefix="framenote-url-"))
    try:
        audio_path = fetch_audio_track(source, workdir)
        if on_stage:
            on_stage(1)
        text, segments = transcribe_audio_file(audio_path, on_model=on_model)
        if on_stage:
            on_stage(2)
        duration = (
            source.duration_seconds
            or probe_duration_seconds(audio_path)
            or _duration_from_segments(segments)
        )
        return text, segments, duration
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def run_public_video_pipeline(
    job: Job, detailed: bool = True, on_stage: OnStage | None = None,
    on_duration: Callable[[int | None], None] | None = None,
) -> dict[str, Any]:
    """Full public-link pipeline: resolve, transcribe, analyse. Produces no frame images.

    Mirrors processing.run_job_pipeline's result shape, so the same job persistence and PDF
    rendering code works for both. on_stage(n) reports the same 4 client-facing stages.
    """
    if not job.source_url:
        raise ValueError("source_url is missing for this job")

    source = probe_public_video(job.source_url)
    if on_duration:
        on_duration(source.duration_seconds)
    logger.info("Resolved %s as %s (%s)", job.source_url, source.provider, source.title or "untitled")

    transcription_models: list[str] = []
    transcript, segments, duration_seconds = build_transcript(
        source, on_stage=on_stage, on_model=transcription_models.append
    )
    if on_duration and source.duration_seconds is None:
        on_duration(duration_seconds)
    if not transcript.strip():
        raise ValueError("No speech could be transcribed from that video")

    result = analyse_transcript(
        transcript=transcript,
        segments=segments,
        source_type=job.source_type,
        duration_seconds=duration_seconds,
        detailed=detailed,
        on_summary_done=(lambda: on_stage(3)) if on_stage else None,
    )
    result["speaker_airtime"] = []
    result["transcription_model"] = transcription_models[-1] if transcription_models else None
    result["source_title"] = source.title
    result["source_provider"] = source.provider

    if on_stage:
        on_stage(4)
    return result


# --- small helpers ----------------------------------------------------------


def _duration_from_segments(segments: list[dict[str, Any]]) -> int | None:
    ends = [float(segment.get("end") or 0) for segment in segments if isinstance(segment, dict)]
    longest = max(ends) if ends else 0
    return int(longest) if longest > 0 else None


def _clean_title(value: Any) -> str | None:
    title = " ".join(str(value or "").split())
    return title[:300] or None


def _clean_duration(value: Any) -> int | None:
    try:
        seconds = int(float(value))
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def _title_from_url(url: str) -> str | None:
    name = Path(unquote(urlparse(url).path)).name
    return name or None


def _mb(num_bytes: int) -> int:
    return num_bytes // (1024 * 1024)
