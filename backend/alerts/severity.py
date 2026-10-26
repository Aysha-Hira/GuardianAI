from __future__ import annotations

from alerts.models import EventType, Severity


def severity_for_event(event_type: str) -> str:
    if event_type == EventType.RESTRICTED_ENTRY:
        return Severity.HIGH
    if event_type == EventType.LOITERING:
        return Severity.MEDIUM
    if event_type == EventType.BEHAVIOR_ANOMALY:
        return Severity.HIGH
    return Severity.MEDIUM


def severity_for_watchlist_risk(risk_level: str) -> str:
    level = (risk_level or "medium").strip().lower()
    if level == "critical":
        return Severity.CRITICAL
    if level == "high":
        return Severity.HIGH
    if level == "low":
        return Severity.LOW
    return Severity.MEDIUM
