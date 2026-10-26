from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WatchlistMatchEvent:
    camera_id: int
    track_id: int
    watchlist_id: str
    watchlist_name: str
    category: str
    risk_level: str
    distance: float
    threshold: float
    face_snapshot: str
    timestamp: float
