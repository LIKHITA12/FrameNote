from pydantic import BaseModel, Field, field_validator


class SupportTopic(BaseModel):
    value: str
    label: str


class SupportChannel(BaseModel):
    id: str
    name: str
    icon: str
    description: str
    email: str | None = None
    badge: str | None = None
    meta: str | None = None
    links: list[dict[str, str]] = Field(default_factory=list)


class SupportFaq(BaseModel):
    question: str
    answer: str


class SystemStatus(BaseModel):
    operational: bool = True
    headline: str = "Local beta status"
    detail: str = "No public status monitor is connected yet"
    uptime_percent: float = 0
    status_page_url: str = "/workspace/contact"


class SupportMetaResponse(BaseModel):
    topics: list[SupportTopic]
    channels: list[SupportChannel]
    faqs: list[SupportFaq]
    status: SystemStatus
    typical_reply: str = "Manual beta support"
    response_window: str = "Replies are handled manually during the beta."
    prefill_name: str | None = None
    prefill_email: str | None = None


class ContactMessageRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=255)
    topic: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=10, max_length=1200)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        # Shape check only; we deliberately avoid the email-validator dependency here.
        normalized = value.strip().lower()
        local, _, domain = normalized.partition("@")
        if not local or not domain or "." not in domain or " " in normalized:
            raise ValueError("Enter a valid email address.")
        return normalized


class ContactMessageResponse(BaseModel):
    message_id: str
    email: str
    message: str
