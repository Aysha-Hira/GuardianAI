from __future__ import annotations

import time
from dataclasses import dataclass, field

from fastapi import HTTPException, Request

_store: dict[tuple[str, str], RateLimitWindow] = {}


@dataclass
class RateLimitWindow:
    count: int = 0
    window_start: float = field(default_factory=time.monotonic)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def check_rate_limit(request: Request, *, bucket: str, max_requests: int, window_seconds: int) -> None:
    ip = _client_ip(request)
    key = (ip, bucket)
    now = time.monotonic()
    entry = _store.get(key)

    if entry is None or now - entry.window_start >= window_seconds:
        _store[key] = RateLimitWindow(count=1, window_start=now)
        return

    entry.count += 1
    if entry.count > max_requests:
        retry_after = int(window_seconds - (now - entry.window_start))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {max(retry_after, 1)}s.",
        )


def rate_limit_dependency(bucket: str, max_requests: int, window_seconds: int):
    def _dependency(request: Request) -> None:
        check_rate_limit(request, bucket=bucket, max_requests=max_requests, window_seconds=window_seconds)

    return _dependency
