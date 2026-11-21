"""Free viewers get a preview of the detailed analysis; Pro viewers get all of it."""

import json
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.job import Job
from app.models.subscription import Subscription
from app.models.user import User
from app.services import video_chat
from app.services.jobs import to_job_response

ANALYSIS = {
    "overview": "Launch review",
    "headlines": ["Launch Friday"],
    "timeline": [
        {"title": "Intro", "start_seconds": 0, "end_seconds": 60, "bullets": ["Agenda"]},
        {"title": "Secret roadmap", "start_seconds": 60, "end_seconds": 120, "bullets": ["Hidden detail"]},
        {"title": "Wrap up", "start_seconds": 120, "end_seconds": 180, "bullets": ["Next steps"]},
    ],
    "questions_and_answers": [{"question": "When?", "answer": "Friday", "time_seconds": 10, "asked_by": "Sam"}],
    "decisions": ["Ship on Friday"],
    "action_items": ["Write release notes", "Email customers"],
    "terms": [{"term": "GA", "meaning": "General availability"}],
    "participants": {"count": 2, "names": ["Alex", "Sam"], "source": "the recording"},
}


class AnalysisPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(email="preview@example.test")
        self.db.add(self.user)
        self.db.flush()
        self.subscription = Subscription(user_id=self.user.id, tier="free", status="active")
        self.job = Job(
            owner_id=self.user.id,
            source_type="upload",
            status="completed",
            summary="Summary",
            transcript_text="We will ship on Friday.",
            analysis_json=json.dumps(ANALYSIS),
        )
        self.db.add_all([self.subscription, self.job])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_free_viewer_sees_first_section_and_locked_counts(self) -> None:
        response = to_job_response(self.job, viewer_id=self.user.id)
        self.assertEqual(response.analysis.overview, "Launch review")
        self.assertEqual([section.title for section in response.analysis.timeline], ["Intro"])
        self.assertEqual(response.analysis.decisions, [])
        self.assertEqual(response.analysis.action_items, [])
        self.assertEqual(response.analysis.questions_and_answers, [])
        self.assertEqual(response.analysis.participants.names, [])
        lock = response.analysis_locked
        self.assertEqual(
            (lock.hidden_sections, lock.hidden_questions, lock.hidden_decisions, lock.hidden_action_items, lock.hidden_terms),
            (2, 1, 1, 2, 1),
        )
        self.assertNotIn("Secret roadmap", response.model_dump_json())
        # The stored analysis is untouched, so upgrading unlocks it without reprocessing.
        self.assertEqual(json.loads(self.job.analysis_json), ANALYSIS)

    def test_pro_viewer_sees_full_analysis(self) -> None:
        self.subscription.tier = "pro"
        self.db.commit()
        response = to_job_response(self.job, viewer_id=self.user.id)
        self.assertIsNone(response.analysis_locked)
        self.assertEqual(len(response.analysis.timeline), 3)
        self.assertEqual(response.analysis.decisions, ["Ship on Friday"])

    def test_video_chat_prompt_only_contains_previewed_analysis_for_free(self) -> None:
        captured: dict[str, str] = {}

        def fake_generate(**kwargs):
            captured["analysis"] = json.dumps(kwargs["analysis"])
            return json.dumps({"answer": "Friday", "citations": []}), 1, 1

        with patch.object(video_chat, "ai_is_configured", return_value=True), patch.object(
            video_chat, "_generate_answer", side_effect=fake_generate
        ):
            video_chat.ask_video_question(self.db, self.job, self.user, "What is the roadmap?")
            self.assertNotIn("Secret roadmap", captured["analysis"])
            self.assertNotIn("Ship on Friday", captured["analysis"])

            self.subscription.tier = "pro"
            self.db.commit()
            video_chat.ask_video_question(self.db, self.job, self.user, "What is the roadmap?")
            self.assertIn("Secret roadmap", captured["analysis"])


if __name__ == "__main__":
    unittest.main()
