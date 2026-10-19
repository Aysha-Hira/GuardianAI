from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    name: str
    email_verified: bool
    mfa_enabled: bool = False


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class RegisterResponse(BaseModel):
    ok: bool = True
    message: str
    email: EmailStr
    name: str
    verification_code: str | None = None


class MessageResponse(BaseModel):
    ok: bool = True
    message: str


class ForgotPasswordResponse(BaseModel):
    ok: bool = True
    message: str
    reset_path: str | None = None


class MfaLoginRequest(BaseModel):
    ticket: str = Field(min_length=16, max_length=128)
    code: str = Field(pattern=r"^\s*\d{6}\s*$")
    remember: bool = True


class MfaTicketRequest(BaseModel):
    ticket: str = Field(min_length=16, max_length=128)


class MfaCodeRequest(BaseModel):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")


class MfaDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)
