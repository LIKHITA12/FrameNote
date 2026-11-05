from datetime import datetime

from pydantic import BaseModel, Field


class SelectOption(BaseModel):
    """A single choice rendered in a Settings dropdown / radio group."""

    value: str
    label: str
    description: str | None = None
    badge: str | None = None


class IntegrationState(BaseModel):
    id: str
    name: str
    icon: str
    description: str
    badge: str | None = None
    # "toggle" integrations flip on/off in place; "link" ones need an external OAuth handshake.
    kind: str = "toggle"
    enabled: bool = False


class UserSettingsResponse(BaseModel):
    # Profile & identity
    user_id: str
    email: str
    full_name: str | None = None
    role_title: str | None = None
    timezone: str = "UTC"
    avatar_url: str | None = None
    email_verified: bool = True
    password_changed_at: datetime | None = None

    # AI synthesis & pipeline
    transcription_language: str = "auto"
    transcription_backend: str = "whisper-v3"
    reasoning_llm: str = "sonnet"
    summary_format: str = "executive_brief"
    smart_diarization: bool = True
    glossary_terms: list[str] = Field(default_factory=list)

    # Notifications & delivery
    notify_on_ready: bool = True
    weekly_digest: bool = False

    # Connected integrations
    integrations: list[IntegrationState] = Field(default_factory=list)

    # Option catalogs so the UI renders the same choices the API validates against.
    language_options: list[SelectOption] = Field(default_factory=list)
    timezone_options: list[SelectOption] = Field(default_factory=list)
    transcription_backend_options: list[SelectOption] = Field(default_factory=list)
    reasoning_llm_options: list[SelectOption] = Field(default_factory=list)
    summary_format_options: list[SelectOption] = Field(default_factory=list)


class UserSettingsUpdateRequest(BaseModel):
    """Partial update: only the supplied fields are written."""

    full_name: str | None = Field(default=None, max_length=255)
    role_title: str | None = Field(default=None, max_length=120)
    timezone: str | None = None
    avatar_url: str | None = None

    transcription_language: str | None = None
    transcription_backend: str | None = None
    reasoning_llm: str | None = None
    summary_format: str | None = None
    smart_diarization: bool | None = None
    glossary_terms: list[str] | None = None

    notify_on_ready: bool | None = None
    weekly_digest: bool | None = None

    integrations: dict[str, bool] | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    # Typed confirmation guards against accidental destructive clicks.
    confirmation: str = Field(min_length=1)


class UsageMeter(BaseModel):
    used: float = 0
    limit: float | None = None
    unit: str = ""
    percent: float = 0


class UsageSummaryResponse(BaseModel):
    tier: str
    plan_label: str
    plan_price_monthly: int | None = None
    subscription_status: str = "active"
    transcription_hours: UsageMeter
    storage_gb: UsageMeter
    videos_processed: int = 0
    insights_extracted: int = 0
    # Processing wall-time divided by media runtime, e.g. 0.18x means ~5.5x faster than realtime.
    avg_turn_ratio: float = 0
    resets_in_days: int = 0
    renews_on: datetime | None = None
