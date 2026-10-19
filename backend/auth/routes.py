from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse

from auth.cookies import clear_auth_cookies, set_auth_cookies, token_from_request
from auth.security import decode_access_token

from auth.config import APP_PUBLIC_URL, IS_PRODUCTION, RESET_TOKEN_TTL_MINUTES, VERIFICATION_CODE_TTL_MINUTES
from auth.email_templates import render_password_reset_email, render_verification_email
from sqlalchemy.orm import Session

from auth.config import (
    RATE_FORGOT_MAX,
    RATE_FORGOT_WINDOW,
    RATE_LOGIN_MAX,
    RATE_LOGIN_WINDOW,
    RATE_REGISTER_MAX,
    RATE_REGISTER_WINDOW,
    RATE_RESEND_MAX,
    RATE_RESEND_WINDOW,
    RATE_VERIFY_MAX,
    RATE_VERIFY_WINDOW,
)
from auth.database import db_session
from auth.dependencies import get_current_user
from auth.models import User
from auth.rate_limit import rate_limit_dependency
from auth.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    MessageResponse,
    MfaCodeRequest,
    MfaDisableRequest,
    MfaLoginRequest,
    MfaTicketRequest,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResendVerificationRequest,
    UpdateProfileRequest,
    UserPublic,
    VerifyEmailRequest,
)
from auth.service import (
    _bump_token_version,
    change_password,
    confirm_mfa_enable,
    disable_mfa,
    finish_mfa_login,
    get_user_by_id,
    resend_mfa_login,
    start_mfa_enable,
    start_mfa_login,
    forgot_password,
    login_user,
    register_user,
    resend_verification,
    reset_password,
    update_profile,
    user_public,
    verify_email,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_limit_register = Depends(
    rate_limit_dependency("register", RATE_REGISTER_MAX, RATE_REGISTER_WINDOW)
)
_limit_login = Depends(rate_limit_dependency("login", RATE_LOGIN_MAX, RATE_LOGIN_WINDOW))
_limit_verify = Depends(rate_limit_dependency("verify", RATE_VERIFY_MAX, RATE_VERIFY_WINDOW))
_limit_resend = Depends(rate_limit_dependency("resend", RATE_RESEND_MAX, RATE_RESEND_WINDOW))
_limit_forgot = Depends(rate_limit_dependency("forgot", RATE_FORGOT_MAX, RATE_FORGOT_WINDOW))
_limit_reset = Depends(rate_limit_dependency("reset", RATE_FORGOT_MAX, RATE_FORGOT_WINDOW))


@router.post("/register", dependencies=[_limit_register])
async def register(payload: RegisterRequest, db: Session = Depends(db_session)):
    email, name, dev_code = register_user(
        db, name=payload.name, email=str(payload.email), password=payload.password
    )
    return JSONResponse(
        RegisterResponse(
            message="Check your email for a verification code. Your account is created after you verify.",
            email=email,
            name=name,
            verification_code=dev_code,
        ).model_dump()
    )


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}{'•' * max(2, len(local) - 1)}@{domain}"


@router.post("/login", dependencies=[_limit_login])
async def login(payload: LoginRequest, db: Session = Depends(db_session)):
    user, token = login_user(db, email=str(payload.email), password=payload.password)
    if user.mfa_enabled:
        ticket, dev_code = start_mfa_login(db, user)
        body: dict = {"ok": True, "mfa_required": True, "ticket": ticket, "sent_to": _mask_email(user.email)}
        if dev_code:
            body["dev_code"] = dev_code
        return JSONResponse(body)
    return _session_response(user, token, remember=payload.remember)


@router.post("/login/mfa", dependencies=[_limit_verify])
async def login_mfa(payload: MfaLoginRequest, db: Session = Depends(db_session)):
    user, token = finish_mfa_login(db, ticket=payload.ticket, code=payload.code)
    return _session_response(user, token, remember=payload.remember)


@router.post("/login/mfa/resend", dependencies=[_limit_resend])
async def login_mfa_resend(payload: MfaTicketRequest, db: Session = Depends(db_session)):
    dev_code = resend_mfa_login(db, ticket=payload.ticket)
    body: dict = {"ok": True, "message": "A new code is on its way."}
    if dev_code:
        body["dev_code"] = dev_code
    return JSONResponse(body)


@router.post("/mfa/setup", dependencies=[_limit_resend])
async def mfa_setup(user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    dev_code = start_mfa_enable(db, user)
    body: dict = {"ok": True, "sent_to": _mask_email(user.email)}
    if dev_code:
        body["dev_code"] = dev_code
    return JSONResponse(body)


@router.post("/mfa/enable", dependencies=[_limit_verify])
async def mfa_enable(payload: MfaCodeRequest, user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    updated = confirm_mfa_enable(db, user, code=payload.code)
    return JSONResponse({"ok": True, "user": user_public(updated).model_dump()})


@router.post("/mfa/disable", dependencies=[_limit_verify])
async def mfa_disable(payload: MfaDisableRequest, user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    updated = disable_mfa(db, user, password=payload.password)
    return JSONResponse({"ok": True, "user": user_public(updated).model_dump()})


@router.post("/verify-email", dependencies=[_limit_verify])
async def verify(payload: VerifyEmailRequest, db: Session = Depends(db_session)):
    user, token = verify_email(db, email=str(payload.email), code=payload.code)
    return _session_response(user, token, remember=True)


def _session_response(user: User, token: str, *, remember: bool) -> JSONResponse:
    response = JSONResponse({"ok": True, "user": user_public(user).model_dump()})
    set_auth_cookies(response, token, remember=remember)
    return response


@router.post("/logout")
async def logout(request: Request, db: Session = Depends(db_session)):
    token, _ = token_from_request(request)
    if token:
        try:
            payload = decode_access_token(token)
            user = get_user_by_id(db, str(payload.get("sub", "")))
            if user is not None:
                _bump_token_version(user)
                db.commit()
        except ValueError:
            pass
    response = JSONResponse({"ok": True})
    clear_auth_cookies(response)
    return response


@router.post("/resend-verification", dependencies=[_limit_resend])
async def resend(payload: ResendVerificationRequest, db: Session = Depends(db_session)):
    dev_code = resend_verification(db, email=str(payload.email))
    body: dict = {"ok": True, "message": "Verification code sent."}
    if dev_code:
        body["verification_code"] = dev_code
    return JSONResponse(body)


@router.post("/forgot-password", dependencies=[_limit_forgot])
async def forgot(payload: ForgotPasswordRequest, db: Session = Depends(db_session)):
    reset_path = forgot_password(db, email=str(payload.email))
    return JSONResponse(
        ForgotPasswordResponse(
            message="If an account exists for this email, reset instructions have been sent.",
            reset_path=reset_path,
        ).model_dump()
    )


@router.post("/reset-password", dependencies=[_limit_reset])
async def reset(payload: ResetPasswordRequest, db: Session = Depends(db_session)):
    reset_password(db, token=payload.token, password=payload.password)
    return JSONResponse(MessageResponse(message="Password updated. You can sign in now.").model_dump())


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return JSONResponse(UserPublic.model_validate(user).model_dump())


@router.patch("/me")
async def patch_me(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(db_session),
):
    updated = update_profile(db, user, name=payload.name)
    return JSONResponse(UserPublic.model_validate(updated).model_dump())


@router.post("/change-password")
async def change_pw(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(db_session),
):
    change_password(db, user, current=payload.current_password, new_password=payload.new_password)
    return JSONResponse(MessageResponse(message="Password changed successfully.").model_dump())


if not IS_PRODUCTION:

    @router.get("/email-preview/verification", response_class=HTMLResponse)
    async def preview_verification_email():
        _, html = render_verification_email(
            code="482916",
            verify_url=f"{APP_PUBLIC_URL}/verify-email",
            ttl_minutes=VERIFICATION_CODE_TTL_MINUTES,
        )
        return HTMLResponse(html)

    @router.get("/email-preview/reset", response_class=HTMLResponse)
    async def preview_reset_email():
        sample_url = f"{APP_PUBLIC_URL}/reset-password?token=sample-token-preview-only"
        _, html = render_password_reset_email(reset_url=sample_url, ttl_minutes=RESET_TOKEN_TTL_MINUTES)
        return HTMLResponse(html)

    @router.get("/email-preview", response_class=HTMLResponse)
    async def preview_email_index():
        return HTMLResponse(
            f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Guardian AI Email Previews</title>
<style>
  body {{ font-family: system-ui, sans-serif; background:#080a0f; color:#e8ecf4; padding:40px; }}
  a {{ color:#34d399; font-size:18px; display:block; margin:12px 0; }}
  h1 {{ font-weight:700; }}
  p {{ color:#7a8499; }}
</style></head><body>
  <h1>Guardian AI — Email previews</h1>
  <p>Dev-only templates. Open in browser to see how emails render.</p>
  <a href="/auth/email-preview/verification">Verification code email</a>
  <a href="/auth/email-preview/reset">Password reset email</a>
</body></html>"""
        )
