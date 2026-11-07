import os
from typing import Literal

import certifi
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# macOS python.org installs ship without a populated root CA bundle; point OpenSSL/requests at certifi's bundle
# so outbound HTTPS calls (e.g. Gemini, OpenAI, Stripe) don't fail with CERTIFICATE_VERIFY_FAILED.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url", mode="before")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    environment: Literal["development", "test", "production"] = "development"

    app_name: str = "FrameNote API"
    api_v1_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000"
    redis_url: str = "redis://redis:6379/0"
    database_url: str = "postgresql+psycopg://postgres:postgres@postgres:5432/framenote"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 1800
    openai_api_key: str | None = None
    openai_summary_model: str = "gpt-4o-mini"
    openai_video_chat_model: str = "gpt-4o-mini"
    openai_transcription_model: str = "whisper-1"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    public_api_base_url: str = "http://localhost:8000"
    # Public video link ingestion limits and its local-test escape hatch.
    video_url_max_bytes: int = 2 * 1024 * 1024 * 1024
    video_url_timeout_seconds: int = 900
    max_upload_bytes: int = 2 * 1024 * 1024 * 1024
    allow_private_video_urls: bool = False
    # Worker limits: a job is stopped after the soft limit, killed at the hard limit, and the sweeper
    # fails jobs left "processing" or "queued" beyond these ages (e.g. after a worker crash or deploy).
    job_soft_time_limit_seconds: int = 60 * 60
    job_hard_time_limit_seconds: int = 65 * 60
    stale_queued_job_seconds: int = 6 * 60 * 60
    stale_job_sweep_interval_seconds: int = 10 * 60
    # Stopgap providers in app/services/temp_*.py (local Whisper, UHG Azure gateway).
    # Unset means on in development only; production refuses to start with them enabled.
    enable_temp_providers: bool | None = None
    video_chat_context_chars: int = 30000
    video_chat_max_output_tokens: int = 500
    video_chat_monthly_token_budget: int = 2_000_000
    r2_endpoint: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket: str | None = None
    local_upload_dir: str = "/data/framenote/uploads"
    local_processed_dir: str = "/data/framenote/processed"
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Keep the legacy price id as a fallback for existing local environments.
    stripe_price_id_pro: str | None = None
    stripe_price_id_pro_monthly: str | None = None
    stripe_price_id_pro_annual: str | None = None
    stripe_success_url: str = "http://localhost:3000/upgrade?billing=success"
    stripe_cancel_url: str = "http://localhost:3000/upgrade?billing=cancel"
    jwt_secret_key: str = "dev-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 30
    jwt_reset_token_expire_minutes: int = 30
    jwt_sso_exchange_token_expire_minutes: int = 2
    # Dev-only fallback so old clients without a token can still authenticate via X-User-Email; disable in production.
    legacy_header_auth_enabled: bool = True

    # Where the browser lands after a provider redirects back to our /auth/{provider}/callback.
    frontend_base_url: str = "http://localhost:3000"

    google_client_id: str | None = None
    google_client_secret: str | None = None

    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    # "common" accepts both personal Microsoft accounts and work/school (Azure AD) accounts.
    microsoft_tenant: str = "common"
    # Comma-separated Entra tenant IDs whose users' emails are trusted without the xms_edov claim.
    microsoft_trusted_tenant_ids: str = ""

    facebook_client_id: str | None = None
    facebook_client_secret: str | None = None

    @property
    def microsoft_trusted_tenant_id_set(self) -> set[str]:
        return {tenant.strip().lower() for tenant in self.microsoft_trusted_tenant_ids.split(",") if tenant.strip()}

    @property
    def temp_providers_enabled(self) -> bool:
        if self.enable_temp_providers is None:
            return self.environment == "development"
        return self.enable_temp_providers

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.environment != "production":
            return self
        if self.enable_temp_providers:
            raise ValueError("Production requires ENABLE_TEMP_PROVIDERS to be unset or false")
        if not (self.openai_api_key or self.gemini_api_key):
            raise ValueError("Production requires OPENAI_API_KEY or GEMINI_API_KEY")
        if self.job_hard_time_limit_seconds <= self.job_soft_time_limit_seconds:
            raise ValueError("JOB_HARD_TIME_LIMIT_SECONDS must be greater than JOB_SOFT_TIME_LIMIT_SECONDS")
        if len(self.jwt_secret_key) < 32 or len(set(self.jwt_secret_key)) < 10 or self.jwt_secret_key == "dev-insecure-secret-change-me":
            raise ValueError("Production requires a randomly generated JWT_SECRET_KEY of at least 32 characters")
        if self.legacy_header_auth_enabled:
            raise ValueError("Production requires LEGACY_HEADER_AUTH_ENABLED=false")
        if self.stripe_secret_key and not self.stripe_webhook_secret:
            raise ValueError("Production requires STRIPE_WEBHOOK_SECRET whenever STRIPE_SECRET_KEY is set")
        if not all((self.r2_endpoint, self.r2_access_key_id, self.r2_secret_access_key, self.r2_bucket)):
            raise ValueError("Production requires private R2 storage configuration")
        try:
            database = make_url(self.database_url)
        except Exception as exc:
            raise ValueError("Production requires a valid PostgreSQL DATABASE_URL") from exc
        if database.drivername != "postgresql+psycopg" or not database.username or not database.password or not database.host:
            raise ValueError("Production requires a PostgreSQL DATABASE_URL with a username, password, and host")
        if (
            self.database_url == "postgresql+psycopg://postgres:postgres@postgres:5432/framenote"
            or database.password == "postgres"
            or database.host.lower() in {"localhost", "127.0.0.1", "::1", "postgres"}
        ):
            raise ValueError("Production cannot use the development PostgreSQL connection")
        if database.query.get("sslmode") not in {"require", "verify-ca", "verify-full"}:
            raise ValueError("Production DATABASE_URL must enable TLS with sslmode=require, verify-ca, or verify-full")
        if self.db_pool_size < 1 or self.db_max_overflow < 0 or self.db_pool_recycle_seconds < 1:
            raise ValueError("Production database pool settings must be positive")
        return self


settings = Settings()
