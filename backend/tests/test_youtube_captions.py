import unittest
from unittest.mock import MagicMock, patch

from app.core.config import settings
from app.services.processing import get_youtube_captions

RAW = [
    {"text": "Hello there", "start": 0.0, "duration": 2.0},
    {"text": "  ", "start": 2.0, "duration": 1.0},
    {"text": "General Kenobi", "start": 3.0, "duration": 2.5},
]


def _fetched(raw=RAW) -> MagicMock:
    fetched = MagicMock()
    fetched.to_raw_data.return_value = raw
    return fetched


class YouTubeCaptionTests(unittest.TestCase):
    def test_english_captions_become_text_and_segments(self) -> None:
        api = MagicMock()
        api.fetch.return_value = _fetched()
        with patch("youtube_transcript_api.YouTubeTranscriptApi", return_value=api):
            text, segments = get_youtube_captions("abc123")
        self.assertEqual(text, "Hello there General Kenobi")
        self.assertEqual(segments, [
            {"start": 0.0, "end": 2.0, "text": "Hello there"},
            {"start": 3.0, "end": 5.5, "text": "General Kenobi"},
        ])

    def test_falls_back_to_first_available_language(self) -> None:
        api = MagicMock()
        api.fetch.side_effect = RuntimeError("no English track")
        track = MagicMock()
        track.fetch.return_value = _fetched([{"text": "Namaste", "start": 0.0, "duration": 1.0}])
        api.list.return_value = [track]
        with patch("youtube_transcript_api.YouTubeTranscriptApi", return_value=api):
            text, _ = get_youtube_captions("abc123")
        self.assertEqual(text, "Namaste")

    def test_no_captions_raises_value_error(self) -> None:
        api = MagicMock()
        api.fetch.side_effect = RuntimeError("blocked")
        api.list.side_effect = RuntimeError("blocked")
        with patch("youtube_transcript_api.YouTubeTranscriptApi", return_value=api), self.assertRaises(ValueError):
            get_youtube_captions("abc123")

    def test_proxy_setting_is_passed_to_the_library(self) -> None:
        api = MagicMock()
        api.fetch.return_value = _fetched()
        with patch.object(settings, "youtube_proxy_url", "http://user:pass@proxy.example:8080"), patch(
            "youtube_transcript_api.YouTubeTranscriptApi", return_value=api
        ) as constructor:
            get_youtube_captions("abc123")
        proxy_config = constructor.call_args.kwargs["proxy_config"]
        self.assertEqual(proxy_config.http_url, "http://user:pass@proxy.example:8080")


if __name__ == "__main__":
    unittest.main()
