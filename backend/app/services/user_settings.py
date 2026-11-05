"""Read/write helpers for the per-user preferences shown on the Settings page."""

import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage
from app.models.job import Job
from app.models.subscription import Subscription
from app.models.support_message import SupportMessage
from app.models.user import User
from app.models.user_settings import UserSettings
from app.schemas.settings import (
    IntegrationState,
    SelectOption,
    UserSettingsResponse,
    UserSettingsUpdateRequest,
)
from app.services.auth import hash_password, verify_password

LANGUAGE_OPTIONS: list[SelectOption] = [
    SelectOption(value="auto", label="Auto-detect (English primary)"),
    SelectOption(value="en-US", label="English (United States)"),
    SelectOption(value="es", label="Spanish (Espanol)"),
    SelectOption(value="fr", label="French (Francais)"),
    SelectOption(value="de", label="German (Deutsch)"),
    SelectOption(value="ja", label="Japanese (Nihongo)"),
]

TIMEZONE_OPTIONS: list[SelectOption] = [
    SelectOption(value="UTC", label="UTC (Coordinated Universal Time)"),
    SelectOption(value="America/Los_Angeles", label="Pacific Time (US & Canada) UTC-8"),
    SelectOption(value="America/Denver", label="Mountain Time (US & Canada) UTC-7"),
    SelectOption(value="America/Chicago", label="Central Time (US & Canada) UTC-6"),
    SelectOption(value="America/New_York", label="Eastern Time (US & Canada) UTC-5"),
    SelectOption(value="Europe/London", label="London (GMT) UTC+0"),
    SelectOption(value="Europe/Berlin", label="Central European Time UTC+1"),
    SelectOption(value="Asia/Kolkata", label="India Standard Time UTC+5:30"),
    SelectOption(value="Asia/Tokyo", label="Japan Standard Time UTC+9"),
]

TRANSCRIPTION_BACKEND_OPTIONS: list[SelectOption] = [
    SelectOption(
        value="whisper-v3",
        label="Whisper v3 High Precision (99%)",
        description="Optimized for rapid speaker shifts & multi-lingual audio.",
    ),
    SelectOption(
        value="whisper-turbo",
        label="Whisper Turbo (fastest)",
        description="Roughly 3x faster ingestion with a small accuracy trade-off.",
    ),
    SelectOption(
        value="azure-stt",
        label="Azure Speech-to-Text",
        description="Route transcription through your own Azure Speech resource.",
    ),
]

REASONING_LLM_OPTIONS: list[SelectOption] = [
    SelectOption(
        value="sonnet",
        label="Sonnet",
        badge="Claude 3.5",
        description="Claude 3.5 powers highest density synthesized outlines.",
    ),
    SelectOption(
        value="gpt-4o",
        label="GPT-4o",
        badge="OpenAI",
        description="Balanced reasoning with the broadest tool coverage.",
    ),
    SelectOption(
        value="gemini-1.5",
        label="Gemini 1.5",
        badge="Google Deep",
        description="Largest context window for very long recordings.",
    ),
]

SUMMARY_FORMAT_OPTIONS: list[SelectOption] = [
    SelectOption(
        value="executive_brief",
        label="Executive Brief",
        description="High-level outcome memos, friction areas, and primary timeline blocks.",
    ),
    SelectOption(
        value="action_items",
        label="Action Items Only",
        description="Linear tasks, assignees, stated commitments, and dead-line milestones.",
    ),
    SelectOption(
        value="full_dossier",
        label="Full Dossier",
        description="Deep transcript citations, speaker sentiment graphs, and timestamp index.",
    ),
]

INTEGRATION_CATALOG: list[dict[str, str]] = [
    {
        "id": "notion",
        "name": "Notion Workspace",
        "icon": "description",
        "description": "Export to 'Product Strategy & Architecture Roadmap'",
        "badge": "Synced",
        "kind": "toggle",
    },
    {
        "id": "slack",
        "name": "Slack Digest",
        "icon": "tag",
        "description": "Broadcast executive notes to #product-updates",
        "badge": "Daily 09:00",
        "kind": "toggle",
    },
    {
        "id": "linear",
        "name": "Linear Task Sync",
        "icon": "checklist",
        "description": "Auto-create ticket drafts from confirmed speaker commitments",
        "badge": "Auto-Draft",
        "kind": "toggle",
    },
    {
        "id": "zoom_drive",
        "name": "Zoom Cloud & Google Drive",
        "icon": "videocam",
        "description": "Ingest recordings as soon as cloud processing finalizes",
        "badge": None,
        "kind": "link",
    },
]

_LANGUAGE_VALUES = {option.value for option in LANGUAGE_OPTIONS}
_TIMEZONE_VALUES = {option.value for option in TIMEZONE_OPTIONS}
_BACKEND_VALUES = {option.value for option in TRANSCRIPTION_BACKEND_OPTIONS}
_LLM_VALUES = {option.value for option in REASONING_LLM_OPTIONS}
_FORMAT_VALUES = {option.value for option in SUMMARY_FORMAT_OPTIONS}
_INTEGRATION_IDS = {entry["id"] for entry in INTEGRATION_CATALOG}

MAX_GLOSSARY_TERMS = 50


def get_or_create_settings(db: Session, user: User) -> UserSettings:
    existing = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if existing:
        return existing

    created = UserSettings(user_id=user.id)
    db.add(created)
    db.commit()
    db.refresh(created)
    return created


def _parse_integrations(settings_row: UserSettings) -> dict[str, bool]:
    try:
        parsed = json.loads(settings_row.integrations_json or "{}")
    except ValueError:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    return {key: bool(value) for key, value in parsed.items() if key in _INTEGRATION_IDS}


def _parse_glossary(settings_row: UserSettings) -> list[str]:
    try:
        parsed = json.loads(settings_row.glossary_terms_json or "[]")
    except ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(term) for term in parsed if str(term).strip()]


def to_settings_response(user: User, settings_row: UserSettings) -> UserSettingsResponse:
    enabled = _parse_integrations(settings_row)
    integrations = [
        IntegrationState(
            id=entry["id"],
            name=entry["name"],
            icon=entry["icon"],
            description=entry["description"],
            badge=entry["badge"],
            kind=entry["kind"],
            enabled=enabled.get(entry["id"], False),
        )
        for entry in INTEGRATION_CATALOG
    ]

    return UserSettingsResponse(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role_title=settings_row.role_title,
        timezone=settings_row.timezone,
        avatar_url=settings_row.avatar_url,
        email_verified=user.email_verified,
        password_changed_at=settings_row.password_changed_at,
        transcription_language=settings_row.transcription_language,
        transcription_backend=settings_row.transcription_backend,
        reasoning_llm=settings_row.reasoning_llm,
        summary_format=settings_row.summary_format,
        smart_diarization=settings_row.smart_diarization,
        glossary_terms=_parse_glossary(settings_row),
        notify_on_ready=settings_row.notify_on_ready,
        weekly_digest=settings_row.weekly_digest,
        integrations=integrations,
        language_options=LANGUAGE_OPTIONS,
        timezone_options=TIMEZONE_OPTIONS,
        transcription_backend_options=TRANSCRIPTION_BACKEND_OPTIONS,
        reasoning_llm_options=REASONING_LLM_OPTIONS,
        summary_format_options=SUMMARY_FORMAT_OPTIONS,
    )


def _require_choice(value: str, allowed: set[str], field: str) -> str:
    if value not in allowed:
        raise HTTPException(status_code=422, detail=f"Unsupported {field}: {value}")
    return value


def update_settings(db: Session, user: User, payload: UserSettingsUpdateRequest) -> UserSettings:
    settings_row = get_or_create_settings(db=db, user=user)

    if payload.full_name is not None:
        cleaned = payload.full_name.strip()
        user.full_name = cleaned or None
        db.add(user)

    if payload.role_title is not None:
        settings_row.role_title = payload.role_title.strip() or None
    if payload.timezone is not None:
        settings_row.timezone = _require_choice(payload.timezone, _TIMEZONE_VALUES, "timezone")
    if payload.avatar_url is not None:
        settings_row.avatar_url = payload.avatar_url.strip() or None

    if payload.transcription_language is not None:
        settings_row.transcription_language = _require_choice(
            payload.transcription_language, _LANGUAGE_VALUES, "transcription language"
        )
    if payload.transcription_backend is not None:
        settings_row.transcription_backend = _require_choice(
            payload.transcription_backend, _BACKEND_VALUES, "transcription backend"
        )
    if payload.reasoning_llm is not None:
        settings_row.reasoning_llm = _require_choice(payload.reasoning_llm, _LLM_VALUES, "reasoning model")
    if payload.summary_format is not None:
        settings_row.summary_format = _require_choice(payload.summary_format, _FORMAT_VALUES, "summary format")
    if payload.smart_diarization is not None:
        settings_row.smart_diarization = payload.smart_diarization

    if payload.glossary_terms is not None:
        terms: list[str] = []
        for raw in payload.glossary_terms:
            term = str(raw).strip()[:64]
            if term and term not in terms:
                terms.append(term)
        if len(terms) > MAX_GLOSSARY_TERMS:
            raise HTTPException(status_code=422, detail=f"At most {MAX_GLOSSARY_TERMS} glossary terms are supported.")
        settings_row.glossary_terms_json = json.dumps(terms)

    if payload.notify_on_ready is not None:
        settings_row.notify_on_ready = payload.notify_on_ready
    if payload.weekly_digest is not None:
        settings_row.weekly_digest = payload.weekly_digest

    if payload.integrations is not None:
        merged = _parse_integrations(settings_row)
        for key, value in payload.integrations.items():
            if key not in _INTEGRATION_IDS:
                raise HTTPException(status_code=422, detail=f"Unknown integration: {key}")
            merged[key] = bool(value)
        settings_row.integrations_json = json.dumps(merged)

    db.add(settings_row)
    db.commit()
    db.refresh(settings_row)
    return settings_row


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="This account has no password set. Use the reset flow instead.")
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Choose a password you have not used before.")

    user.password_hash = hash_password(new_password)
    db.add(user)

    settings_row = get_or_create_settings(db=db, user=user)
    settings_row.password_changed_at = datetime.now(timezone.utc)
    db.add(settings_row)
    db.commit()


def delete_account(db: Session, user: User) -> None:
    """Hard-delete the account and everything owned by it."""
    from app.models.job_collaborator import JobCollaborator
    from app.models.job_clip import JobClip
    from app.models.project import Project

    owned_jobs = select(Job.id).where(Job.owner_id == user.id)
    db.execute(delete(JobCollaborator).where(JobCollaborator.user_id == user.id))
    db.execute(delete(JobCollaborator).where(JobCollaborator.job_id.in_(owned_jobs)))
    db.execute(delete(JobClip).where(JobClip.job_id.in_(owned_jobs)))
    db.execute(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    db.execute(delete(ChatMessage).where(ChatMessage.job_id.in_(owned_jobs)))
    db.execute(delete(Job).where(Job.owner_id == user.id))
    db.execute(delete(Project).where(Project.owner_id == user.id))
    db.execute(delete(SupportMessage).where(SupportMessage.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(Subscription).where(Subscription.user_id == user.id))
    db.delete(user)
    db.commit()
