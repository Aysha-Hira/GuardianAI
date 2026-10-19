"""Subscriptions table — one row per purchase; the newest active row is the user's plan."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from auth.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SubscriptionRecord(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # receipt number
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    plan_id: Mapped[str] = mapped_column(String(20), nullable=False)
    plan_name: Mapped[str] = mapped_column(String(40), nullable=False)
    camera_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None = unlimited
    price_aed: Mapped[float] = mapped_column(Float, nullable=False)
    vat_aed: Mapped[float] = mapped_column(Float, nullable=False)
    total_aed: Mapped[float] = mapped_column(Float, nullable=False)
    billing_period: Mapped[str] = mapped_column(String(10), default="month", nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_label: Mapped[str] = mapped_column(String(60), nullable=False)
    card_brand: Mapped[str | None] = mapped_column(String(20), nullable=True)
    card_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)  # never the full number
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)  # active|replaced|cancelled
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    next_billing_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
