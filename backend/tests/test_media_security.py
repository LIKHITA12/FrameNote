import tempfile
import json
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.deps import get_db
from app.api.routes import router
from app.core.config import settings
from app.db import Base
from app.models.job import Job
from app.models.job_collaborator import JobCollaborator
from app.models.user import User
from app.services.auth import create_access_token


class MediaSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.owner = User(email="media-owner@example.test")
        self.viewer = User(email="media-viewer@example.test")
        self.stranger = User(email="media-stranger@example.test")
        self.db.add_all([self.owner, self.viewer, self.stranger])
        self.db.commit()
        self.temp = tempfile.TemporaryDirectory()
        self.original_upload_dir = settings.local_upload_dir
        self.original_processed_dir = settings.local_processed_dir
        self.original_max_upload_bytes = settings.max_upload_bytes
        settings.local_upload_dir = self.temp.name
        settings.local_processed_dir = self.temp.name
        settings.max_upload_bytes = 1024
        # Local R2 credentials in .env would otherwise send the presign to R2 instead of the mock upload route.
        r2_patch = patch("app.services.storage._can_use_r2", return_value=False)
        r2_patch.start()
        self.addCleanup(r2_patch.stop)
        app = FastAPI()
        app.include_router(router, prefix=settings.api_v1_prefix)

        def test_db():
            session = self.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        self.db.close()
        settings.local_upload_dir = self.original_upload_dir
        settings.local_processed_dir = self.original_processed_dir
        settings.max_upload_bytes = self.original_max_upload_bytes
        self.temp.cleanup()
        self.engine.dispose()

    def _headers(self, user: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user.id)}"}

    def test_upload_requires_user_and_signed_one_use_link(self) -> None:
        endpoint = "/api/v1/uploads/presign"
        payload = {"file_name": "meeting.mp4", "content_type": "video/mp4", "file_size": 3}
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 401)
        presign = self.client.post(endpoint, json=payload, headers=self._headers(self.owner))
        self.assertEqual(presign.status_code, 200)
        key = presign.json()["object_key"]
        self.assertTrue(key.startswith(f"uploads/{self.owner.id}/"))
        upload_url = presign.json()["upload_url"]
        target = urlsplit(upload_url)
        path = f"{target.path}?{target.query}"
        self.assertEqual(self.client.put(target.path, content=b"abc").status_code, 401)
        self.assertEqual(self.client.put(path, content=b"abc").status_code, 200)
        self.assertEqual(self.client.put(path, content=b"abc").status_code, 409)
        self.assertEqual((Path(self.temp.name) / key).read_bytes(), b"abc")

        too_large = self.client.post(endpoint, json=payload, headers=self._headers(self.owner)).json()["upload_url"]
        target = urlsplit(too_large)
        self.assertEqual(self.client.put(f"{target.path}?{target.query}", content=b"x" * 1025).status_code, 413)
        self.assertEqual(self.client.post(endpoint, json={**payload, "file_size": 1025}, headers=self._headers(self.owner)).status_code, 413)

    def test_production_ignores_legacy_identity_header(self) -> None:
        demo = User(email="demo@framenote.local")
        self.db.add(demo)
        self.db.commit()
        with patch.object(settings, "environment", "production"):
            response = self.client.get("/api/v1/jobs", headers={"X-User-Email": self.owner.email})
            demo_response = self.client.get("/api/v1/jobs", headers=self._headers(demo))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(demo_response.status_code, 401)

    def test_asset_link_checks_job_access_and_revocation(self) -> None:
        key = f"uploads/{self.owner.id}/sample.mp4"
        path = Path(self.temp.name) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"video-data")
        job = Job(owner_id=self.owner.id, source_type="upload", upload_object_key=key, status="completed")
        self.db.add(job)
        self.db.commit()
        job_id = job.id
        asset_path = f"/api/v1/assets/{key}"
        self.assertEqual(self.client.get(asset_path).status_code, 401)

        owner_response = self.client.get(f"/api/v1/jobs/{job_id}", headers=self._headers(self.owner))
        owner_url = owner_response.json()["video_url"]
        target = urlsplit(owner_url)
        self.assertEqual(self.client.get(f"{target.path}?{target.query}").content, b"video-data")
        ranged = self.client.get(f"{target.path}?{target.query}", headers={"Range": "bytes=0-4"})
        self.assertEqual(ranged.status_code, 206)
        self.assertEqual(ranged.content, b"video")

        self.db.add(JobCollaborator(job_id=job_id, user_id=self.viewer.id, role="viewer"))
        self.db.commit()
        viewer_url = self.client.get(f"/api/v1/jobs/{job_id}", headers=self._headers(self.viewer)).json()["video_url"]
        target = urlsplit(viewer_url)
        self.assertEqual(self.client.get(f"{target.path}?{target.query}").status_code, 200)
        self.db.query(JobCollaborator).filter_by(job_id=job_id, user_id=self.viewer.id).delete()
        self.db.commit()
        self.assertEqual(self.client.get(f"{target.path}?{target.query}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/jobs/{job_id}", headers=self._headers(self.stranger)).status_code, 404)

    def test_generated_frame_and_pdf_links_are_scoped_to_job(self) -> None:
        job = Job(owner_id=self.owner.id, source_type="youtube", source_url="https://www.youtube.com/watch?v=abc123def45", status="completed")
        self.db.add(job)
        self.db.flush()
        frame_key = f"frames/{job.id}/01-10.jpg"
        pdf_key = f"frames/{job.id}/report.pdf"
        job.key_points_json = json.dumps([{
            "title": "Decision", "description": "Approved", "timestamp_seconds": 10,
            "frame_image_url": f"http://localhost:8000/api/v1/assets/{frame_key}",
        }])
        job.pdf_asset_key = pdf_key
        self.db.commit()
        for asset_key in (frame_key, pdf_key):
            path = Path(self.temp.name) / asset_key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"private")

        response = self.client.get(f"/api/v1/jobs/{job.id}", headers=self._headers(self.owner)).json()
        for url in (response["key_points"][0]["frame_image_url"], response["pdf_url"]):
            target = urlsplit(url)
            self.assertTrue(target.query.startswith("access_token="))
            self.assertEqual(self.client.get(f"{target.path}?{target.query}").content, b"private")
            self.assertEqual(self.client.get(target.path).status_code, 401)


if __name__ == "__main__":
    unittest.main()
