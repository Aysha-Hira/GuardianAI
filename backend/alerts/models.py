from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class EventType:
    RESTRICTED_ENTRY = "restricted_entry"
    LOITERING = "loitering"
    WATCHLIST_MATCH = "watchlist_match"
    BEHAVIOR_ANOMALY = "behavior_anomaly"

    _LABELS = {
        RESTRICTED_ENTRY: "Restricted Area Entry",
        LOITERING: "Loitering",
        WATCHLIST_MATCH: "Watchlist Match",
        BEHAVIOR_ANOMALY: "Potential Anomalous Activity",
    }

    @classmethod
    def label(cls, event_type: str) -> str:
        return cls._LABELS.get(event_type, event_type.replace("_", " ").title())


class Severity:
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    ALL = frozenset({LOW, MEDIUM, HIGH, CRITICAL})


class AlertStatus:
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    UNDER_REVIEW = "under_review"
    ESCALATED = "escalated"
    FALSE_ALARM = "false_alarm"
    RESOLVED = "resolved"

    ALL = frozenset({NEW, ACKNOWLEDGED, UNDER_REVIEW, ESCALATED, FALSE_ALARM, RESOLVED})

    _LABELS = {
        NEW: "NEW",
        ACKNOWLEDGED: "ACKNOWLEDGED",
        UNDER_REVIEW: "UNDER REVIEW",
        ESCALATED: "ESCALATED",
        FALSE_ALARM: "FALSE ALARM",
        RESOLVED: "RESOLVED",
    }

    @classmethod
    def label(cls, status: str) -> str:
        return cls._LABELS.get(status, status.upper())


ALLOWED_STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    AlertStatus.NEW: frozenset(
        {
            AlertStatus.ACKNOWLEDGED,
            AlertStatus.UNDER_REVIEW,
            AlertStatus.ESCALATED,
            AlertStatus.FALSE_ALARM,
            AlertStatus.RESOLVED,
        }
    ),
    AlertStatus.ACKNOWLEDGED: frozenset(
        {
            AlertStatus.UNDER_REVIEW,
            AlertStatus.ESCALATED,
            AlertStatus.FALSE_ALARM,
            AlertStatus.RESOLVED,
        }
    ),
    AlertStatus.UNDER_REVIEW: frozenset(
        {AlertStatus.ESCALATED, AlertStatus.FALSE_ALARM, AlertStatus.RESOLVED}
    ),
    AlertStatus.ESCALATED: frozenset(
        {AlertStatus.UNDER_REVIEW, AlertStatus.FALSE_ALARM, AlertStatus.RESOLVED}
    ),
    AlertStatus.FALSE_ALARM: frozenset(),
    AlertStatus.RESOLVED: frozenset(),
}


def normalize_zone_event_type(zone_event_type: str) -> str:
    if zone_event_type == "entry":
        return EventType.RESTRICTED_ENTRY
    if zone_event_type == "loitering":
        return EventType.LOITERING
    return zone_event_type


@dataclass
class Alert:

    id: str
    event_type: str
    track_id: int
    zone_index: int
    zone_label: str
    camera: str
    source_type: str
    timestamp: float
    time_label: str
    severity: str
    status: str
    created_at: float
    updated_at: float
    severity_source: str = "rules"
    rule_severity: str | None = None
    severity_probs: dict[str, float] | None = None
    video_filename: str | None = None
    video_time: str | None = None
    generated_at: float = 0.0
    generated_label: str = ""
    full_snapshot: str | None = None
    focus_snapshot: str | None = None
    incident_clip: str | None = None
    incident_clip_status: str = "none"
    camera_id: int = 1
    security_event_id: int | None = None
    watchlist_id: str | None = None
    watchlist_name: str | None = None
    watchlist_category: str | None = None
    match_distance: float | None = None
    match_threshold: float | None = None
    face_snapshot: str | None = None
    anomaly_score: float | None = None
    anomaly_threshold: float | None = None
    timeline: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "event_type": self.event_type,
            "event_label": EventType.label(self.event_type),
            "track_id": self.track_id,
            "zone_index": self.zone_index,
            "zone_label": self.zone_label,
            "camera": self.camera,
            "camera_id": self.camera_id,
            "source_type": self.source_type,
            "timestamp": self.timestamp,
            "time_label": self.time_label,
            "video_filename": self.video_filename,
            "video_time": self.video_time,
            "generated_at": self.generated_at,
            "generated_label": self.generated_label,
            "severity": self.severity,
            "severity_label": self.severity.upper(),
            "severity_source": self.severity_source,
            "rule_severity": self.rule_severity,
            "severity_probs": self.severity_probs,
            "status": self.status,
            "status_label": AlertStatus.label(self.status),
            "full_snapshot": self.full_snapshot,
            "focus_snapshot": self.focus_snapshot,
            "incident_clip": self.incident_clip,
            "incident_clip_status": self.incident_clip_status,
            "security_event_id": self.security_event_id,
            "watchlist_id": self.watchlist_id,
            "watchlist_name": self.watchlist_name,
            "watchlist_category": self.watchlist_category,
            "match_distance": self.match_distance,
            "match_threshold": self.match_threshold,
            "face_snapshot": self.face_snapshot,
            "anomaly_score": self.anomaly_score,
            "anomaly_threshold": self.anomaly_threshold,
            "timeline": list(self.timeline),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
