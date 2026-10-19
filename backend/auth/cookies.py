from __future__ import annotations

import secrets

from fastapi import Request, Response

from auth.config import ACCESS_TOKEN_EXPIRE_MINUTES, IS_PRODUCTION

SESSION_COOKIE = "guardian_session"
CSRF_COOKIE = "guardian_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_SAMESITE = "strict"


def set_auth_cookies(response: Response, token: str, *, remember: bool = True) -> None:
    max_age = ACCESS_TOKEN_EXPIRE_MINUTES * 60 if remember else None
    common = dict(max_age=max_age, path="/", secure=IS_PRODUCTION, samesite=_SAMESITE)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, **common)
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(32), httponly=False, **common)


def clear_auth_cookies(response: Response) -> None:
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", secure=IS_PRODUCTION, samesite=_SAMESITE)


def token_from_request(request: Request) -> tuple[str | None, bool]:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip() or None, False
    cookie = request.cookies.get(SESSION_COOKIE)
    return (cookie or None), bool(cookie)


def csrf_ok(request: Request) -> bool:
    if request.method.upper() in SAFE_METHODS:
        return True
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    return bool(cookie) and bool(header) and secrets.compare_digest(cookie, header)
