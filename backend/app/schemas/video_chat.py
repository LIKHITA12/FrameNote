from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VideoChatContext(BaseModel):
    context_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    label: str = Field(min_length=1, max_length=80)
    selected_text: str | None = Field(default=None, max_length=1200)


class VideoChatQuestionRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    contexts: list[VideoChatContext] = Field(default_factory=list, max_length=8)


class VideoChatCitation(BaseModel):
    timestamp_seconds: int = Field(ge=0)
    label: str
    excerpt: str


class VideoChatMessage(BaseModel):
    message_id: str
    role: Literal["user", "assistant"]
    content: str
    citations: list[VideoChatCitation] = Field(default_factory=list)
    contexts: list[VideoChatContext] = Field(default_factory=list)
    created_at: datetime


class VideoChatUsage(BaseModel):
    used_this_month: int
    monthly_limit: int
    remaining_this_month: int
    used_for_video: int
    per_video_limit: int | None = None


class VideoChatHistoryResponse(BaseModel):
    job_id: str
    messages: list[VideoChatMessage] = Field(default_factory=list)
    usage: VideoChatUsage
    ai_configured: bool


class VideoChatAnswerResponse(BaseModel):
    user_message: VideoChatMessage
    assistant_message: VideoChatMessage
    usage: VideoChatUsage
