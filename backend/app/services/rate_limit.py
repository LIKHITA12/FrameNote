"""Small fixed-window limits for sensitive API actions."""

import hashlib
import threading
import time
from functools import lru_cache

import redis
from fastapi import HTTPException, Request

from app.core.config import settings

_local_counts: dict[str, tuple[int, float]] = {}
_lock = threading.Lock()


@lru_cache(maxsize=1)
def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)


def request_ip(request: Request) -> str:
    """The client's IP for rate limiting.

    Behind a reverse proxy (Railway), request.client is the proxy, so every user would share one bucket.
    Each trusted proxy appends the address it received the request from to X-Forwarded-For, so the
    entry TRUSTED_PROXY_HOPS from the right is the real client. Entries further left are whatever the
    client sent and are never trusted.
    """
    hops = settings.trusted_proxy_hops
    if hops > 0:
        forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"


def check_rate_limit(scope: str, identity: str, limit: int, window_seconds: int) -> None:
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    window = int(time.time()) // window_seconds
    key = f"framenote:rate:{scope}:{digest}:{window}"
    if settings.environment == "production":
        try:
            client = _redis_client()
            count = client.incr(key)
            if count == 1:
                client.expire(key, window_seconds + 1)
        except redis.RedisError as exc:
            raise HTTPException(status_code=503, detail="Rate limiting is unavailable") from exc
    else:
        with _lock:
            count, expires = _local_counts.get(key, (0, 0.0))
            if expires < time.time():
                count = 0
            count += 1
            _local_counts[key] = (count, (window + 1) * window_seconds)
            if len(_local_counts) > 10000:
                now = time.time()
                for old_key, (_, old_expiry) in list(_local_counts.items()):
                    if old_expiry < now:
                        del _local_counts[old_key]
    if count > limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.", headers={"Retry-After": str(window_seconds)})
