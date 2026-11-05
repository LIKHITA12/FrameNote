from datetime import datetime

from pydantic import BaseModel, Field

# Star scale used by the rating control.
MIN_RATING = 1
MAX_RATING = 5

MIN_COMMENT_LENGTH = 10
MAX_COMMENT_LENGTH = 1000


class FeedbackSummary(BaseModel):
    """Aggregate of every public entry, for the "what others think" strip."""

    average_rating: float = 0.0
    total: int = 0
    # Count per star, always all five keys: {"5": 12, "4": 3, "3": 0, "2": 1, "1": 0}.
    distribution: dict[str, int] = Field(default_factory=dict)


class FeedbackItem(BaseModel):
    """One entry in the shared list. Carries a display name only, never an email."""

    feedback_id: str
    author: str
    rating: int
    comment: str
    created_at: datetime
    is_mine: bool = False
    # Only filled in for the caller's own entries, so nobody sees triage state on someone else's.
    status: str | None = None


class FeedbackListResponse(BaseModel):
    items: list[FeedbackItem] = Field(default_factory=list)
    total: int = 0
    has_more: bool = False
    summary: FeedbackSummary = Field(default_factory=FeedbackSummary)


class FeedbackMetaResponse(BaseModel):
    """Everything the Feedback tab needs on first render."""

    # Word for each point on the star scale, e.g. {"1": "Poor", ..., "5": "Excellent"}.
    rating_labels: dict[str, str]
    my_submitted_count: int = 0
    community: FeedbackListResponse = Field(default_factory=FeedbackListResponse)


class FeedbackCreateRequest(BaseModel):
    """The whole form: a rating and a comment."""

    rating: int = Field(ge=MIN_RATING, le=MAX_RATING, description="Overall rating, 1-5 stars")
    comment: str = Field(min_length=MIN_COMMENT_LENGTH, max_length=MAX_COMMENT_LENGTH)


class FeedbackCreateResponse(BaseModel):
    feedback_id: str
    message: str
