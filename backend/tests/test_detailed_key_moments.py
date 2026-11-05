import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.key_moments_routes import get_detailed_key_moments
from app.services.detailed_key_moments import build_detailed_key_moments


def _job(owner_id: str = "owner", timeline: list | None = None):
    return SimpleNamespace(
        id="job-1",
        owner_id=owner_id,
        analysis_json=json.dumps({"timeline": timeline or []}),
    )


class DetailedKeyMomentsServiceTests(unittest.TestCase):
    def test_returns_all_valid_sections_sorted_and_derives_frame_timestamp(self) -> None:
        timeline = [
            {
                "title": f"Moment {index}",
                "start_seconds": index * 100,
                "end_seconds": index * 100 + 80,
                "bullets": [f"Detail {index}", "Second detail"],
                "frame_image_url": f"https://example.test/frame-{index}.jpg",
            }
            for index in reversed(range(18))
        ]

        response = build_detailed_key_moments(_job(timeline=timeline))

        self.assertEqual(response.total, 18)
        self.assertEqual(response.items[0].title, "Moment 0")
        self.assertEqual(response.items[-1].title, "Moment 17")
        self.assertEqual(response.items[0].frame_timestamp_seconds, 20)
        self.assertEqual(response.items[0].bullets, ["Detail 0", "Second detail"])

    def test_skips_malformed_sections_and_handles_missing_analysis(self) -> None:
        response = build_detailed_key_moments(
            _job(
                timeline=[
                    None,
                    {"title": "Missing bullets", "start_seconds": 1},
                    {"title": "", "bullets": ["Detail"]},
                    {
                        "title": "Valid",
                        "start_seconds": "bad",
                        "end_seconds": 5,
                        "bullets": ["", "Kept"],
                    },
                ]
            )
        )
        self.assertEqual(response.total, 1)
        self.assertEqual(response.items[0].title, "Valid")
        self.assertEqual(response.items[0].bullets, ["Kept"])

        missing = SimpleNamespace(id="job-2", analysis_json=None)
        self.assertEqual(build_detailed_key_moments(missing).items, [])


class DetailedKeyMomentsRouteTests(unittest.TestCase):
    @patch("app.api.key_moments_routes.get_user_subscription")
    @patch("app.api.key_moments_routes.get_accessible_job_or_404")
    def test_active_pro_can_access_moments(self, get_job, get_subscription) -> None:
        get_job.return_value = _job(
            timeline=[{"title": "One", "start_seconds": 0, "end_seconds": 40, "bullets": ["Detail"]}]
        )
        get_subscription.return_value = SimpleNamespace(tier="pro", status="active")

        response = get_detailed_key_moments(
            job_id="job-1",
            db=MagicMock(),
            current_user=SimpleNamespace(id="owner"),
        )

        self.assertEqual(response.total, 1)
        get_job.assert_called_once()

    @patch("app.api.key_moments_routes.get_user_subscription")
    @patch("app.api.key_moments_routes.get_accessible_job_or_404")
    def test_starter_and_inactive_accounts_are_forbidden(self, get_job, get_subscription) -> None:
        get_job.return_value = _job()
        for tier, status in (("free", "active"), ("pro", "inactive")):
            with self.subTest(tier=tier, status=status):
                get_subscription.return_value = SimpleNamespace(tier=tier, status=status)
                with self.assertRaises(HTTPException) as raised:
                    get_detailed_key_moments(
                        job_id="job-1",
                        db=MagicMock(),
                        current_user=SimpleNamespace(id="owner"),
                    )
                self.assertEqual(raised.exception.status_code, 403)

    @patch("app.api.key_moments_routes.get_user_subscription")
    @patch("app.api.key_moments_routes.get_accessible_job_or_404")
    def test_another_users_job_stays_hidden(self, get_job, get_subscription) -> None:
        get_job.side_effect = HTTPException(status_code=404, detail="Job not found")

        with self.assertRaises(HTTPException) as raised:
            get_detailed_key_moments(
                job_id="other-job",
                db=MagicMock(),
                current_user=SimpleNamespace(id="owner"),
            )

        self.assertEqual(raised.exception.status_code, 404)
        get_subscription.assert_not_called()


if __name__ == "__main__":
    unittest.main()
