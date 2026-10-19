from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from auth.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PendingRegistration(Base):

    __tablename__ = "pending_registrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    verification_code: Mapped[str] = mapped_column(String(6), nullable=False)
    verification_expires: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    failed_verify_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verify_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    verification_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    verification_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    login_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_verify_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verify_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_ticket_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    mfa_purpose: Mapped[str | None] = mapped_column(String(10), nullable=True)
    mfa_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mfa_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
