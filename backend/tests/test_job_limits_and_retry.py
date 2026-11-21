import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register tables
from app.db import Base
from app.models.job import Job
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.jobs import JobAnalysis
from app.services.analysis import _merge_action_details
from app.services.jobs import prepare_job_retry
from app.services.usage import ensure_job_creation_allowed, reserve_media_duration


class JobLimitsAndRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(email="limits@example.test")
        self.db.add(self.user)
        self.db.flush()
        self.subscription = Subscription(user_id=self.user.id, tier="free", status="active")
        self.db.add(self.subscription)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_free_plan_counts_only_active_jobs(self) -> None:
        self.db.add(Job(owner_id=self.user.id, source_type="upload", status="queued", media_duration_seconds=1800))
        self.db.commit()
        # 30 of the 60 free minutes used: another video is still allowed.
        ensure_job_creation_allowed(self.db, self.user, "url")

        self.db.add(Job(owner_id=self.user.id, source_type="url", status="completed", media_duration_seconds=1800))
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            ensure_job_creation_allowed(self.db, self.user, "url")
        self.assertEqual(raised.exception.status_code, 403)

        job = self.db.query(Job).filter(Job.status == "completed").first()
        job.status = "failed"
        self.db.commit()
        ensure_job_creation_allowed(self.db, self.user, "upload")

    def test_free_youtube_caption_notes_are_counted(self) -> None:
        for _ in range(3):
            self.db.add(Job(owner_id=self.user.id, source_type="youtube", status="completed"))
        self.db.commit()
        with self.assertRaises(HTTPException):
            ensure_job_creation_allowed(self.db, self.user, "youtube")
        ensure_job_creation_allowed(self.db, self.user, "upload")

    def test_duration_is_checked_before_reserving(self) -> None:
        job = Job(owner_id=self.user.id, source_type="upload", status="processing")
        self.db.add(job)
        self.db.commit()
        with self.assertRaises(HTTPException):
            reserve_media_duration(self.db, job, 30 * 60 + 1)
        self.assertIsNone(job.media_duration_seconds)
        reserve_media_duration(self.db, job, 30 * 60)
        self.assertEqual(job.media_duration_seconds, 30 * 60)

    def test_pro_limits_are_two_hours_per_video_and_fifteen_per_month(self) -> None:
        self.subscription.tier = "pro"
        self.db.commit()
        self.db.add(Job(owner_id=self.user.id, source_type="upload", status="completed", media_duration_seconds=14 * 3600))
        job = Job(owner_id=self.user.id, source_type="upload", status="processing")
        self.db.add(job)
        self.db.commit()
        with self.assertRaises(HTTPException):
            reserve_media_duration(self.db, job, 2 * 3600 + 1)
        with self.assertRaises(HTTPException):
            reserve_media_duration(self.db, job, 3600 + 1)
        reserve_media_duration(self.db, job, 3600)
        self.assertEqual(job.media_duration_seconds, 3600)

    def test_retry_only_accepts_failed_workspace_jobs(self) -> None:
        job = Job(owner_id=self.user.id, source_type="upload", status="failed", error_message="transient error")
        self.db.add(job)
        self.db.commit()
        retried = prepare_job_retry(self.db, job)
        self.assertEqual(retried.status, "queued")
        self.assertIsNone(retried.error_message)
        with self.assertRaises(HTTPException) as raised:
            prepare_job_retry(self.db, retried)
        self.assertEqual(raised.exception.status_code, 409)

    def test_action_item_owner_is_preserved_without_guessing_missing_fields(self) -> None:
        details = _merge_action_details([{
            "action_item_details": [
                {"title": "Send final review", "owner": "Sam", "due": "today", "priority": "high"},
                {"title": "Ship dashboard", "owner": None, "due": None, "priority": "urgent"},
            ]
        }])
        analysis = JobAnalysis.model_validate({"action_item_details": details})
        self.assertEqual(analysis.action_item_details[0].owner, "Sam")
        self.assertEqual(analysis.action_item_details[1].priority, None)


if __name__ == "__main__":
    unittest.main()
