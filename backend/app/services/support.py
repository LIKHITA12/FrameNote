"""Contact Us submissions plus the static support metadata the page renders."""

from sqlalchemy.orm import Session

from app.models.support_message import SupportMessage
from app.models.user import User
from app.schemas.support import (
    ContactMessageRequest,
    SupportChannel,
    SupportFaq,
    SupportMetaResponse,
    SupportTopic,
    SystemStatus,
)

SUPPORT_TOPICS: list[SupportTopic] = [
    SupportTopic(value="general", label="General Inquiry & Product Demo"),
    SupportTopic(value="support", label="Support & Technical Help"),
    SupportTopic(value="custom_volume", label="Custom Volume & Quotas"),
    SupportTopic(value="feature", label="Feature Request & AI Integration Feedback"),
    SupportTopic(value="billing", label="Billing & License Inquiries"),
]

_TOPIC_VALUES = {topic.value for topic in SUPPORT_TOPICS}

SUPPORT_CHANNELS: list[SupportChannel] = [
    SupportChannel(
        id="helpdesk",
        name="Beta Support",
        icon="headset_mic",
        description="Use the form to report a bug or ask a product question.",
        badge="Form",
        meta="Replies are not yet automated",
    ),
]

SUPPORT_FAQS: list[SupportFaq] = [
    SupportFaq(
        question="Can I use FrameNote with my whole team?",
        answer=(
            "Each account is a single workspace today. If you need several people working out of the same "
            "library, send a message using the form and we will tell you where shared workspaces sit on "
            "the roadmap."
        ),
    ),
    SupportFaq(
        question="What video formats and platforms are supported?",
        answer=(
            "FrameNote accepts common video uploads such as MP4, MOV, WebM, and MKV. It also accepts YouTube "
            "and other publicly reachable video links when the provider allows the media to be read."
        ),
    ),
    SupportFaq(
        question="Do you offer custom integrations & webhooks?",
        answer=(
            "Not yet. Notion, Slack, Linear, and public webhooks are roadmap items and are not included in the "
            "beta plans. Use the form to tell us which integration would help you most."
        ),
    ),
]


def build_support_meta(user: User | None) -> SupportMetaResponse:
    display_name = None
    if user:
        display_name = (user.full_name or "").strip() or user.email.split("@")[0]

    return SupportMetaResponse(
        topics=SUPPORT_TOPICS,
        channels=SUPPORT_CHANNELS,
        faqs=SUPPORT_FAQS,
        status=SystemStatus(),
        prefill_name=display_name,
        prefill_email=user.email if user else None,
    )


def create_support_message(db: Session, user: User | None, payload: ContactMessageRequest) -> SupportMessage:
    topic = payload.topic if payload.topic in _TOPIC_VALUES else "general"
    record = SupportMessage(
        user_id=user.id if user else None,
        name=payload.name.strip(),
        email=payload.email,
        topic=topic,
        message=payload.message.strip(),
        status="received",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    # No transactional email provider is wired up yet; log so local dev can see the routing target.
    print(f"[support] {topic} message {record.id} from {record.email}")
    return record
