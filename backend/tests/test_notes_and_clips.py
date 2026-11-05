import json
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.routes import create_job_clip, delete_job_clip, list_job_clips, update_job_notes
from app.db import Base
from app.models.job import Job
from app.models.job_collaborator import JobCollaborator
from app.models.user import User
from app.schemas.jobs import JobClipRequest, JobNotesUpdateRequest


class NotesAndClipsTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.owner = User(email="notes-owner@example.test")
        self.viewer = User(email="notes-viewer@example.test")
        self.db.add_all([self.owner, self.viewer])
        self.db.flush()
        self.job = Job(
            owner_id=self.owner.id,
            source_type="upload",
            status="completed",
            summary="Original summary",
            analysis_json=json.dumps({
                "overview": "Original summary",
                "decisions": ["Old decision"],
                "action_items": ["Old action"],
                "action_item_details": [{"title": "Old action", "owner": "Alex"}],
            }),
            custom_action_items_json='["Custom action"]',
            completed_action_items_json="[0]",
            pdf_asset_key="old-report.pdf",
            media_duration_seconds=120,
        )
        self.db.add(self.job)
        self.db.flush()
        self.db.add(JobCollaborator(job_id=self.job.id, user_id=self.viewer.id, role="viewer"))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_edit_updates_notes_and_invalidates_pdf(self) -> None:
        response = update_job_notes(
            self.job.id,
            JobNotesUpdateRequest(summary="  Revised summary  ", decisions=["New decision"], action_items=["New action"]),
            db=self.db,
            current_user=self.owner,
        )
        self.assertEqual(response.summary, "Revised summary")
        self.assertEqual(response.analysis.decisions, ["New decision"])
        self.assertEqual(response.analysis.action_items, ["New action"])
        self.assertEqual(response.analysis.action_item_details, [])
        self.assertEqual(response.custom_action_items, [])
        self.assertEqual(response.completed_action_items, [])
        self.assertIsNone(response.pdf_url)
        self.assertEqual(json.loads(self.job.analysis_json)["overview"], "Revised summary")

        with self.assertRaises(HTTPException) as denied:
            update_job_notes(self.job.id, JobNotesUpdateRequest(summary="Changed by viewer"), db=self.db, current_user=self.viewer)
        self.assertEqual(denied.exception.status_code, 404)

    def test_clips_allow_viewer_reads_and_owner_writes(self) -> None:
        clip = create_job_clip(
            self.job.id, JobClipRequest(title="  Main point  ", start_seconds=20, end_seconds=45),
            db=self.db, current_user=self.owner,
        )
        self.assertEqual(clip.title, "Main point")
        self.assertEqual(list_job_clips(self.job.id, db=self.db, current_user=self.viewer)[0].clip_id, clip.clip_id)
        with self.assertRaises(HTTPException) as denied:
            create_job_clip(self.job.id, JobClipRequest(title="Viewer", start_seconds=1, end_seconds=2), db=self.db, current_user=self.viewer)
        self.assertEqual(denied.exception.status_code, 404)
        with self.assertRaises(HTTPException) as invalid:
            create_job_clip(self.job.id, JobClipRequest(title="Invalid", start_seconds=50, end_seconds=20), db=self.db, current_user=self.owner)
        self.assertEqual(invalid.exception.status_code, 422)
        delete_job_clip(self.job.id, clip.clip_id, db=self.db, current_user=self.owner)
        self.assertEqual(list_job_clips(self.job.id, db=self.db, current_user=self.owner), [])


if __name__ == "__main__":
    unittest.main()
