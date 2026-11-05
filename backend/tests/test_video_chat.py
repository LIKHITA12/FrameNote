import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models.chat_message import ChatMessage
from app.models.job import Job
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.video_chat import VideoChatContext
from app.services.video_chat import settings as video_chat_settings
from app.services.video_chat import ask_video_question, get_video_chat_history
from app.services.video_chat import _clean_contexts


class VideoChatServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(email="owner@example.test", full_name="Owner")
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)
        self.db.add(Subscription(user_id=self.user.id, tier="free", status="active"))
        self.job = Job(
            owner_id=self.user.id,
            source_type="upload",
            status="completed",
            summary="The team approved the launch plan.",
            transcript_text="Alex approved the launch for Friday.",
            transcript_segments_json=json.dumps(
                [{"start": 65, "end": 75, "speaker": "Alex", "text": "Alex approved the launch for Friday."}]
            ),
        )
        self.db.add(self.job)
        self.db.commit()
        self.db.refresh(self.job)

    def tearDown(self) -> None:
        self.db.close()

    @patch("app.services.video_chat.ai_is_configured", return_value=True)
    @patch("app.services.video_chat._generate_answer")
    def test_saves_grounded_answer_and_restores_history(self, generate_answer, _configured) -> None:
        generate_answer.return_value = (
            json.dumps({"answer": "The launch was approved for Friday.", "citation_ids": ["C1"]}),
            120,
            20,
        )

        response = ask_video_question(
            self.db,
            self.job,
            self.user,
            "When is the launch?",
            contexts=[
                VideoChatContext(
                    context_id="summary",
                    label="Untrusted client label",
                    selected_text="approved the launch",
                )
            ],
        )

        self.assertEqual(response.assistant_message.citations[0].timestamp_seconds, 65)
        self.assertEqual(response.user_message.contexts[0].label, "Summary")
        self.assertEqual(response.user_message.contexts[0].selected_text, "approved the launch")
        self.assertEqual(generate_answer.call_args.kwargs["contexts"][0].context_id, "summary")
        self.assertEqual(response.usage.used_this_month, 1)
        self.assertEqual(response.usage.used_for_video, 1)
        history = get_video_chat_history(self.db, self.job, self.user)
        self.assertEqual([message.role for message in history.messages], ["user", "assistant"])
        self.assertEqual(history.messages[1].content, "The launch was approved for Friday.")

    @patch("app.services.video_chat.ai_is_configured", return_value=True)
    def test_free_per_video_limit_is_enforced_before_model_call(self, _configured) -> None:
        for index in range(3):
            self.db.add(
                ChatMessage(
                    job_id=self.job.id,
                    user_id=self.user.id,
                    role="user",
                    content=f"Question {index}",
                )
            )
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            ask_video_question(self.db, self.job, self.user, "One more question")

        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("3 questions per video", raised.exception.detail)

    @patch("app.services.video_chat.ai_is_configured", return_value=False)
    def test_missing_ai_credentials_returns_service_unavailable(self, _configured) -> None:
        with self.assertRaises(HTTPException) as raised:
            ask_video_question(self.db, self.job, self.user, "What happened?")
        self.assertEqual(raised.exception.status_code, 503)

    @patch("app.services.video_chat.ai_is_configured", return_value=True)
    def test_global_monthly_token_budget_stops_new_calls(self, _configured) -> None:
        self.db.add(
            ChatMessage(
                job_id=self.job.id,
                user_id=self.user.id,
                role="assistant",
                content="Earlier answer",
                input_tokens=8,
                output_tokens=4,
            )
        )
        self.db.commit()

        with patch.object(video_chat_settings, "video_chat_monthly_token_budget", 10):
            with self.assertRaises(HTTPException) as raised:
                ask_video_question(self.db, self.job, self.user, "What happened?")

        self.assertEqual(raised.exception.status_code, 503)
        self.assertIn("service budget", raised.exception.detail)

    def test_keeps_distinct_selections_from_the_same_section(self) -> None:
        contexts = _clean_contexts(
            [
                VideoChatContext(context_id="detailed-notes", label="Ignored", selected_text="First decision"),
                VideoChatContext(context_id="detailed-notes", label="Ignored", selected_text="Second decision"),
                VideoChatContext(context_id="detailed-notes", label="Ignored", selected_text="First   decision"),
                VideoChatContext(context_id="glossary", label="Ignored", selected_text="Agentic workflow"),
            ]
        )

        self.assertEqual(len(contexts), 3)
        self.assertEqual([context.label for context in contexts], ["Full detailed notes", "Full detailed notes", "Glossary"])
        self.assertEqual(contexts[1].selected_text, "Second decision")


if __name__ == "__main__":
    unittest.main()
