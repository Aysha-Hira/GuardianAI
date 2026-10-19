from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from auth.cookies import csrf_ok, token_from_request
from auth.database import db_session
from auth.models import User
from auth.security import decode_access_token
from auth.service import get_user_by_id, token_version_matches


def get_current_user(request: Request, db: Session = Depends(db_session)) -> User:
    token, from_cookie = token_from_request(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    if from_cookie and not csrf_ok(request):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF check failed.")
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    user = get_user_by_id(db, str(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    if not token_version_matches(user, payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )
    if not user.email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified.")
    return user


def get_optional_user(request: Request, db: Session = Depends(db_session)) -> User | None:
    try:
        return get_current_user(request, db)
    except HTTPException:
        return None
