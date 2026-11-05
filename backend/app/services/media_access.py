"""Short-lived browser links for private job media."""

from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

import jwt
from fastapi import HTTPException

from app.core.config import settings
from app.models.job import Job

MEDIA_LINK_MINUTES = 120  # Long enough to seek during a full-length Pro recording.


def asset_belongs_to_job(job: Job, asset_key: str) -> bool:
    if asset_key.startswith("uploads/"):
        return asset_key in {job.upload_object_key, job.transcript_object_key}
    return asset_key.startswith(f"frames/{job.id}/") and ".." not in asset_key.split("/")


def sign_asset_url(job: Job, asset_key: str, viewer_id: str) -> str:
    if not asset_belongs_to_job(job, asset_key):
        raise ValueError("Asset does not belong to this job")
    token = jwt.encode(
        {
            "type": "asset",
            "sub": viewer_id,
            "job_id": job.id,
            "asset_key": asset_key,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=MEDIA_LINK_MINUTES),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    base = f"{settings.public_api_base_url.rstrip('/')}{settings.api_v1_prefix}/assets/{quote(asset_key, safe='/')}"
    return f"{base}?access_token={quote(token, safe='')}"


def sign_existing_asset_url(job: Job, url: str | None, viewer_id: str) -> str | None:
    if not url:
        return url
    path = urlsplit(url).path
    marker = f"{settings.api_v1_prefix}/assets/"
    if marker not in path:
        return url
    asset_key = path.split(marker, 1)[1]
    return sign_asset_url(job, asset_key, viewer_id)


def decode_asset_token(token: str, asset_key: str) -> tuple[str, str]:
    try:
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired asset link") from exc
    if claims.get("type") != "asset" or claims.get("asset_key") != asset_key:
        raise HTTPException(status_code=401, detail="Invalid asset link")
    user_id, job_id = claims.get("sub"), claims.get("job_id")
    if not isinstance(user_id, str) or not isinstance(job_id, str):
        raise HTTPException(status_code=401, detail="Invalid asset link")
    return user_id, job_id


def sign_upload_token(user_id: str, object_key: str) -> str:
    return jwt.encode(
        {
            "type": "upload", "sub": user_id, "object_key": object_key,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def verify_upload_token(token: str, object_key: str) -> str:
    try:
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired upload link") from exc
    user_id = claims.get("sub")
    if claims.get("type") != "upload" or claims.get("object_key") != object_key or not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Invalid upload link")
    if not object_key.startswith(f"uploads/{user_id}/"):
        raise HTTPException(status_code=401, detail="Invalid upload link")
    return user_id
