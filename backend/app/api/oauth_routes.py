from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes import _token_response
from app.core.config import settings
from app.models.user import User
from app.schemas.auth import SsoExchangeRequest, TokenResponse
from app.services.auth import AuthTokenError, create_sso_exchange_token, decode_sso_exchange_token, sign_in_with_verified_email
from app.services.oauth import (
    SSO_BINDING_COOKIE,
    SSO_BINDING_COOKIE_MAX_AGE,
    OAuthError,
    SsoProvider,
    build_authorize_url,
    exchange_code,
    new_browser_binding,
    provider_configured,
)
from app.services.rate_limit import check_rate_limit, request_ip

router = APIRouter(tags=["Social sign-in"])


_BINDING_COOKIE_PATH = f"{settings.api_v1_prefix}/auth"


def _login_redirect(**params: str) -> RedirectResponse:
    response = RedirectResponse(f"{settings.frontend_base_url}/login?{urlencode(params)}")
    # The binding is single-use: clear it whichever way the callback ends.
    response.delete_cookie(SSO_BINDING_COOKIE, path=_BINDING_COOKIE_PATH)
    return response


def _complete_sso_login(db: Session, request: Request, provider: SsoProvider, code: str | None, state: str | None, error: str | None) -> RedirectResponse:
    check_rate_limit(f"sso-{provider}-callback-ip", request_ip(request), 30, 900)

    if error:
        return _login_redirect(sso_error=f"Sign-in with {provider.capitalize()} was cancelled.")
    if not code or not state:
        return _login_redirect(sso_error=f"Sign-in with {provider.capitalize()} did not complete. Please try again.")

    try:
        info = exchange_code(provider, code, state, request.cookies.get(SSO_BINDING_COOKIE))
    except OAuthError as exc:
        return _login_redirect(sso_error=str(exc))

    user = sign_in_with_verified_email(db=db, email=info.email, full_name=info.full_name)
    exchange_token = create_sso_exchange_token(user.id)
    return _login_redirect(sso_code=exchange_token)


@router.get("/auth/sso/providers")
def list_sso_providers() -> dict[str, bool]:
    """Lets the login/signup pages only render buttons for providers with credentials set."""
    return {provider: provider_configured(provider) for provider in ("google", "microsoft", "facebook")}


@router.get("/auth/{provider}/login")
def start_sso_login(provider: Literal["google", "microsoft", "facebook"], request: Request) -> RedirectResponse:
    check_rate_limit(f"sso-{provider}-start-ip", request_ip(request), 30, 900)
    binding = new_browser_binding()
    try:
        response = RedirectResponse(build_authorize_url(provider, binding))
    except OAuthError as exc:
        return _login_redirect(sso_error=str(exc))
    # SameSite=Lax still sends the cookie on the provider's top-level redirect back to the callback.
    response.set_cookie(
        SSO_BINDING_COOKIE,
        binding,
        max_age=SSO_BINDING_COOKIE_MAX_AGE,
        path=_BINDING_COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=settings.public_api_base_url.startswith("https://"),
    )
    return response


@router.get("/auth/google/callback")
def google_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    return _complete_sso_login(db=db, request=request, provider="google", code=code, state=state, error=error)


@router.get("/auth/microsoft/callback")
def microsoft_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    return _complete_sso_login(db=db, request=request, provider="microsoft", code=code, state=state, error=error)


@router.get("/auth/facebook/callback")
def facebook_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    return _complete_sso_login(db=db, request=request, provider="facebook", code=code, state=state, error=error)


@router.post("/auth/sso/exchange", response_model=TokenResponse)
def exchange_sso_code(payload: SsoExchangeRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    check_rate_limit("sso-exchange-ip", request_ip(request), 30, 900)
    try:
        user_id = decode_sso_exchange_token(payload.code)
    except AuthTokenError as exc:
        raise HTTPException(status_code=400, detail="That sign-in link expired or is invalid. Please try again.") from exc

    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=400, detail="That sign-in link expired or is invalid. Please try again.")
    return _token_response(user=user, db=db)
