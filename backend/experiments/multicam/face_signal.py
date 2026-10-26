from __future__ import annotations

import os


def face_boost_enabled() -> bool:
    return os.getenv("MULTICAM_FACE_BOOST", "0").strip().lower() in {"1", "true", "yes", "on"}


def try_face_boost(global_id: int, crop_path: str | None = None) -> dict | None:
    if not face_boost_enabled():
        return None
    return {
        "enabled": True,
        "note": "Set MULTICAM_FACE_BOOST=1 and wire watchlist matcher for optional face support.",
        "global_id": global_id,
    }
