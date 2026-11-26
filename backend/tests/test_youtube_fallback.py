"""YouTube transcript fallback chain: captions -> Gemini reading the link -> clear 'upload or paste' error."""

import unittest
from unittest.mock import MagicMock, patch

import httpx

from app.core.config import settings
from app.services import video_url, youtube_transcript
from app.services.transcript_import import parse_plain_text_transcript
from app.services.video_url import PublicVideoSource, PublicVideoUrlError
from app.services.youtube_transcript import (
    YOUTUBE_UNAVAILABLE_MESSAGE,
    YouTubeTranscriptUnavailable,
    transcribe_youtube,
)

GEMINI_REPLY = "[00:00] Here's an app I built.\n[00:05] Let's connect a database.\n[01:02:03] Thanks for watching."


def _gemini_response(text: str = GEMINI_REPLY, status: int = 200, finish: str = "STOP") -> httpx.Response:
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com/x")
    body = {
        "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 1000, "candidatesTokenCount": 50},
    }
    return httpx.Response(status, json=body, request=request)


class PlainTextTranscriptTests(unittest.TestCase):
    def test_bracketed_timestamps_become_segments(self) -> None:
        parsed = parse_plain_text_transcript(GEMINI_REPLY)
        self.assertEqual([s["start"] for s in parsed.segments], [0.0, 5.0, 3723.0])
        self.assertEqual(parsed.segments[0]["end"], 5.0)
        self.assertIn("Let's connect a database.", parsed.text)

    def test_youtube_show_transcript_copy_format(self) -> None:
        copied = "0:00\nHere's an app\n0:05\nBy the end of the video\nyou will learn\n0:15\nDownload the app"
        parsed = parse_plain_text_transcript(copied)
        self.assertEqual([s["start"] for s in parsed.segments], [0.0, 5.0, 15.0])
        self.assertEqual(parsed.segments[1]["text"], "By the end of the video you will learn")

    def test_untimed_text_is_used_verbatim(self) -> None:
        parsed = parse_plain_text_transcript("We met at 10:30 to plan.\nThen we shipped it.")
        self.assertEqual(parsed.segments, [])
        self.assertEqual(parsed.text, "We met at 10:30 to plan.\nThen we shipped it.")


class TranscribeYouTubeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._patches = [
            patch.object(settings, "gemini_api_key", "test-key"),
            patch.object(settings, "youtube_gemini_fallback", True),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self) -> None:
        for item in self._patches:
            item.stop()

    def test_captions_are_used_first_without_calling_gemini(self) -> None:
        with patch("app.services.processing.get_youtube_captions", return_value=("caption text", [])), patch(
            "app.services.youtube_transcript.httpx.post"
        ) as gemini:
            models: list[str] = []
            text, _ = transcribe_youtube("abc", on_model=models.append)
        self.assertEqual(text, "caption text")
        self.assertEqual(models, ["YouTube captions"])
        gemini.assert_not_called()

    def test_gemini_reads_the_link_when_captions_fail(self) -> None:
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post", return_value=_gemini_response()
        ) as gemini:
            models: list[str] = []
            text, segments = transcribe_youtube("abc", on_model=models.append)
        self.assertIn("Thanks for watching.", text)
        self.assertEqual(len(segments), 3)
        self.assertIn("YouTube link", models[0])
        sent = gemini.call_args.kwargs["json"]["contents"][0]["parts"][0]["file_data"]["file_uri"]
        self.assertEqual(sent, "https://www.youtube.com/watch?v=abc")
        # The key travels in a header so it never appears in URLs or error logs.
        self.assertEqual(gemini.call_args.kwargs["headers"], {"x-goog-api-key": "test-key"})
        self.assertNotIn("params", gemini.call_args.kwargs)

    def test_both_failing_raises_the_friendly_error(self) -> None:
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post", return_value=_gemini_response(status=400)
        ), self.assertRaises(YouTubeTranscriptUnavailable):
            transcribe_youtube("abc")

    def test_retries_once_when_gemini_errors(self) -> None:
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post",
            side_effect=[_gemini_response(status=429), _gemini_response()],
        ) as gemini:
            text, _ = transcribe_youtube("abc")
        self.assertEqual(gemini.call_count, 2)
        self.assertIn("Thanks for watching.", text)

    def test_retries_short_transcript_and_keeps_the_longer_one(self) -> None:
        short = "[00:00] One.\n[00:10] Two.\n[00:20] Three."
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post",
            side_effect=[_gemini_response(text=short), _gemini_response()],
        ) as gemini:
            _, segments = transcribe_youtube("abc", duration_seconds=3800)
        self.assertEqual(gemini.call_count, 2)
        self.assertEqual(segments[-1]["start"], 3723.0)

    def test_complete_first_answer_is_not_retried(self) -> None:
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post", return_value=_gemini_response()
        ) as gemini:
            transcribe_youtube("abc", duration_seconds=3725)
        self.assertEqual(gemini.call_count, 1)

    def test_overlong_videos_skip_gemini(self) -> None:
        with patch("app.services.processing.get_youtube_captions", side_effect=ValueError("blocked")), patch(
            "app.services.youtube_transcript.httpx.post"
        ) as gemini, self.assertRaises(YouTubeTranscriptUnavailable) as raised:
            transcribe_youtube("abc", duration_seconds=settings.youtube_gemini_max_seconds + 1)
        gemini.assert_not_called()
        self.assertEqual(str(raised.exception), YOUTUBE_UNAVAILABLE_MESSAGE)


class BuildTranscriptTests(unittest.TestCase):
    def test_youtube_with_no_working_method_tells_user_to_upload_or_paste(self) -> None:
        source = PublicVideoSource(url="https://www.youtube.com/watch?v=abc", provider="YouTube", youtube_video_id="abc")
        with patch.object(video_url, "transcribe_youtube", side_effect=YouTubeTranscriptUnavailable("nope")), patch.object(
            video_url, "fetch_audio_track", side_effect=PublicVideoUrlError("Could not download the audio for that video")
        ), self.assertRaises(PublicVideoUrlError) as raised:
            video_url.build_transcript(source)
        self.assertEqual(str(raised.exception), YOUTUBE_UNAVAILABLE_MESSAGE)

    def test_pasted_transcript_skips_youtube_entirely(self) -> None:
        job = MagicMock(source_url="https://www.youtube.com/watch?v=abc", transcript_object_key="uploads/u/t.txt", source_type="youtube")
        source = PublicVideoSource(url=job.source_url, provider="YouTube", youtube_video_id="abc", title="My video")
        with patch.object(video_url, "probe_public_video", return_value=source), patch.object(
            video_url, "load_user_transcript", return_value=("pasted words", [], [])
        ), patch.object(video_url, "transcribe_youtube") as youtube, patch.object(
            video_url, "analyse_transcript", return_value={"analysis": None}
        ):
            result = video_url.run_public_video_pipeline(job)
        youtube.assert_not_called()
        self.assertEqual(result["transcription_model"], "User-provided transcript")
        self.assertEqual(result["source_title"], "My video")


if __name__ == "__main__":
    unittest.main()
