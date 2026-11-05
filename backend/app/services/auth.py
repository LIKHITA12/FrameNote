from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.subscription import Subscription
from app.models.user import User


class AuthTokenError(Exception):
    """Raised when an access/reset token is missing, malformed, expired, or the wrong type."""


def get_or_create_user(db: Session, email: str, full_name: str | None = None) -> User:
    normalized = email.strip().lower()
    existing = db.scalar(select(User).where(User.email == normalized))
    if existing:
        return existing

    user = User(email=normalized, full_name=full_name)
    db.add(user)
    db.commit()
    db.refresh(user)

    subscription = Subscription(user_id=user.id, tier="free", status="active")
    db.add(subscription)
    db.commit()
    return user


def sign_in_with_verified_email(db: Session, email: str, full_name: str | None = None) -> User:
    """Find or create the account for an email address an identity provider has verified.

    An existing account whose address was never verified may have been pre-registered by someone
    who doesn't own the inbox, so its password is removed and its sessions are revoked before the
    verified owner takes it over.
    """
    normalized = email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized))
    if not user:
        user = User(email=normalized, full_name=full_name, email_verified=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        db.add(Subscription(user_id=user.id, tier="free", status="active"))
        db.commit()
        return user

    if not user.email_verified:
        if user.password_hash:
            user.password_hash = None
            user.sessions_revoked_at = datetime.now(timezone.utc)
        user.email_verified = True
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def access_token_revoked(user: User, issued_at: int) -> bool:
    revoked_at = user.sessions_revoked_at
    if revoked_at is None:
        return False
    if revoked_at.tzinfo is None:
        # SQLite drops tzinfo; values are always written in UTC.
        revoked_at = revoked_at.replace(tzinfo=timezone.utc)
    # JWT iat has whole-second precision, so compare at that precision.
    return issued_at < int(revoked_at.timestamp())


def get_user_subscription(db: Session, user_id: str) -> Subscription:
    subscription = db.scalar(select(Subscription).where(Subscription.user_id == user_id))
    if subscription:
        return subscription

    subscription = Subscription(user_id=user_id, tier="free", status="active")
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _create_token(user_id: str, token_type: str, expires_minutes: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": now,
        "exp": now + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token_payload(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise AuthTokenError("Invalid or expired token") from exc
    if payload.get("type") != expected_type or "sub" not in payload:
        raise AuthTokenError("Invalid token")
    return payload


def _decode_token(token: str, expected_type: str) -> str:
    return _decode_token_payload(token, expected_type)["sub"]


def create_access_token(user_id: str) -> str:
    return _create_token(user_id, "access", settings.jwt_access_token_expire_minutes)


def decode_access_token(token: str) -> str:
    return _decode_token(token, "access")


def decode_access_token_claims(token: str) -> tuple[str, int]:
    """Returns (user_id, issued_at) so callers can reject tokens issued before a session revocation."""
    payload = _decode_token_payload(token, "access")
    return payload["sub"], int(payload.get("iat", 0))


def create_reset_token(user_id: str) -> str:
    return _create_token(user_id, "reset", settings.jwt_reset_token_expire_minutes)


def decode_reset_token(token: str) -> str:
    return _decode_token(token, "reset")


def create_sso_exchange_token(user_id: str) -> str:
    """Short-lived, one-shot-in-spirit token carried in the SSO redirect URL back to the
    frontend, which immediately exchanges it for a real access token. Keeps the long-lived
    access token out of the URL (browser history, referrer headers, server logs)."""
    return _create_token(user_id, "sso_exchange", settings.jwt_sso_exchange_token_expire_minutes)


def decode_sso_exchange_token(token: str) -> str:
    return _decode_token(token, "sso_exchange")


def signup_user(db: Session, email: str, password: str, full_name: str | None) -> User:
    normalized = email.strip().lower()
    if "@" not in normalized:
        raise ValueError("Enter a valid email address.")
    existing = db.scalar(select(User).where(User.email == normalized))
    if existing:
        raise ValueError("An account with this email already exists.")

    user = User(email=normalized, full_name=full_name, password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)

    subscription = Subscription(user_id=user.id, tier="free", status="active")
    db.add(subscription)
    db.commit()
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    normalized = email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized))
    if not user or not user.password_hash:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def request_password_reset(db: Session, email: str) -> str | None:
    normalized = email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized))
    if not user:
        return None
    return create_reset_token(user.id)


def confirm_password_reset(db: Session, token: str, new_password: str) -> None:
    user_id = decode_reset_token(token)
    user = db.get(User, user_id)
    if not user:
        raise AuthTokenError("Invalid or expired token")
    user.password_hash = hash_password(new_password)
    db.add(user)
    db.commit()
