import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import generate_pdf_for_job
from app.core.config import settings
from app.db import Base
from app.models.job import Job
from app.models.subscription import Subscription
from app.models.user import User
from app.services.pdf import generate_job_pdf, generate_job_summary_pdf


class PdfPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(email="pdf-owner@example.test", full_name="PDF Owner")
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)
        self.subscription = Subscription(user_id=self.user.id, tier="free", status="active")
        self.db.add(self.subscription)
        self.job = Job(
            owner_id=self.user.id,
            source_type="upload",
            file_name="meeting.mp4",
            upload_object_key="uploads/meeting.mp4",
            status="completed",
            summary="The team approved the launch.",
            key_points_json=json.dumps([
                {"title": "Launch approved", "timestamp_seconds": 15, "description": "Friday was approved."}
            ]),
            analysis_json=json.dumps({"timeline": [], "questions_and_answers": []}),
        )
        self.db.add(self.job)
        self.db.commit()
        self.db.refresh(self.job)

    def tearDown(self) -> None:
        self.db.close()

    @patch("app.api.routes.generate_job_pdf", return_value="frames/test/report.pdf")
    @patch("app.api.routes.generate_job_summary_pdf", return_value="frames/test/summary-report.pdf")
    def test_manual_export_routes_free_to_summary_and_pro_to_detailed(self, summary_pdf, detailed_pdf) -> None:
        summary_pdf.return_value = f"frames/{self.job.id}/summary-report.pdf"
        detailed_pdf.return_value = f"frames/{self.job.id}/report.pdf"
        generate_pdf_for_job(self.job.id, db=self.db, current_user=self.user)
        summary_pdf.assert_called_once_with(job=self.job, key_points=unittest.mock.ANY, include_frames=True)
        detailed_pdf.assert_not_called()

        summary_pdf.reset_mock()
        self.subscription.tier = "pro"
        self.db.add(self.subscription)
        self.db.commit()
        self.job.source_type = "url"
        self.job.source_url = "https://example.com/video"
        self.db.add(self.job)
        self.db.commit()

        generate_pdf_for_job(self.job.id, db=self.db, current_user=self.user)
        detailed_pdf.assert_called_once_with(
            job=self.job,
            key_points=unittest.mock.ANY,
            analysis=unittest.mock.ANY,
            include_frames=False,
        )
        summary_pdf.assert_not_called()

    def test_renderers_produce_different_report_depth(self) -> None:
        analysis = {
            "duration_seconds": 120,
            "participants": {"count": 2, "names": ["Alex", "Sam"], "source": "the recording"},
            "timeline": [{"title": "Decision", "start_seconds": 5, "end_seconds": 20, "bullets": ["Launch Friday."]}],
            "questions_and_answers": [{"question": "When?", "answer": "Friday.", "time_seconds": 8}],
            "decisions": ["Launch Friday."],
            "action_items": ["Prepare release notes."],
            "terms": [{"term": "Rollout", "meaning": "A product release."}],
        }
        points = json.loads(self.job.key_points_json)
        original_dir = settings.local_processed_dir
        with tempfile.TemporaryDirectory() as temp_dir:
            settings.local_processed_dir = temp_dir
            summary_key = generate_job_summary_pdf(self.job, points)
            detailed_key = generate_job_pdf(self.job, points, analysis)
            summary_text = _pdf_text(Path(temp_dir) / summary_key)
            detailed_text = _pdf_text(Path(temp_dir) / detailed_key)
        settings.local_processed_dir = original_dir

        self.assertIn("Key Points", summary_text)
        self.assertNotIn("Questions people asked", summary_text)
        self.assertIn("Questions people asked", detailed_text)
        self.assertIn("Rules and decisions shared", detailed_text)
        self.assertIn("Words explained in simple English", detailed_text)


def _pdf_text(path: Path) -> str:
    reader = PdfReader(path)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


if __name__ == "__main__":
    unittest.main()
