import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.routes import add_job_share, assign_job_project, create_project, remove_job_share
from app.db import Base
from app.models.job import Job
from app.models.user import User
from app.schemas.jobs import JobProjectRequest, ProjectRequest, ShareRequest
from app.services.history import list_history
from app.services.jobs import get_accessible_job_or_404, get_job_or_404, list_jobs_for_owner, to_job_response


class ProjectsAndSharingTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.owner = User(email="owner@example.test")
        self.viewer = User(email="viewer@example.test")
        self.stranger = User(email="stranger@example.test")
        self.db.add_all([self.owner, self.viewer, self.stranger])
        self.db.flush()
        self.job = Job(owner_id=self.owner.id, source_type="upload", file_name="Meeting.mp4")
        self.db.add(self.job)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_project_assignment_and_owner_boundary(self) -> None:
        project = create_project(ProjectRequest(name="  Research  "), db=self.db, current_user=self.owner)
        self.assertEqual(project.name, "Research")
        assigned = assign_job_project(self.job.id, JobProjectRequest(project_id=project.project_id), db=self.db, current_user=self.owner)
        self.assertEqual(assigned.project_name, "Research")
        self.assertEqual(list_history(self.db, self.owner.id, project_id=project.project_id).total, 1)
        with self.assertRaises(HTTPException) as denied:
            assign_job_project(self.job.id, JobProjectRequest(project_id=None), db=self.db, current_user=self.viewer)
        self.assertEqual(denied.exception.status_code, 404)
        other_project = create_project(ProjectRequest(name="Private"), db=self.db, current_user=self.stranger)
        with self.assertRaises(HTTPException) as denied:
            assign_job_project(self.job.id, JobProjectRequest(project_id=other_project.project_id), db=self.db, current_user=self.owner)
        self.assertEqual(denied.exception.status_code, 404)

    def test_share_read_and_revoke(self) -> None:
        with self.assertRaises(HTTPException):
            get_accessible_job_or_404(self.db, self.job.id, self.viewer.id)
        added = add_job_share(self.job.id, ShareRequest(email="VIEWER@example.test"), db=self.db, current_user=self.owner)
        self.assertEqual(added.role, "viewer")
        self.assertEqual(get_accessible_job_or_404(self.db, self.job.id, self.viewer.id).id, self.job.id)
        self.assertFalse(to_job_response(self.job, viewer_id=self.viewer.id).is_owner)
        self.assertEqual(len(list_jobs_for_owner(self.db, self.viewer.id)), 1)
        self.assertEqual(list_history(self.db, self.viewer.id).total, 1)
        with self.assertRaises(HTTPException) as denied:
            get_job_or_404(self.db, self.job.id, owner_id=self.viewer.id)
        self.assertEqual(denied.exception.status_code, 404)
        with self.assertRaises(HTTPException) as denied:
            add_job_share(self.job.id, ShareRequest(email="stranger@example.test"), db=self.db, current_user=self.viewer)
        self.assertEqual(denied.exception.status_code, 404)
        remove_job_share(self.job.id, self.viewer.id, db=self.db, current_user=self.owner)
        with self.assertRaises(HTTPException):
            get_accessible_job_or_404(self.db, self.job.id, self.viewer.id)


if __name__ == "__main__":
    unittest.main()
