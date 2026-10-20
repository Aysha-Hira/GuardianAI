from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from auth.config import (
    SEED_TEST_EMAIL,
    SEED_TEST_NAME,
    SEED_TEST_PASSWORD,
    SEED_TEST_USER,
)
from auth.models import User
from auth.security import hash_password
from auth.service import normalize_email

logger = logging.getLogger("guardian.auth.seed")


def seed_test_user(db: Session) -> None:
    if not SEED_TEST_USER:
        return

    email = normalize_email(SEED_TEST_EMAIL)
    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        return

    user = User(
        email=email,
        password_hash=hash_password(SEED_TEST_PASSWORD),
        name=SEED_TEST_NAME,
        email_verified=True,
        verification_code=None,
        verification_expires=None,
    )
    db.add(user)
    db.flush()
    logger.info("[Guardian Auth] Seeded test account: %s", email)
    print(f"[Guardian Auth] Test account ready — email: {email}  password: {SEED_TEST_PASSWORD}")
