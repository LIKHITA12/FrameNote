"""Release blockers B-6 to B-11: stuck jobs, R2 streaming, in-API fallback, temp providers, placeholder output, SSRF."""

import socket
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
from celery.exceptions import SoftTimeLimitExceeded
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import Settings, settings
from app.db import Base
from app.models.job import Job
from app.models.user import User
from app.services import processing, storage
from app.services.dispatch import QUEUE_UNAVAILABLE_REASON, enqueue_job_task
from app.services.jobs import STALE_JOB_REASON, fail_stale_jobs
from app.services.video_url import _is_public_ip, public_network_only, validate_public_video_url, PublicVideoUrlError
from tasks import worker

PRODUCTION_DB_URL = "postgresql+psycopg://framenote:long-random-password@db.example.test/framenote?sslmode=require"
PRODUCTION_BASE = dict(
    _env_file=None, environment="production", jwt_secret_key="0123456789abcdefghijklmnopqrstuv",
    legacy_header_auth_enabled=False, r2_endpoint="https://r2.example.test",
    r2_access_key_id="key", r2_secret_access_key="secret", r2_bucket="private",
    database_url=PRODUCTION_DB_URL,
)


class DbTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.user = User(email="reliability@example.test")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _job(self, **fields) -> Job:
        job = Job(owner_id=self.user.id, source_type="upload", **fields)
        self.db.add(job)
        self.db.commit()
        return job


class StuckJobTests(DbTestCase):
    def test_celery_requeues_lost_tasks_and_limits_runtime(self) -> None:
        conf = worker.celery_app.conf
        self.assertTrue(conf.task_acks_late)
        self.assertTrue(conf.task_reject_on_worker_lost)
        self.assertEqual(conf.worker_prefetch_multiplier, 1)
        self.assertLess(conf.task_soft_time_limit, conf.task_time_limit)
        self.assertGreater(conf.broker_transport_options["visibility_timeout"], conf.task_time_limit)
        self.assertEqual(conf.beat_schedule["fail-stale-jobs"]["task"], "tasks.fail_stale_jobs")

    def test_sweeper_fails_only_abandoned_jobs(self) -> None:
        now = datetime.now(timezone.utc)
        long_ago = now - timedelta(days=2)
        abandoned = self._job(status="processing", processing_started_at=long_ago)
        running = self._job(status="processing", processing_started_at=now - timedelta(minutes=5))
        old_queued = self._job(status="queued", updated_at=long_ago)
        new_queued = self._job(status="queued")
        done = self._job(status="completed", processing_started_at=long_ago)

        self.assertEqual(fail_stale_jobs(self.db, now=now), 2)
        self.db.expire_all()
        self.assertEqual((abandoned.status, abandoned.error_message), ("failed", STALE_JOB_REASON))
        self.assertEqual(old_queued.status, "failed")
        self.assertEqual(running.status, "processing")
        self.assertEqual(new_queued.status, "queued")
        self.assertEqual(done.status, "completed")

    def test_redelivered_task_does_not_rerun_a_completed_job(self) -> None:
        job = self._job(status="completed", summary="kept")
        with patch.object(worker, "SessionLocal", self.session_factory), patch.object(worker, "run_job_pipeline") as pipeline:
            worker.process_job(job.id)
        pipeline.assert_not_called()
        self.db.expire_all()
        self.assertEqual((job.status, job.summary), ("completed", "kept"))

    def test_time_limit_fails_job_with_readable_reason(self) -> None:
        job = self._job(status="queued")
        with patch.object(worker, "SessionLocal", self.session_factory), patch.object(
            worker, "run_job_pipeline", side_effect=SoftTimeLimitExceeded()
        ):
            worker.process_job(job.id)
        self.db.expire_all()
        self.assertEqual((job.status, job.error_message), ("failed", worker.TIMEOUT_REASON))


class DispatchTests(DbTestCase):
    def _broken_task(self) -> MagicMock:
        task = MagicMock()
        task.apply_async.side_effect = ConnectionError("redis down")
        return task

    def test_production_never_runs_the_pipeline_in_the_api(self) -> None:
        job = self._job(status="queued")
        tasks = BackgroundTasks()
        with patch.object(settings, "environment", "production"), self.assertRaises(HTTPException) as raised:
            enqueue_job_task(self._broken_task(), (job.id,), tasks, self.db, job)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(tasks.tasks, [])
        self.db.expire_all()
        self.assertEqual((job.status, job.error_message), ("failed", QUEUE_UNAVAILABLE_REASON))

    def test_development_falls_back_to_in_process(self) -> None:
        job = self._job(status="queued")
        tasks = BackgroundTasks()
        with patch.object(settings, "environment", "development"):
            enqueue_job_task(self._broken_task(), (job.id,), tasks, self.db, job)
        self.assertEqual(len(tasks.tasks), 1)
        self.assertEqual(job.status, "queued")


class R2StreamingTests(unittest.TestCase):
    def test_r2_upload_is_streamed_through_a_presigned_link(self) -> None:
        s3 = MagicMock()
        s3.generate_presigned_url.return_value = "https://r2.example.test/signed"
        with tempfile.TemporaryDirectory() as empty, patch.object(settings, "local_upload_dir", empty), patch.object(
            storage, "_can_use_r2", return_value=True
        ), patch.object(storage, "_r2_client", return_value=s3):
            url = storage.presigned_upload_download_url("uploads/user/video.mp4")
        self.assertEqual(url, "https://r2.example.test/signed")
        s3.download_file.assert_not_called()
        self.assertEqual(s3.generate_presigned_url.call_args.args[0], "get_object")

    def test_local_upload_is_served_from_disk(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.object(settings, "local_upload_dir", root), patch.object(
            storage, "_can_use_r2", return_value=True
        ):
            path = Path(root) / "uploads/user/video.mp4"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"x")
            self.assertIsNone(storage.presigned_upload_download_url("uploads/user/video.mp4"))


class ProviderTests(unittest.TestCase):
    def test_production_rejects_temp_providers_and_missing_ai_key(self) -> None:
        self.assertEqual(Settings(**PRODUCTION_BASE, openai_api_key="sk").environment, "production")
        with self.assertRaises(ValueError):
            Settings(**PRODUCTION_BASE)
        with self.assertRaises(ValueError):
            Settings(**PRODUCTION_BASE, openai_api_key="sk", enable_temp_providers=True)

    def test_temp_providers_default_to_development_only(self) -> None:
        self.assertTrue(Settings(_env_file=None, environment="development").temp_providers_enabled)
        self.assertFalse(Settings(_env_file=None, environment="test").temp_providers_enabled)
        with patch.object(settings, "enable_temp_providers", False), patch.dict("sys.modules", {"app.services.temp_azure_llm": None}):
            # Disabled means the module is never imported, so no UHG endpoint is ever called.
            self.assertIsNone(processing._try_temp_azure_summary("transcript"))
            self.assertIsNone(processing._try_temp_local_whisper(Path("audio.mp3")))

    def test_production_fails_instead_of_placeholder_output(self) -> None:
        with patch.object(settings, "environment", "production"), patch.object(settings, "enable_temp_providers", False), patch.object(
            settings, "openai_api_key", None
        ), patch.object(settings, "gemini_api_key", None):
            with self.assertRaises(ValueError):
                processing.transcribe_audio_file(Path("audio.mp3"))
            with self.assertRaises(ValueError):
                processing._summarize_transcript("hello world", "upload")

    def test_development_placeholder_does_not_leak_server_paths(self) -> None:
        with patch.object(settings, "environment", "development"), patch.object(settings, "enable_temp_providers", False), patch.object(
            settings, "openai_api_key", None
        ), patch.object(settings, "gemini_api_key", None):
            text, _ = processing.transcribe_audio_file(Path("/srv/secret/audio.mp3"))
        self.assertNotIn("/srv/secret", text)


class SsrfTests(unittest.TestCase):
    def test_only_global_addresses_are_public(self) -> None:
        for address in ("169.254.169.254", "100.64.0.1", "10.0.0.1", "127.0.0.1", "::1", "::ffff:127.0.0.1", "fe80::1%en0", "0.0.0.0"):
            with self.subTest(address=address):
                self.assertFalse(_is_public_ip(address))
        self.assertTrue(_is_public_ip("8.8.8.8"))
        self.assertTrue(_is_public_ip("2606:4700:4700::1111"))

    def test_link_to_internal_address_is_rejected(self) -> None:
        with patch.object(settings, "allow_private_video_urls", False), self.assertRaises(PublicVideoUrlError):
            validate_public_video_url("http://169.254.169.254/latest/meta-data/")

    def test_connections_during_ingestion_cannot_reach_internal_hosts(self) -> None:
        # Covers redirects and DNS rebinding: the check happens when each connection is opened.
        with patch.object(settings, "allow_private_video_urls", False):
            with public_network_only():
                with self.assertRaises(socket.gaierror):
                    socket.getaddrinfo("127.0.0.1", 80)
                with self.assertRaises(httpx.ConnectError):
                    httpx.get("http://127.0.0.1:9/", timeout=2)
            # Outside a fetch (DB, Redis, other threads) lookups are untouched.
            self.assertTrue(socket.getaddrinfo("127.0.0.1", 80))


if __name__ == "__main__":
    unittest.main()
