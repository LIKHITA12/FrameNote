"""TEMPORARY Azure OpenAI (OAuth client-credentials) integration.

This file is a stopgap until permanent OPENAI_API_KEY / GEMINI_API_KEY credentials
are available. It is intentionally self-contained and only consumed via a
try/except ImportError in app/services/processing.py, so deleting this file
later requires no other code changes - the pipeline will simply fall back to
the existing OpenAI/Gemini/placeholder summary path.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger("framenote.temp_azure_llm")

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
_TOKEN_RETRY_ATTEMPTS = 3
_TOKEN_RETRY_BACKOFF_SECONDS = 2.0
_TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60.0
_token_cache_lock = threading.Lock()
# Keyed by client_id so distinct credentials (e.g. LLM vs embeddings) don't clobber each other.
_token_cache: dict[str, tuple[str, float]] = {}


def load_runtime_env() -> None:
    """Load backend/.env into os.environ (pydantic Settings doesn't do this for us)."""
    from dotenv import load_dotenv

    load_dotenv(_ENV_PATH, override=False)


def is_configured() -> bool:
    load_runtime_env()
    return bool(os.getenv("CLIENT_ID") and os.getenv("CLIENT_SECRET"))


def _request_new_access_token(client_id: str, client_secret: str) -> tuple[str, float]:
    last_exc: Exception | None = None
    for attempt in range(_TOKEN_RETRY_ATTEMPTS):
        if attempt > 0:
            time.sleep(_TOKEN_RETRY_BACKOFF_SECONDS * attempt)
        try:
            response = requests.post(
                os.getenv("UHG_OAUTH_URL", "https://api.uhg.com/oauth2/token"),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "client_credentials",
                    "scope": os.getenv("UHG_OAUTH_SCOPE", "https://api.uhg.com/.default"),
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                timeout=60,
            )
            response.raise_for_status()
            payload = response.json()
            token = payload.get("access_token")
            if not token:
                raise RuntimeError("OAuth token response missing access_token")
            expires_in = payload.get("expires_in")
            expires_at = time.monotonic() + float(expires_in) if expires_in else 0.0
            return token, expires_at
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning("OAuth token request failed (attempt %d/%d): %s", attempt + 1, _TOKEN_RETRY_ATTEMPTS, exc)
    raise last_exc  # type: ignore[misc]


def get_access_token(client_id: str | None = None, client_secret: str | None = None) -> str:
    load_runtime_env()
    client_id = client_id or os.getenv("CLIENT_ID")
    client_secret = client_secret or os.getenv("CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("CLIENT_ID and CLIENT_SECRET are required for Azure OpenAI OAuth")

    with _token_cache_lock:
        now = time.monotonic()
        cached = _token_cache.get(client_id)
        if cached and now < (cached[1] - _TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS):
            return cached[0]

        token, expires_at = _request_new_access_token(client_id, client_secret)
        _token_cache[client_id] = (token, expires_at)
        return token


def invalidate_access_token(client_id: str | None = None) -> None:
    """Drop a cached token so the next call re-authenticates.

    The gateway can reject a token before its advertised expiry, which surfaces as a 401
    mid-run; callers use this to recover instead of failing the whole pipeline.
    """

    client_id = client_id or os.getenv("CLIENT_ID")
    if not client_id:
        return
    with _token_cache_lock:
        _token_cache.pop(client_id, None)


def create_azure_openai_client(
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    api_version: str | None = None,
    deployment_name: str | None = None,
) -> tuple[Any, str]:
    load_runtime_env()
    import openai

    deployment_name = (
        deployment_name
        or os.getenv("LLM_DEPLOYMENT_NAME")
        or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
        or os.getenv("AZURE_OPENAI_DEPLOYMENT")
        or os.getenv("AZURE_OPENAI_LLM_DEPLOYMENT")
        or os.getenv("AZURE_OPENAI_MODEL")
        or "gpt-4o"
    )
    api_version = (
        api_version
        or os.getenv("AZURE_OPENAI_API_VERSION")
        or os.getenv("OPENAI_API_VERSION")
        or os.getenv("AZURE_API_VERSION")
        or "2024-10-21"
    )
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "https://api.uhg.com/api/cloud/api-management/ai-gateway/1.0")
    project_id = os.getenv("PROJECT_ID")
    client = openai.AzureOpenAI(
        azure_endpoint=endpoint,
        api_version=api_version,
        azure_deployment=deployment_name,
        azure_ad_token=get_access_token(client_id=client_id, client_secret=client_secret),
        default_headers={"projectId": project_id} if project_id else None,
    )
    logger.info("AzureOpenAI client created: deployment=%s api_version=%s endpoint=%s", deployment_name, api_version, endpoint)
    return client, deployment_name


def summarize_with_temp_azure(transcript: str, system_prompt: str) -> str | None:
    """Return raw JSON content from the temp Azure deployment, or None if unusable.

    Never raises: any failure here should just make the caller fall back to the
    permanent OpenAI/Gemini path instead of failing the whole pipeline job.
    """

    return chat_json_with_temp_azure(system_prompt=system_prompt, user_content=transcript[:16000])


def chat_json_with_temp_azure(system_prompt: str, user_content: str) -> str | None:
    """Generic JSON-mode chat call against the temp Azure deployment, or None if unusable."""

    if not is_configured():
        return None

    try:
        client, deployment_name = create_azure_openai_client()
        response = client.chat.completions.create(
            model=deployment_name,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        return response.choices[0].message.content or "{}"
    except Exception:
        logger.exception("Temp Azure OpenAI chat call failed; falling back")
        return None


def chat_json_with_images(system_prompt: str, user_text: str, image_paths: list[Path]) -> str | None:
    """Vision JSON-mode call (reads on-screen text in frames), or None if unusable/unsupported."""

    if not is_configured() or not image_paths:
        return None

    import base64

    try:
        content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        for image_path in image_paths:
            encoded = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}", "detail": "high"}}
            )

        client, deployment_name = create_azure_openai_client()
        response = client.chat.completions.create(
            model=deployment_name,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
        )
        return response.choices[0].message.content or "{}"
    except Exception:
        logger.exception("Temp Azure OpenAI vision call failed; falling back")
        return None
