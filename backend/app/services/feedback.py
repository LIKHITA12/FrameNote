"""Ratings and comments from Settings > Feedback.

Two things are asked for (a star rating and a comment) and every public entry is read back
to signed-in users as a shared list, with an average and a star breakdown.
"""

import logging

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import (
    FeedbackCreateRequest,
    FeedbackItem,
    FeedbackListResponse,
    FeedbackMetaResponse,
    FeedbackSummary,
)

logger = logging.getLogger("framenote.feedback")

COMMUNITY_PAGE_SIZE = 5
MAX_PAGE_SIZE = 50

RATING_LABELS: dict[str, str] = {
    "1": "Poor",
    "2": "Needs work",
    "3": "Okay",
    "4": "Good",
    "5": "Excellent",
}


def build_feedback_meta(db: Session, user: User) -> FeedbackMetaResponse:
    return FeedbackMetaResponse(
        rating_labels=RATING_LABELS,
        my_submitted_count=_count_for_user(db=db, user_id=user.id),
        community=list_public_feedback(db=db, viewer=user),
    )


def create_feedback(db: Session, user: User, payload: FeedbackCreateRequest) -> Feedback:
    record = Feedback(
        user_id=user.id,
        rating=payload.rating,
        comment=payload.comment.strip(),
        is_public=True,
        status="new",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("Feedback %s: %s star(s) from %s", record.id, record.rating, user.email)
    return record


def list_public_feedback(
    db: Session, viewer: User | None = None, limit: int = COMMUNITY_PAGE_SIZE, offset: int = 0
) -> FeedbackListResponse:
    """Newest public entries plus the all-time summary, for the shared list."""
    page_size = max(1, min(limit, MAX_PAGE_SIZE))
    start = max(0, offset)

    total = int(db.scalar(select(func.count()).select_from(Feedback).where(Feedback.is_public.is_(True))) or 0)

    query = (
        select(Feedback, User)
        .outerjoin(User, Feedback.user_id == User.id)
        .where(Feedback.is_public.is_(True))
        # id breaks ties so the order is stable between requests; without it OFFSET
        # paging could repeat or skip an entry.
        .order_by(desc(Feedback.created_at), desc(Feedback.id))
        .limit(page_size)
        .offset(start)
    )
    rows = db.execute(query).all()
    viewer_id = viewer.id if viewer else None

    items = [
        FeedbackItem(
            feedback_id=record.id,
            author=_display_name(author),
            rating=record.rating,
            comment=record.comment,
            created_at=record.created_at,
            is_mine=record.user_id is not None and record.user_id == viewer_id,
            # Triage state is the author's business only.
            status=record.status if record.user_id == viewer_id else None,
        )
        for record, author in rows
    ]

    return FeedbackListResponse(
        items=items,
        total=total,
        has_more=start + len(items) < total,
        summary=build_summary(db=db),
    )


def build_summary(db: Session) -> FeedbackSummary:
    rows = db.execute(
        select(Feedback.rating, func.count())
        .where(Feedback.is_public.is_(True))
        .group_by(Feedback.rating)
    ).all()

    distribution = {str(star): 0 for star in range(5, 0, -1)}
    total = 0
    weighted = 0
    for rating, count in rows:
        key = str(int(rating))
        if key in distribution:
            distribution[key] = int(count)
        total += int(count)
        weighted += int(rating) * int(count)

    average = round(weighted / total, 1) if total else 0.0
    return FeedbackSummary(average_rating=average, total=total, distribution=distribution)


def _count_for_user(db: Session, user_id: str) -> int:
    total = db.scalar(select(func.count()).select_from(Feedback).where(Feedback.user_id == user_id))
    return int(total or 0)


def _display_name(author: User | None) -> str:
    """A human name for the shared list: first name plus last initial, never an email address."""
    if author is None:
        return "A FrameNote user"

    parts = (author.full_name or "").split()
    if parts:
        first = parts[0]
        if len(parts) > 1 and parts[-1]:
            return f"{first} {parts[-1][0].upper()}."
        return first

    # No name on the account: use the part of the email before @, minus any dots/plus tags.
    handle = author.email.split("@")[0].replace(".", " ").split("+")[0].strip()
    return handle.title() or "A FrameNote user"
