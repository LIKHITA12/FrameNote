from urllib.parse import parse_qs, urlparse


def extract_youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()


    if host in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate or None

    if host.endswith("youtube.com"):
        if parsed.path == "/watch":
            query = parse_qs(parsed.query)
            return query.get("v", [None])[0]
        if parsed.path.startswith("/shorts/") or parsed.path.startswith("/embed/"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2:
                return parts[1]

    return None


def build_demo_result(source_type: str) -> dict[str, object]:
    key_points = [
        {
            "title": "Main objective",
            "description": "Explains the core goal in the first part of the video.",
            "timestamp_seconds": 18,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
        {
            "title": "Key decision",
            "description": "Highlights the most important decision and expected impact.",
            "timestamp_seconds": 92,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
        {
            "title": "Actionable next step",
            "description": "Captures the final recommended action from the discussion.",
            "timestamp_seconds": 146,
            "frame_image_url": "https://placehold.co/640x360/png" if source_type == "upload" else None,
        },
    ]

    summary = "Demo summary: transcript analysis completed and key points were extracted successfully."
    return {"summary": summary, "key_points": key_points}
