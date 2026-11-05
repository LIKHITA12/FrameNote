from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class NotificationItem(BaseModel):
    job_id: str
    title: str
    kind: Literal["completed", "failed"]
    message: str
    occurred_at: datetime
    unread: bool = False


class NotificationListResponse(BaseModel):
    items: list[NotificationItem] = Field(default_factory=list)
    unread_count: int = 0
