"""Social sign-in (Google, Microsoft, Facebook) via standard OAuth2 authorization-code flows.

Each provider follows the same shape: build an authorize URL carrying a signed "state" token,
then on callback exchange the authorization code for the user's email/name.

The state is bound to the browser that started the login: a random secret lives in an HttpOnly
cookie and the state carries its hash, so a callback URL replayed in another browser is rejected
(login CSRF). For Google and Microsoft the same secret doubles as the PKCE code verifier.

Only provider-verified email addresses are accepted, because accounts are matched by email.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings

SsoProvider = Literal["google", "microsoft", "facebook"]

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

FACEBOOK_AUTHORIZE_URL = "https://www.facebook.com/v21.0/dialog/oauth"
FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token"
FACEBOOK_ME_URL = "https://graph.facebook.com/v21.0/me"

# Personal Microsoft accounts (outlook.com, live.com, ...) all sign in through this tenant.
MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad"

_STATE_TOKEN_TYPE = "oauth_state"
_STATE_EXPIRE_MINUTES = 10
SSO_BINDING_COOKIE = "framenote_sso_binding"
SSO_BINDING_COOKIE_MAX_AGE = _STATE_EXPIRE_MINUTES * 60


class OAuthError(Exception):
    """Raised for any step of a provider login that we can't recover from (bad/expired state,
    the provider rejecting the code, a missing email, etc). The message is safe to show the user."""


@dataclass
class OAuthUserInfo:
    email: str
    full_name: str | None = None


def provider_configured(provider: SsoProvider) -> bool:
    if provider == "google":
        return bool(settings.google_client_id and settings.google_client_secret)
    if provider == "microsoft":
        return bool(settings.microsoft_client_id and settings.microsoft_client_secret)
    if provider == "facebook":
        return bool(settings.facebook_client_id and settings.facebook_client_secret)
    return False


def _require_configured(provider: SsoProvider) -> None:
    if not provider_configured(provider):
        raise OAuthError(f"Sign in with {provider.capitalize()} is not configured on this server yet.")


def new_browser_binding() -> str:
    """Random secret stored in the login cookie; 64 URL-safe chars, so it is also a valid PKCE verifier."""
    return secrets.token_urlsafe(48)


def _sha256_b64url(value: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(value.encode("ascii")).digest()).rstrip(b"=").decode("ascii")


def create_state(provider: SsoProvider, binding: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": _STATE_TOKEN_TYPE,
        "provider": provider,
        "binding": _sha256_b64url(binding),
        "iat": now,
        "exp": now + timedelta(minutes=_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _verify_state(provider: SsoProvider, state: str, binding: str | None) -> None:
    try:
        payload = jwt.decode(state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise OAuthError("That sign-in link expired or is invalid. Please try again.") from exc
    if payload.get("type") != _STATE_TOKEN_TYPE or payload.get("provider") != provider:
        raise OAuthError("That sign-in link is invalid. Please try again.")
    expected = payload.get("binding")
    if not binding or not isinstance(expected, str) or not secrets.compare_digest(expected, _sha256_b64url(binding)):
        raise OAuthError("Sign-in must finish in the same browser it started in. Please try again.")


def _redirect_uri(provider: SsoProvider) -> str:
    return f"{settings.public_api_base_url}{settings.api_v1_prefix}/auth/{provider}/callback"


def build_authorize_url(provider: SsoProvider, binding: str) -> str:
    _require_configured(provider)
    state = create_state(provider, binding)
    code_challenge = _sha256_b64url(binding)

    if provider == "google":
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    if provider == "microsoft":
        params = {
            "client_id": settings.microsoft_client_id,
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "response_mode": "query",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        url = MICROSOFT_AUTHORIZE_URL.format(tenant=settings.microsoft_tenant)
        return f"{url}?{urlencode(params)}"

    # facebook
    params = {
        "client_id": settings.facebook_client_id,
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "scope": "email,public_profile",
        "state": state,
    }
    return f"{FACEBOOK_AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(provider: SsoProvider, code: str, state: str, binding: str | None) -> OAuthUserInfo:
    """Redeem the provider's authorization code for the signed-in user's verified email (and
    name, when the provider hands one over). `binding` is the value of the login cookie."""
    _require_configured(provider)
    _verify_state(provider, state, binding)
    assert binding is not None

    if provider == "google":
        return _exchange_google(code, binding)
    if provider == "microsoft":
        return _exchange_microsoft(code, binding)
    return _exchange_facebook(code)


def _exchange_google(code: str, code_verifier: str) -> OAuthUserInfo:
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": _redirect_uri("google"),
        "grant_type": "authorization_code",
        "code_verifier": code_verifier,
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            token_response = client.post(GOOGLE_TOKEN_URL, data=data)
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            userinfo_response = client.get(
                GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_response.raise_for_status()
            userinfo = userinfo_response.json()
    except (httpx.HTTPError, KeyError) as exc:
        raise OAuthError("Google did not complete sign-in. Please try again.") from exc

    email = userinfo.get("email")
    if not email:
        raise OAuthError("Your Google account has no email we can use to sign in.")
    if userinfo.get("email_verified") is not True:
        raise OAuthError("Your Google account's email address isn't verified yet. Verify it with Google and try again.")
    return OAuthUserInfo(email=email, full_name=userinfo.get("name"))


def _exchange_microsoft(code: str, code_verifier: str) -> OAuthUserInfo:
    data = {
        "code": code,
        "client_id": settings.microsoft_client_id,
        "client_secret": settings.microsoft_client_secret,
        "redirect_uri": _redirect_uri("microsoft"),
        "grant_type": "authorization_code",
        "scope": "openid email profile",
        "code_verifier": code_verifier,
    }
    token_url = MICROSOFT_TOKEN_URL.format(tenant=settings.microsoft_tenant)
    try:
        with httpx.Client(timeout=15.0) as client:
            token_response = client.post(token_url, data=data)
            token_response.raise_for_status()
            id_token = token_response.json()["id_token"]
        # Received directly from Microsoft's token endpoint over TLS, so the signature check is
        # not needed here (OpenID Connect Core 3.1.3.7).
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except (httpx.HTTPError, KeyError, jwt.PyJWTError) as exc:
        raise OAuthError("Microsoft did not complete sign-in. Please try again.") from exc

    email = microsoft_verified_email(claims)
    return OAuthUserInfo(email=email, full_name=claims.get("name"))


def microsoft_verified_email(claims: dict) -> str:
    """Work/school tenant admins can set a user's email to any address, so an address is only
    trusted when Microsoft vouches for it: personal accounts, the `xms_edov` (email domain owner
    verified) optional claim, or a tenant the operator explicitly trusts."""
    email = claims.get("email")
    if not email:
        raise OAuthError("Your Microsoft account has no email we can use to sign in.")
    tenant_id = str(claims.get("tid") or "").lower()
    domain_verified = claims.get("xms_edov") in (True, 1, "1", "true", "True")
    if tenant_id == MICROSOFT_CONSUMER_TENANT_ID or domain_verified or tenant_id in settings.microsoft_trusted_tenant_id_set:
        return email
    raise OAuthError("We couldn't confirm your Microsoft account's email address. Please sign in another way.")


def _exchange_facebook(code: str) -> OAuthUserInfo:
    params = {
        "code": code,
        "client_id": settings.facebook_client_id,
        "client_secret": settings.facebook_client_secret,
        "redirect_uri": _redirect_uri("facebook"),
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            token_response = client.get(FACEBOOK_TOKEN_URL, params=params)
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            me_response = client.get(
                FACEBOOK_ME_URL, params={"fields": "id,name,email", "access_token": access_token}
            )
            me_response.raise_for_status()
            profile = me_response.json()
    except (httpx.HTTPError, KeyError) as exc:
        raise OAuthError("Facebook did not complete sign-in. Please try again.") from exc

    # Facebook only returns an email address the user has confirmed with Facebook.
    email = profile.get("email")
    if not email:
        # Facebook omits email when the account has none on file, or the user declined the permission.
        raise OAuthError("Your Facebook account has no email we can use to sign in. Please allow the email permission and try again.")
    return OAuthUserInfo(email=email, full_name=profile.get("name"))
