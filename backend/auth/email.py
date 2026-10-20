from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from auth.config import (
    APP_PUBLIC_URL,
    AUTH_DEV_CODES,
    IS_PRODUCTION,
    SMTP_ENABLED,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
    VERIFICATION_CODE_TTL_MINUTES,
    RESET_TOKEN_TTL_MINUTES,
)
from auth.email_templates import render_password_reset_email, render_signin_code_email, render_verification_email

logger = logging.getLogger("guardian.auth.email")


def _send_smtp(to: str, subject: str, plain: str, html: str) -> bool:
    if not SMTP_ENABLED:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        logger.info("[Guardian Auth] Email sent to %s — %s", to, subject)
        return True
    except Exception as exc:
        logger.error("[Guardian Auth] SMTP send failed for %s: %s", to, exc)
        return False


def send_verification_email(to: str, code: str) -> bool:
    verify_url = f"{APP_PUBLIC_URL}/verify-email"
    subject = "Your Guardian AI verification code"
    plain, html = render_verification_email(
        code=code, verify_url=verify_url, ttl_minutes=VERIFICATION_CODE_TTL_MINUTES
    )
    if _send_smtp(to, subject, plain, html):
        return True
    logger.warning("[Guardian Auth] Verification email not sent to %s — code: %s", to, code)
    if AUTH_DEV_CODES or not IS_PRODUCTION:
        print(f"[Guardian Auth] Verification code for {to}: {code}")
    return False


def send_password_reset_email(to: str, token: str) -> str:
    reset_path = f"/reset-password?token={token}"
    reset_url = f"{APP_PUBLIC_URL}{reset_path}"
    subject = "Reset your Guardian AI password"
    plain, html = render_password_reset_email(reset_url=reset_url, ttl_minutes=RESET_TOKEN_TTL_MINUTES)
    if _send_smtp(to, subject, plain, html):
        return reset_path
    logger.warning("[Guardian Auth] Password reset email not sent to %s", to)
    if AUTH_DEV_CODES or not IS_PRODUCTION:
        print(f"[Guardian Auth] Password reset for {to}: {reset_url}")
    return reset_path


def send_signin_code_email(to: str, code: str, *, purpose: str, ttl_minutes: int) -> bool:
    subject = "Your Guardian AI sign-in code" if purpose == "login" else "Confirm two-step sign-in for Guardian AI"
    plain, html = render_signin_code_email(code=code, ttl_minutes=ttl_minutes, purpose=purpose)
    if _send_smtp(to, subject, plain, html):
        return True
    logger.warning("[Guardian Auth] Sign-in code email not sent to %s", to)
    if AUTH_DEV_CODES or not IS_PRODUCTION:
        print(f"[Guardian Auth] Sign-in code ({purpose}) for {to}: {code}")
    return False
