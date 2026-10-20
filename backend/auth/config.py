from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = PROJECT_ROOT / "data"
DATABASE_PATH = Path(os.getenv("GUARDIAN_DATABASE_PATH", str(DATA_DIR / "guardian.db")))
DATABASE_URL = os.getenv("GUARDIAN_DATABASE_URL", "").strip() or f"sqlite:///{DATABASE_PATH}"
IS_SQLITE = DATABASE_URL.startswith("sqlite")

GUARDIAN_ENV = os.getenv("GUARDIAN_ENV", "development").strip().lower()
IS_PRODUCTION = GUARDIAN_ENV in {"production", "prod"}

INSECURE_JWT_DEFAULT = "change-me-in-production-guardian-dev"
JWT_SECRET = os.getenv("GUARDIAN_JWT_SECRET", "").strip() or INSECURE_JWT_DEFAULT
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("GUARDIAN_JWT_EXPIRE_MINUTES", "1440"))

VERIFICATION_CODE_TTL_MINUTES = 15
RESET_TOKEN_TTL_MINUTES = 30
RESEND_COOLDOWN_SECONDS = int(os.getenv("GUARDIAN_RESEND_COOLDOWN_SECONDS", "60"))

MAX_FAILED_LOGIN_ATTEMPTS = int(os.getenv("GUARDIAN_MAX_FAILED_LOGIN", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.getenv("GUARDIAN_LOGIN_LOCKOUT_MINUTES", "15"))
MAX_FAILED_VERIFY_ATTEMPTS = int(os.getenv("GUARDIAN_MAX_FAILED_VERIFY", "5"))
VERIFY_LOCKOUT_MINUTES = int(os.getenv("GUARDIAN_VERIFY_LOCKOUT_MINUTES", "15"))

RATE_LOGIN_MAX = int(os.getenv("GUARDIAN_RATE_LOGIN_MAX", "10"))
RATE_LOGIN_WINDOW = int(os.getenv("GUARDIAN_RATE_LOGIN_WINDOW", "900"))
RATE_REGISTER_MAX = int(os.getenv("GUARDIAN_RATE_REGISTER_MAX", "5"))
RATE_REGISTER_WINDOW = int(os.getenv("GUARDIAN_RATE_REGISTER_WINDOW", "3600"))
RATE_VERIFY_MAX = int(os.getenv("GUARDIAN_RATE_VERIFY_MAX", "10"))
RATE_VERIFY_WINDOW = int(os.getenv("GUARDIAN_RATE_VERIFY_WINDOW", "900"))
RATE_FORGOT_MAX = int(os.getenv("GUARDIAN_RATE_FORGOT_MAX", "5"))
RATE_FORGOT_WINDOW = int(os.getenv("GUARDIAN_RATE_FORGOT_WINDOW", "3600"))
RATE_RESEND_MAX = int(os.getenv("GUARDIAN_RATE_RESEND_MAX", "5"))
RATE_RESEND_WINDOW = int(os.getenv("GUARDIAN_RATE_RESEND_WINDOW", "900"))

SMTP_HOST = os.getenv("GUARDIAN_SMTP_HOST", "")
SMTP_PORT = int(os.getenv("GUARDIAN_SMTP_PORT", "587"))
SMTP_USER = os.getenv("GUARDIAN_SMTP_USER", "")
SMTP_PASSWORD = os.getenv("GUARDIAN_SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("GUARDIAN_SMTP_FROM", "").strip() or "Guardian AI <noreply@guardian-ai.local>"
APP_PUBLIC_URL = os.getenv("GUARDIAN_APP_URL", "http://localhost:4200")

SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

_default_dev_codes = "0" if SMTP_ENABLED else "1"
AUTH_DEV_CODES = os.getenv("GUARDIAN_AUTH_DEV_CODES", _default_dev_codes) == "1"

AUTH_REQUIRED = os.getenv("GUARDIAN_AUTH_REQUIRED", "1") == "1"

SEED_TEST_USER = os.getenv("GUARDIAN_SEED_TEST_USER", "0" if IS_PRODUCTION else "1") == "1"
SEED_TEST_EMAIL = os.getenv("GUARDIAN_SEED_TEST_EMAIL", "operator@guardian.ai")
SEED_TEST_PASSWORD = os.getenv("GUARDIAN_SEED_TEST_PASSWORD", "Guardian1!")
SEED_TEST_NAME = os.getenv("GUARDIAN_SEED_TEST_NAME", "Test Operator")


def validate_security_config() -> None:
    if not IS_PRODUCTION:
        return
    if not JWT_SECRET or JWT_SECRET == INSECURE_JWT_DEFAULT or len(JWT_SECRET) < 32:
        raise RuntimeError(
            "Production requires GUARDIAN_JWT_SECRET — set a random string of at least 32 characters."
        )
