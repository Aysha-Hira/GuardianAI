from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from alerts.models import EventType
from zones.restricted_zone import SOURCE_VIDEO, SOURCE_WEBCAM


RISK_LEVELS = ("none", "low", "medium", "high", "critical")
EVENT_TYPES = (EventType.RESTRICTED_ENTRY, EventType.LOITERING, EventType.WATCHLIST_MATCH)
SOURCE_TYPES = (SOURCE_WEBCAM, SOURCE_VIDEO)

FEATURE_COLUMNS = [
    "event_type",
    "zone_duration_seconds",
    "watchlist_match",
    "watchlist_risk_level",
    "face_match_distance",
    "people_count",
    "hour_of_day",
    "detection_confidence",
    "track_duration_seconds",
    "source_type",
    "restricted_entry",
    "loitering_detected",
]


@dataclass(frozen=True)
class SeverityContext:

    event_type: str
    timestamp: float
    source_type: str
    people_count: int = 0
    zone_duration_seconds: float = 0.0
    watchlist_match: bool = False
    watchlist_risk_level: str = "none"
    face_match_distance: float = 0.0
    detection_confidence: float = 0.0
    track_duration_seconds: float = 0.0

    @classmethod
    def from_security_event(
        cls,
        event,
        *,
        source_type: str,
        people_count: int = 0,
        track_summary: dict[str, Any] | None = None,
        wall_now: float | None = None,
    ) -> SeverityContext:
        event_type = (
            EventType.LOITERING
            if getattr(event, "event_type", "") == "loitering"
            else EventType.RESTRICTED_ENTRY
        )
        ts = float(wall_now if wall_now is not None else getattr(event, "timestamp", 0.0))
        zone_duration = float(getattr(event, "duration_seconds", 0.0) or 0.0)
        if event_type == EventType.RESTRICTED_ENTRY:
            zone_duration = 0.0
        summary = track_summary or {}
        return cls(
            event_type=event_type,
            timestamp=ts,
            source_type=source_type if source_type in SOURCE_TYPES else SOURCE_WEBCAM,
            people_count=max(0, int(people_count)),
            zone_duration_seconds=max(0.0, zone_duration),
            watchlist_match=False,
            watchlist_risk_level="none",
            face_match_distance=0.0,
            detection_confidence=float(summary.get("confidence") or 0.0),
            track_duration_seconds=float(summary.get("visible_duration") or 0.0),
        )

    @classmethod
    def from_watchlist_match(
        cls,
        *,
        timestamp: float,
        source_type: str,
        people_count: int,
        risk_level: str,
        face_match_distance: float,
        track_summary: dict[str, Any] | None = None,
    ) -> SeverityContext:
        summary = track_summary or {}
        return cls(
            event_type=EventType.WATCHLIST_MATCH,
            timestamp=timestamp,
            source_type=source_type if source_type in SOURCE_TYPES else SOURCE_WEBCAM,
            people_count=max(0, int(people_count)),
            zone_duration_seconds=0.0,
            watchlist_match=True,
            watchlist_risk_level=(risk_level or "medium").lower(),
            face_match_distance=max(0.0, float(face_match_distance)),
            detection_confidence=float(summary.get("confidence") or 0.0),
            track_duration_seconds=float(summary.get("visible_duration") or 0.0),
        )

    @classmethod
    def from_behavior_anomaly(
        cls,
        *,
        timestamp: float,
        source_type: str,
        people_count: int,
        anomaly_score: float,
        anomaly_threshold: float,
    ) -> SeverityContext:
        return cls(
            event_type=EventType.BEHAVIOR_ANOMALY,
            timestamp=timestamp,
            source_type=source_type if source_type in SOURCE_TYPES else SOURCE_WEBCAM,
            people_count=max(0, int(people_count)),
            zone_duration_seconds=max(0.0, float(anomaly_score) - float(anomaly_threshold)),
        )

    def to_feature_row(self) -> dict[str, Any]:
        hour = datetime.fromtimestamp(self.timestamp).hour
        restricted = 1 if self.event_type == EventType.RESTRICTED_ENTRY else 0
        loitering = 1 if self.event_type == EventType.LOITERING else 0
        risk = self.watchlist_risk_level if self.watchlist_risk_level in RISK_LEVELS else "none"
        return {
            "event_type": self.event_type,
            "zone_duration_seconds": round(self.zone_duration_seconds, 2),
            "watchlist_match": 1 if self.watchlist_match else 0,
            "watchlist_risk_level": risk,
            "face_match_distance": round(self.face_match_distance, 4),
            "people_count": int(self.people_count),
            "hour_of_day": int(hour),
            "detection_confidence": round(self.detection_confidence, 3),
            "track_duration_seconds": round(self.track_duration_seconds, 2),
            "source_type": self.source_type,
            "restricted_entry": restricted,
            "loitering_detected": loitering,
        }
