import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register all models for metadata creation
from app.db import Base
from app.models.job import Job
from app.models.user import User
from app.services.history import list_history


class HistorySourceFilterTests(unittest.TestCase):
    def test_explicit_empty_selection_returns_no_reports(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        with sessionmaker(bind=engine)() as db:
            user = User(email="history@example.test")
            db.add(user)
            db.flush()
            db.add(Job(owner_id=user.id, source_type="upload", file_name="Meeting.mp4"))
            db.commit()

            self.assertEqual(list_history(db, user.id, sources=None).total, 1)
            self.assertEqual(list_history(db, user.id, sources=["upload"]).total, 1)
            self.assertEqual(list_history(db, user.id, sources=["none"]).total, 0)
            self.assertEqual(list_history(db, user.id, sources=[]).total, 0)


if __name__ == "__main__":
    unittest.main()
