from __future__ import annotations

import re
from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from auth.config import AUTH_REQUIRED
from auth.database import SessionLocal
from auth.security import decode_access_token
from auth.cookies import csrf_ok, token_from_request
from auth.service import get_user_by_id, token_version_matches

PUBLIC_PREFIXES = (
    "/auth/",
    "/static/",
    "/legacy/",
)

PUBLIC_EXACT = {
    "/",
}

PUBLIC_PATTERNS = (
)


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    if any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES):
        return True
    return any(pattern.match(path) for pattern in PUBLIC_PATTERNS)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not AUTH_REQUIRED:
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if _is_public_path(path):
            return await call_next(request)

        token, from_cookie = token_from_request(request)
        if not token:
            return JSONResponse({"detail": "Not authenticated."}, status_code=401)
        if from_cookie and not csrf_ok(request):
            return JSONResponse({"detail": "CSRF check failed."}, status_code=403)

        try:
            payload = decode_access_token(token)
        except ValueError:
            return JSONResponse({"detail": "Invalid or expired token."}, status_code=401)

        if not payload.get("email_verified", False):
            return JSONResponse({"detail": "Email not verified."}, status_code=403)

        user_id = payload.get("sub")
        if not user_id:
            return JSONResponse({"detail": "Invalid token."}, status_code=401)

        db = SessionLocal()
        try:
            user = get_user_by_id(db, str(user_id))
            if not token_version_matches(user, payload):
                return JSONResponse(
                    {"detail": "Session expired. Please sign in again."},
                    status_code=401,
                )
        finally:
            db.close()

        request.state.user_id = user_id
        request.state.user_email = payload.get("email")
        return await call_next(request)
