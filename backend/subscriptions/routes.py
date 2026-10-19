from __future__ import annotations

import calendar
import random
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth.database import db_session
from auth.dependencies import get_current_user
from auth.models import User
from subscriptions.db import SubscriptionRecord
from subscriptions.plans import PAID_PLANS, PLANS, VAT_RATE, camera_limit_label, plan_price

router = APIRouter(prefix="/subscription", tags=["subscription"])

PAYMENT_LABELS = {
    "card": "Credit / debit card",
    "apple_pay": "Apple Pay",
    "google_pay": "Google Pay",
    "paypal": "PayPal",
}
BRAND_LABELS = {"visa": "Visa", "mastercard": "Mastercard"}


class CheckoutRequest(BaseModel):
    plan_id: Literal["professional", "enterprise"]
    billing_period: Literal["month", "year"] = "month"
    payment_method: Literal["card", "apple_pay", "google_pay", "paypal"]
    card_brand: Literal["visa", "mastercard"] | None = None
    card_last4: str | None = Field(default=None, pattern=r"^\d{4}$")


def _add_months(d: datetime, months: int) -> datetime:
    total = d.month - 1 + months
    year, month = d.year + total // 12, total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


def _receipt_number(now: datetime) -> str:
    return f"GRD-AED-{now:%Y%m%d}-{random.randint(10000, 99999)}"


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


def serialize(rec: SubscriptionRecord) -> dict:
    return {
        "receiptNumber": rec.id,
        "planId": rec.plan_id,
        "planName": rec.plan_name,
        "cameraLimit": rec.camera_limit,
        "recording": bool(PLANS.get(rec.plan_id, PLANS["free"])["recording"]),
        "cameraLimitLabel": camera_limit_label(rec.camera_limit),
        "priceAed": rec.price_aed,
        "vatAed": rec.vat_aed,
        "amountAed": rec.total_aed,
        "billingPeriod": rec.billing_period,
        "paymentMethod": rec.payment_method,
        "paymentMethodLabel": rec.payment_label,
        "cardBrand": rec.card_brand,
        "cardLast4": rec.card_last4,
        "status": rec.status,
        "cancelAtPeriodEnd": rec.cancel_at_period_end,
        "paidAt": _iso(rec.paid_at),
        "nextBillingDate": _iso(rec.next_billing_at),
        "endedAt": _iso(rec.ended_at),
    }


def active_subscription(db: Session, user_id: str) -> SubscriptionRecord | None:
    rec = db.scalars(
        select(SubscriptionRecord)
        .where(SubscriptionRecord.user_id == user_id, SubscriptionRecord.status == "active")
        .order_by(SubscriptionRecord.paid_at.desc())
    ).first()
    if rec is None or rec.plan_id not in PAID_PLANS:
        return None
    nb = rec.next_billing_at if rec.next_billing_at.tzinfo else rec.next_billing_at.replace(tzinfo=timezone.utc)
    if rec.cancel_at_period_end and nb <= datetime.now(timezone.utc):
        rec.status = "cancelled"
        rec.ended_at = nb
        db.flush()
        return None
    return rec


def free_plan() -> dict:
    plan = PLANS["free"]
    return {
        "receiptNumber": None,
        "planId": "free",
        "planName": plan["name"],
        "cameraLimit": plan["camera_limit"],
        "cameraLimitLabel": camera_limit_label(plan["camera_limit"]),
        "recording": plan["recording"],
        "priceAed": 0,
        "vatAed": 0,
        "amountAed": 0,
        "billingPeriod": "month",
        "paymentMethod": None,
        "paymentMethodLabel": None,
        "cardBrand": None,
        "cardLast4": None,
        "status": "active",
        "cancelAtPeriodEnd": False,
        "paidAt": None,
        "nextBillingDate": None,
        "endedAt": None,
    }


def user_plan(db: Session, user_id: str) -> dict:
    rec = active_subscription(db, user_id)
    plan = PLANS[rec.plan_id] if rec else PLANS["free"]
    return {"plan_id": rec.plan_id if rec else "free", **plan}


@router.get("")
def get_subscription(user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    current = active_subscription(db, user.id)
    history = db.scalars(
        select(SubscriptionRecord)
        .where(SubscriptionRecord.user_id == user.id)
        .order_by(SubscriptionRecord.paid_at.desc())
        .limit(12)
    ).all()
    return {"current": serialize(current) if current else free_plan(), "history": [serialize(r) for r in history]}


@router.post("/checkout")
def checkout(payload: CheckoutRequest, user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    plan = PLANS[payload.plan_id]
    if payload.payment_method == "card" and (not payload.card_brand or not payload.card_last4):
        raise HTTPException(status_code=422, detail="Card payments need the card brand and last 4 digits.")

    now = datetime.now(timezone.utc)
    previous = active_subscription(db, user.id)
    if previous is not None:
        previous.status = "replaced"
        previous.ended_at = now

    price = plan_price(payload.plan_id, payload.billing_period)
    vat = float(round(price * VAT_RATE))
    if payload.payment_method == "card":
        label = f"{BRAND_LABELS[payload.card_brand]} ·••• {payload.card_last4}"
    else:
        label = PAYMENT_LABELS[payload.payment_method]

    rec = SubscriptionRecord(
        id=_receipt_number(now),
        user_id=user.id,
        plan_id=payload.plan_id,
        plan_name=plan["name"],
        camera_limit=plan["camera_limit"],
        price_aed=price,
        vat_aed=vat,
        total_aed=round(price + vat, 2),
        billing_period=payload.billing_period,
        payment_method=payload.payment_method,
        payment_label=label,
        card_brand=payload.card_brand if payload.payment_method == "card" else None,
        card_last4=payload.card_last4 if payload.payment_method == "card" else None,
        status="active",
        paid_at=now,
        next_billing_at=_add_months(now, 12 if payload.billing_period == "year" else 1),
    )
    db.add(rec)
    db.flush()
    return {"receipt": serialize(rec)}


@router.post("/cancel")
def cancel(user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    current = active_subscription(db, user.id)
    if current is None:
        raise HTTPException(status_code=404, detail="No active subscription.")
    current.cancel_at_period_end = True
    db.flush()
    return {"current": serialize(current)}


@router.post("/resume")
def resume(user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    current = active_subscription(db, user.id)
    if current is None:
        raise HTTPException(status_code=404, detail="No active subscription.")
    current.cancel_at_period_end = False
    db.flush()
    return {"current": serialize(current)}
