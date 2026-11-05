import os
from pathlib import Path
import tempfile
import re
from uuid import uuid4

from fastapi import HTTPException, Request

from app.core.config import settings
from app.services.media_access import sign_upload_token

try:
    import boto3
except ImportError:  # pragma: no cover - dependency installed in runtime.
    boto3 = None


def _can_use_r2() -> bool:
    return bool(
        settings.r2_endpoint
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
        and boto3 is not None
    )


def build_object_key(file_name: str, user_id: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(file_name).name.strip())[:120] or "upload.bin"
    return f"uploads/{user_id}/{uuid4()}-{safe_name}"


def create_upload_presign(object_key: str, content_type: str, fallback_base_url: str, user_id: str) -> tuple[str, str, dict[str, str], dict[str, str], int]:
    expires = 900
    headers = {"Content-Type": content_type}

    if _can_use_r2():
        signed = _r2_client().generate_presigned_post(
            Bucket=settings.r2_bucket,
            Key=object_key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, settings.max_upload_bytes]],
            ExpiresIn=expires,
        )
        return signed["url"], "POST", {}, signed["fields"], expires

    # Local fallback for immediate development without cloud storage credentials.
    token = sign_upload_token(user_id, object_key)
    upload_url = f"{fallback_base_url.rstrip('/')}{settings.api_v1_prefix}/uploads/mock/{object_key}?upload_token={token}"
    return upload_url, "PUT", headers, {}, expires


async def save_mock_upload(object_key: str, request: Request) -> Path:
    if not object_key.startswith("uploads/"):
        raise HTTPException(status_code=400, detail="Invalid object key")

    root = Path(settings.local_upload_dir).resolve()
    destination = (root / object_key).resolve()
    if root not in destination.parents:
        raise HTTPException(status_code=400, detail="Invalid object key")
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with destination.open("xb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="Upload is too large")
                handle.write(chunk)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="Upload link has already been used") from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return destination


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def _local_upload_path(object_key: str) -> Path:
    if not object_key.startswith("uploads/"):
        raise HTTPException(status_code=400, detail="Invalid object key")

    root = Path(settings.local_upload_dir)
    local_path = (root / object_key).resolve()
    if root.resolve() not in local_path.parents and local_path != root.resolve():
        raise HTTPException(status_code=400, detail="Invalid object key")
    return local_path


def presigned_upload_download_url(object_key: str, expires_seconds: int = 600) -> str | None:
    """A short-lived R2 GET link for streaming an upload, or None when it is served from local disk.

    R2 answers Range requests itself, so the API never proxies or buffers the video.
    """
    if _local_upload_path(object_key).exists() or not _can_use_r2():
        return None
    return _r2_client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.r2_bucket, "Key": object_key}, ExpiresIn=expires_seconds
    )


def resolve_uploaded_object_path(object_key: str) -> Path:
    """Local path of an upload for the worker pipeline, downloading it from R2 when needed."""
    local_path = _local_upload_path(object_key)
    if local_path.exists():
        return local_path

    if _can_use_r2():
        target_dir = Path(tempfile.gettempdir()) / "framenote-r2-cache"
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / object_key.replace("/", "_")
        if target_path.exists():
            return target_path
        # Download under a unique name and rename, so concurrent jobs never read a half-written file.
        partial_path = target_dir / f"{target_path.name}.{uuid4().hex}.part"
        try:
            _r2_client().download_file(settings.r2_bucket, object_key, str(partial_path))
            os.replace(partial_path, target_path)
        finally:
            partial_path.unlink(missing_ok=True)
        return target_path

    raise HTTPException(status_code=404, detail="Uploaded media not found")


def build_processed_asset_path(asset_key: str) -> Path:
    if not asset_key.startswith("frames/"):
        raise HTTPException(status_code=400, detail="Invalid asset key")

    root = Path(settings.local_processed_dir)
    path = root / asset_key
    resolved = path.resolve()
    if root.resolve() not in resolved.parents and resolved != root.resolve():
        raise HTTPException(status_code=400, detail="Invalid asset path")
    return resolved


def resolve_processed_asset_path(asset_key: str) -> Path:
    path = build_processed_asset_path(asset_key)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    return path
