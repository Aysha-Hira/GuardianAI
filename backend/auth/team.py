from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from auth.config import INVITE_TTL_HOURS
from auth.database import Base
from auth.models import PendingRegistration, User

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="operator", nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    invited_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    invited_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


def has_admin(db: Session) -> bool:
    return db.query(User.id).filter(User.role == "admin").first() is not None


def signup_info(db: Session) -> dict:
    first = not has_admin(db)
    return {"first_account": first, "signup_open": first}


def check_signup_allowed(db: Session) -> None:
    if has_admin(db):
        raise HTTPException(
            status_code=403,
            detail="Sign-up is by invitation only. Ask your administrator to invite you.",
        )


def role_for_new_account(db: Session, pending: PendingRegistration) -> str:
    if not has_admin(db):
        return "admin"
    db.delete(pending)
    db.commit()
    raise HTTPException(
        status_code=403,
        detail="Sign-up is by invitation only. Ask your administrator to invite you.",
    )


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _invite_status(inv: Invitation) -> str:
    if inv.accepted_at is not None:
        return "accepted"
    expires = _as_utc(inv.expires_at)
    return "expired" if expires and expires < _utcnow() else "pending"


def invitation_payload(inv: Invitation) -> dict:
    return {
        "id": inv.id,
        "email": inv.email,
        "name": inv.name,
        "role": inv.role,
        "status": _invite_status(inv),
        "invited_by": inv.invited_by_name,
        "expires_at": _as_utc(inv.expires_at).isoformat() if inv.expires_at else None,
        "created_at": _as_utc(inv.created_at).isoformat() if inv.created_at else None,
    }


def create_invitation(db: Session, *, admin: User, email: str, name: str | None, role: str) -> tuple[Invitation, str]:
    if db.query(User.id).filter(User.email == email).first() is not None:
        raise HTTPException(status_code=400, detail="This person already has an account.")
    db.query(Invitation).filter(Invitation.email == email, Invitation.accepted_at.is_(None)).delete()
    token = secrets.token_urlsafe(32)
    inv = Invitation(
        email=email,
        name=(name or "").strip() or None,
        role=role,
        token_hash=_hash_token(token),
        invited_by_id=admin.id,
        invited_by_name=admin.name,
        expires_at=_utcnow() + timedelta(hours=INVITE_TTL_HOURS),
    )
    db.add(inv)
    db.flush()
    return inv, token


def refresh_invitation(db: Session, inv: Invitation) -> str:
    if inv.accepted_at is not None:
        raise HTTPException(status_code=400, detail="This invitation was already accepted.")
    token = secrets.token_urlsafe(32)
    inv.token_hash = _hash_token(token)
    inv.expires_at = _utcnow() + timedelta(hours=INVITE_TTL_HOURS)
    db.flush()
    return token


def find_open_invitation(db: Session, token: str) -> Invitation:
    inv = db.query(Invitation).filter(Invitation.token_hash == _hash_token(token or "")).first()
    if inv is None or inv.accepted_at is not None:
        raise HTTPException(status_code=404, detail="This invitation link is invalid or was already used.")
    if _invite_status(inv) == "expired":
        raise HTTPException(status_code=410, detail="This invitation has expired. Ask your administrator to resend it.")
    return inv


def accept_invitation(db: Session, *, token: str, name: str, password_hash: str) -> User:
    inv = find_open_invitation(db, token)
    if db.query(User.id).filter(User.email == inv.email).first() is not None:
        raise HTTPException(status_code=400, detail="An account with this email already exists. Sign in instead.")
    db.query(PendingRegistration).filter(PendingRegistration.email == inv.email).delete()
    user = User(
        email=inv.email,
        password_hash=password_hash,
        name=name.strip(),
        email_verified=True,
        role=inv.role,
    )
    db.add(user)
    inv.accepted_at = _utcnow()
    db.flush()
    return user
