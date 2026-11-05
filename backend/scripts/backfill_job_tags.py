"""Backfill keyword badges for completed jobs that were processed before tagging existed.

Run from the backend folder: python -m scripts.backfill_job_tags
"""

import json

from sqlalchemy import select

from app.db import SessionLocal
from app.models.job import Job
from app.services.processing import generate_tags_from_notes


def main() -> None:
    with SessionLocal() as db:
        jobs = list(db.scalars(select(Job).where(Job.status == "completed")).all())
        updated = 0
        for job in jobs:
            existing = json.loads(job.tags_json or "[]")
            if isinstance(existing, list) and len(existing) > 1:
                continue
            key_points = json.loads(job.key_points_json or "[]")
            tags = generate_tags_from_notes(
                summary=job.summary or "",
                key_points=key_points if isinstance(key_points, list) else [],
                source_type=job.source_type,
            )
            job.tags_json = json.dumps(tags)
            db.add(job)
            updated += 1
            print(f"{job.id}: {tags}")
        db.commit()
        print(f"Updated {updated} of {len(jobs)} completed jobs.")


if __name__ == "__main__":
    main()
