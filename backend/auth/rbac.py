from __future__ import annotations

import re

from fastapi import Depends, HTTPException, status

from auth.dependencies import get_current_user
from auth.models import User

ROLE_ADMIN = "admin"
ROLE_OPERATOR = "operator"
ROLES = (ROLE_ADMIN, ROLE_OPERATOR)

ADMIN_ONLY_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (method, re.compile(pattern))
    for method, pattern in (
        ("POST", r"^/settings/loitering$"),
        ("POST", r"^/zone$"),
        ("POST", r"^/zone/editing$"),
        ("DELETE", r"^/zone$"),
        ("DELETE", r"^/alerts$"),
        ("POST", r"^/upload/video$"),
        ("DELETE", r"^/source/camera2$"),
        ("DELETE", r"^/cameras/\d+$"),
        ("POST", r"^/cameras/\d+/settings$"),
        ("POST", r"^/watchlist/enroll$"),
        ("PUT", r"^/watchlist/[^/]+/image$"),
        ("DELETE", r"^/watchlist/[^/]+$"),
        ("POST", r"^/subscription/(checkout|cancel|resume)$"),
        ("POST", r"^/experiments/multicam/(preset/[^/]+|upload/[^/]+|run)$"),
    )
)

ROLE_PERMISSIONS = {
    ROLE_ADMIN: [
        "View cameras, incidents, map, analytics, and reports",
        "Update alert status, follow people, and record",
        "Manage cameras and video sources",
        "Draw restricted zones and set the loitering time",
        "Manage the face recognition watchlist",
        "Run multi-camera re-identification",
        "Manage the subscription plan",
        "Invite people and manage roles",
    ],
    ROLE_OPERATOR: [
        "View cameras, incidents, map, analytics, and reports",
        "Update alert status, follow people, and record",
    ],
}


def normalize_role(role: str | None) -> str:
    return role if role in ROLES else ROLE_OPERATOR


def is_admin(user: User | None) -> bool:
    return user is not None and normalize_role(getattr(user, "role", None)) == ROLE_ADMIN


def requires_admin(method: str, path: str) -> bool:
    method = method.upper()
    return any(method == rule_method and pattern.match(path) for rule_method, pattern in ADMIN_ONLY_RULES)


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required.")
    return user
