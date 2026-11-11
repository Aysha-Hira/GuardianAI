from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from auth.config import (
    ADMIN_EMAILS,
    SEED_TEST_EMAIL,
    SEED_TEST_NAME,
    SEED_TEST_PASSWORD,
    SEED_TEST_USER,
)
from auth.models import User
from auth.security import hash_password
from auth.service import normalize_email

logger = logging.getLogger("guardian.auth.seed")


def _seed_account(db: Session, *, email: str, name: str, role: str) -> None:
    email = normalize_email(email)
    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        return
    db.add(
        User(
            email=email,
            password_hash=hash_password(SEED_TEST_PASSWORD),
            name=name,
            email_verified=True,
            verification_code=None,
            verification_expires=None,
            role=role,
        )
    )
    db.flush()
    logger.info("[Guardian Auth] Seeded %s test account: %s", role, email)
    print(f"[Guardian Auth] {role.title()} test account ready — email: {email}  password: {SEED_TEST_PASSWORD}")


def seed_test_user(db: Session) -> None:
    if not SEED_TEST_USER:
        return
    _seed_account(db, email=SEED_TEST_EMAIL, name=SEED_TEST_NAME, role="operator")


def ensure_admin_exists(db: Session) -> None:
    if ADMIN_EMAILS:
        for user in db.query(User).filter(User.email.in_(ADMIN_EMAILS)).all():
            if user.role != "admin":
                user.role = "admin"
                print(f"[Guardian Auth] Granted administrator role to {user.email}")
        db.flush()
    if db.query(User.id).filter(User.role == "admin").first() is None:
        print("[Guardian Auth] No administrator yet — the next person to sign up becomes the administrator.")
