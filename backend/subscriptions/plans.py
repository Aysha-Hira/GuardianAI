from __future__ import annotations

VAT_RATE = 0.05
ANNUAL_DISCOUNT = 0.15

PLANS: dict[str, dict] = {
    "free": {"name": "Free", "price_aed": 0, "camera_limit": 1, "recording": False},
    "professional": {"name": "Professional", "price_aed": 699, "camera_limit": 20, "recording": True},
    "enterprise": {"name": "Enterprise", "price_aed": 1499, "camera_limit": None, "recording": True},
}
PAID_PLANS = ("professional", "enterprise")


def plan_price(plan_id: str, period: str) -> float:
    monthly = float(PLANS[plan_id]["price_aed"])
    if period == "year":
        return float(round(monthly * 12 * (1 - ANNUAL_DISCOUNT)))
    return monthly


def camera_limit_label(limit: int | None) -> str:
    if limit is None:
        return "Unlimited cameras"
    return "1 camera" if limit == 1 else f"Up to {limit} cameras"
