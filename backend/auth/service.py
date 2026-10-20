from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from auth.config import (
    AUTH_DEV_CODES,
    LOGIN_LOCKOUT_MINUTES,
    MAX_FAILED_LOGIN_ATTEMPTS,
    MAX_FAILED_VERIFY_ATTEMPTS,
    RESEND_COOLDOWN_SECONDS,
    RESET_TOKEN_TTL_MINUTES,
    SMTP_ENABLED,
    VERIFICATION_CODE_TTL_MINUTES,
    VERIFY_LOCKOUT_MINUTES,
)
import hashlib
import hmac

from auth.config import JWT_SECRET
from auth.email import send_password_reset_email, send_signin_code_email, send_verification_email
from auth.models import PendingRegistration, User
from auth.schemas import UserPublic
from auth.security import create_access_token, hash_password, verify_password


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def user_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        email=user.email,
        name=user.name,
        email_verified=user.email_verified,
        mfa_enabled=bool(getattr(user, "mfa_enabled", False)),
    )


def _issue_token(user: User) -> str:
    return create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        email_verified=True,
        token_version=user.token_version or 1,
    )


def _bump_token_version(user: User) -> None:
    user.token_version = (user.token_version or 1) + 1


def _locked_until_message(locked_until: datetime | None, *, action: str) -> None:
    locked = _as_utc(locked_until)
    if locked and locked > datetime.now(timezone.utc):
        wait = int((locked - datetime.now(timezone.utc)).total_seconds())
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. {action} again in {wait}s.",
        )


def _generate_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def _generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


def _get_pending(db: Session, email: str) -> PendingRegistration | None:
    return db.query(PendingRegistration).filter(PendingRegistration.email == email).first()


def register_user(db: Session, *, name: str, email: str, password: str) -> tuple[str, str, str | None]:
    normalized = normalize_email(email)
    if db.query(User).filter(User.email == normalized).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    code = _generate_code()
    expires = datetime.now(timezone.utc) + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
    pending = _get_pending(db, normalized)

    if pending is None:
        pending = PendingRegistration(
            email=normalized,
            password_hash=hash_password(password),
            name=name.strip(),
            verification_code=code,
            verification_expires=expires,
        )
        db.add(pending)
    else:
        pending.password_hash = hash_password(password)
        pending.name = name.strip()
        pending.verification_code = code
        pending.verification_expires = expires
        pending.failed_verify_attempts = 0
        pending.verify_locked_until = None
        db.add(pending)

    db.flush()
    sent = send_verification_email(normalized, code)
    return normalized, pending.name, (None if sent else code)


def login_user(db: Session, *, email: str, password: str) -> tuple[User, str]:
    normalized = normalize_email(email)
    user = db.query(User).filter(User.email == normalized).first()

    if user is not None:
        _locked_until_message(user.login_locked_until, action="Try signing in")

    if user is None:
        pending = _get_pending(db, normalized)
        if pending is not None and verify_password(password, pending.password_hash):
            raise HTTPException(status_code=403, detail="Please verify your email before signing in.")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            user.failed_login_attempts = 0
            user.login_locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        db.add(user)
        db.flush()
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user.failed_login_attempts = 0
    user.login_locked_until = None
    db.add(user)
    db.flush()
    return user, _issue_token(user)


MFA_CODE_TTL_MINUTES = 10
MFA_MAX_ATTEMPTS = 5
MFA_RESEND_SECONDS = 30


def _mfa_hash(value: str) -> str:
    return hmac.new(JWT_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


def _clear_mfa(user: User) -> None:
    user.mfa_code_hash = None
    user.mfa_ticket_hash = None
    user.mfa_purpose = None
    user.mfa_expires = None
    user.mfa_attempts = 0


def _issue_mfa_code(db: Session, user: User, purpose: str, *, ticket: str | None = None) -> str | None:
    code = _generate_code()
    now = datetime.now(timezone.utc)
    user.mfa_code_hash = _mfa_hash(f"{user.id}:{code}")
    user.mfa_ticket_hash = _mfa_hash(ticket) if ticket else None
    user.mfa_purpose = purpose
    user.mfa_expires = now + timedelta(minutes=MFA_CODE_TTL_MINUTES)
    user.mfa_attempts = 0
    user.mfa_sent_at = now
    db.add(user)
    db.flush()
    sent = send_signin_code_email(user.email, code, purpose=purpose, ttl_minutes=MFA_CODE_TTL_MINUTES)
    return None if sent else (code if AUTH_DEV_CODES else None)


def start_mfa_login(db: Session, user: User) -> tuple[str, str | None]:
    ticket = secrets.token_urlsafe(32)
    dev_code = _issue_mfa_code(db, user, "login", ticket=ticket)
    return ticket, dev_code


def _user_for_ticket(db: Session, ticket: str) -> User:
    user = db.query(User).filter(User.mfa_ticket_hash == _mfa_hash(ticket)).first()
    if user is None or user.mfa_purpose != "login":
        raise HTTPException(status_code=401, detail="This sign-in has expired. Sign in again.")
    return user


def _check_mfa_code(db: Session, user: User, code: str, purpose: str) -> None:
    if user.mfa_purpose != purpose or not user.mfa_code_hash:
        raise HTTPException(status_code=400, detail="Request a new code first.")
    expires = _as_utc(user.mfa_expires)
    if expires is None or expires < datetime.now(timezone.utc):
        _clear_mfa(user)
        db.flush()
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    if not hmac.compare_digest(user.mfa_code_hash, _mfa_hash(f"{user.id}:{code.strip()}")):
        user.mfa_attempts = (user.mfa_attempts or 0) + 1
        if user.mfa_attempts >= MFA_MAX_ATTEMPTS:
            _clear_mfa(user)
            db.flush()
            raise HTTPException(status_code=429, detail="Too many wrong codes. Start again.")
        db.flush()
        left = MFA_MAX_ATTEMPTS - user.mfa_attempts
        raise HTTPException(status_code=400, detail=f"Wrong code. {left} attempt{'s' if left != 1 else ''} left.")
    _clear_mfa(user)
    db.flush()


def finish_mfa_login(db: Session, *, ticket: str, code: str) -> tuple[User, str]:
    user = _user_for_ticket(db, ticket)
    _check_mfa_code(db, user, code, "login")
    return user, _issue_token(user)


def resend_mfa_login(db: Session, *, ticket: str) -> str | None:
    user = _user_for_ticket(db, ticket)
    _mfa_resend_cooldown(user)
    return _issue_mfa_code(db, user, "login", ticket=ticket)


def _mfa_resend_cooldown(user: User) -> None:
    sent = _as_utc(user.mfa_sent_at)
    if sent:
        elapsed = (datetime.now(timezone.utc) - sent).total_seconds()
        if elapsed < MFA_RESEND_SECONDS:
            raise HTTPException(status_code=429, detail=f"Please wait {int(MFA_RESEND_SECONDS - elapsed)}s before requesting another code.")


def start_mfa_enable(db: Session, user: User) -> str | None:
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="Two-step sign-in is already on.")
    if user.mfa_purpose == "enable":
        _mfa_resend_cooldown(user)
    return _issue_mfa_code(db, user, "enable")


def confirm_mfa_enable(db: Session, user: User, *, code: str) -> User:
    _check_mfa_code(db, user, code, "enable")
    user.mfa_enabled = True
    db.add(user)
    db.flush()
    return user


def disable_mfa(db: Session, user: User, *, password: str) -> User:
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user.mfa_enabled = False
    _clear_mfa(user)
    db.add(user)
    db.flush()
    return user


def verify_email(db: Session, *, email: str, code: str) -> tuple[User, str]:
    normalized = normalize_email(email)

    existing = db.query(User).filter(User.email == normalized).first()
    if existing is not None:
        return existing, _issue_token(existing)

    pending = _get_pending(db, normalized)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending registration found for this email.")

    _locked_until_message(pending.verify_locked_until, action="Try verifying")

    if pending.verification_code != code.strip():
        pending.failed_verify_attempts = (pending.failed_verify_attempts or 0) + 1
        if pending.failed_verify_attempts >= MAX_FAILED_VERIFY_ATTEMPTS:
            pending.failed_verify_attempts = 0
            pending.verify_locked_until = datetime.now(timezone.utc) + timedelta(minutes=VERIFY_LOCKOUT_MINUTES)
            db.add(pending)
            db.flush()
            raise HTTPException(
                status_code=429,
                detail="Too many incorrect codes. Request a new verification code.",
            )
        db.add(pending)
        db.flush()
        raise HTTPException(status_code=400, detail="Invalid verification code.")

    expires = _as_utc(pending.verification_expires)
    if expires and expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")

    user = User(
        email=pending.email,
        password_hash=pending.password_hash,
        name=pending.name,
        email_verified=True,
    )
    db.add(user)
    db.delete(pending)
    db.flush()
    return user, _issue_token(user)


def resend_verification(db: Session, *, email: str) -> str | None:
    normalized = normalize_email(email)

    if db.query(User).filter(User.email == normalized).first():
        raise HTTPException(status_code=400, detail="Email is already verified.")

    pending = _get_pending(db, normalized)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending registration found for this email.")

    last_sent = _as_utc(pending.updated_at)
    if last_sent:
        elapsed = (datetime.now(timezone.utc) - last_sent).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            wait = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {wait}s before requesting another code.",
            )

    code = _generate_code()
    pending.verification_code = code
    pending.verification_expires = datetime.now(timezone.utc) + timedelta(
        minutes=VERIFICATION_CODE_TTL_MINUTES
    )
    pending.failed_verify_attempts = 0
    pending.verify_locked_until = None
    db.add(pending)
    db.flush()
    sent = send_verification_email(normalized, code)
    return None if sent else code


def forgot_password(db: Session, *, email: str) -> str | None:
    normalized = normalize_email(email)
    user = db.query(User).filter(User.email == normalized).first()
    if user is None:
        return None

    token = _generate_reset_token()
    user.reset_token = token
    user.reset_expires = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    db.add(user)
    db.flush()
    reset_path = send_password_reset_email(normalized, token)
    return reset_path if AUTH_DEV_CODES and not SMTP_ENABLED else None


def reset_password(db: Session, *, token: str, password: str) -> None:
    user = db.query(User).filter(User.reset_token == token).first()
    reset_expires = _as_utc(user.reset_expires) if user else None
    if user is None or reset_expires is None or reset_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")

    user.password_hash = hash_password(password)
    user.reset_token = None
    user.reset_expires = None
    user.failed_login_attempts = 0
    user.login_locked_until = None
    _bump_token_version(user)
    db.add(user)


def change_password(db: Session, user: User, *, current: str, new_password: str) -> None:
    if not verify_password(current, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user.password_hash = hash_password(new_password)
    _bump_token_version(user)
    db.add(user)


def update_profile(db: Session, user: User, *, name: str) -> User:
    user.name = name.strip()
    db.add(user)
    db.flush()
    return user


def get_user_by_id(db: Session, user_id: str) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def token_version_matches(user: User | None, payload: dict) -> bool:
    if user is None:
        return False
    token_ver = int(payload.get("ver", 1))
    return (user.token_version or 1) == token_ver


def cleanup_pending_registrations(db: Session) -> int:
    now = datetime.now(timezone.utc)
    expired = db.query(PendingRegistration).all()
    removed = 0
    for pending in expired:
        expires = _as_utc(pending.verification_expires)
        if expires and expires < now:
            db.delete(pending)
            removed += 1
    return removed


def migrate_unverified_users_to_pending(db: Session) -> int:
    legacy = db.query(User).filter(User.email_verified.is_(False)).all()
    moved = 0
    for user in legacy:
        if _get_pending(db, user.email):
            db.delete(user)
            moved += 1
            continue
        code = user.verification_code or _generate_code()
        expires = _as_utc(user.verification_expires) or (
            datetime.now(timezone.utc) + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
        )
        pending = PendingRegistration(
            email=user.email,
            password_hash=user.password_hash,
            name=user.name,
            verification_code=code,
            verification_expires=expires,
            failed_verify_attempts=user.failed_verify_attempts or 0,
            verify_locked_until=user.verify_locked_until,
        )
        db.add(pending)
        db.delete(user)
        moved += 1
    return moved
