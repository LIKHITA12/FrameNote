from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models.user import User
from app.services.auth import AuthTokenError, access_token_revoked, decode_access_token_claims, get_or_create_user

bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    x_user_email: str | None = Header(default=None),
    x_user_name: str | None = Header(default=None),
) -> User:
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            user_id, issued_at = decode_access_token_claims(token)
        except AuthTokenError as exc:
            raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
        user = db.get(User, user_id)
        if not user or (settings.environment == "production" and user.email == "demo@framenote.local"):
            raise HTTPException(status_code=401, detail="User not found")
        if access_token_revoked(user, issued_at):
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return user

    if settings.environment != "production" and settings.legacy_header_auth_enabled:
        # Lightweight auth bootstrap: every request carries user identity headers.
        email = (x_user_email or "demo@framenote.local").strip()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail="Invalid X-User-Email header")
        return get_or_create_user(db=db, email=email, full_name=x_user_name)

    raise HTTPException(status_code=401, detail="Authentication required")


def get_current_user_bearer_only(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    # Pipeline endpoints require a real JWT, no X-User-Email fallback. Using HTTPBearer (instead of
    # reading the raw header) registers a proper OpenAPI security scheme so Swagger shows an
    # "Authorize" button for this section.
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        user_id, issued_at = decode_access_token_claims(credentials.credentials)
    except AuthTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    user = db.get(User, user_id)
    if not user or (settings.environment == "production" and user.email == "demo@framenote.local"):
        raise HTTPException(status_code=401, detail="User not found")
    if access_token_revoked(user, issued_at):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user
