from __future__ import annotations

import dataclasses
import logging
import threading
import time
from datetime import datetime
from typing import Any

from alerts.models import (
    ALLOWED_STATUS_TRANSITIONS,
    Alert,
    AlertStatus,
    EventType,
    normalize_zone_event_type,
)
from alerts import db as alerts_db
from alerts.features import SeverityContext
from alerts.severity import severity_for_event, severity_for_watchlist_risk
from alerts.severity_service import severity_scorer
from behavior.config import DEDUP_COOLDOWN_SEC
from zones.restricted_zone import SecurityEvent

logger = logging.getLogger("guardian.alerts")
_ALERT_FIELDS = {f.name for f in dataclasses.fields(Alert)}


class AlertStore:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._alerts: dict[str, Alert] = {}
        self._seq = 0
        self._dedup_keys: set[str] = set()
        self._behavior_last_alert_at: dict[int, float] = {}
        self._load_from_db()

    def _load_from_db(self) -> None:
        for raw in alerts_db.load_alerts():
            try:
                alert = Alert(**{k: v for k, v in raw.items() if k in _ALERT_FIELDS})
            except TypeError as exc:
                logger.warning("Skipping unreadable stored alert: %s", exc)
                continue
            self._alerts[alert.id] = alert
            if alert.id.startswith("ALT-"):
                try:
                    self._seq = max(self._seq, int(alert.id.split("-", 1)[1]))
                except ValueError:
                    pass
        if self._alerts:
            logger.info("Loaded %d alerts from database", len(self._alerts))

    @staticmethod
    def _persist(alert: Alert) -> None:
        alerts_db.save_alert(alert)

    def clear_all(self) -> list[dict[str, Any]]:
        with self._lock:
            removed = [a.to_dict() for a in self._alerts.values()]
            self._alerts.clear()
            self._dedup_keys.clear()
            self._behavior_last_alert_at.clear()
            alerts_db.delete_all_alerts()
            return removed

    def reset(self) -> None:
        with self._lock:
            self._alerts.clear()
            self._dedup_keys.clear()
            self._behavior_last_alert_at.clear()
            self._seq = 0

    @staticmethod
    def _dedup_key(
        event_type: str,
        track_id: int,
        zone_index: int,
        camera_id: int,
    ) -> str:
        return f"{int(camera_id)}:{event_type}:{int(track_id)}:{int(zone_index)}"

    def _next_id(self) -> str:
        self._seq += 1
        return f"ALT-{self._seq:04d}"

    @staticmethod
    def _wall_label(wall_ts: float) -> str:
        return datetime.fromtimestamp(wall_ts).strftime("%H:%M:%S")

    @staticmethod
    def _timeline_entry(event: SecurityEvent, event_type: str) -> dict[str, Any]:
        return {
            "timestamp": event.timestamp,
            "time_label": event.time_label,
            "event_type": event_type,
            "event_label": event.to_dict().get("title", event_type).replace("⚠ ", ""),
            "message": event.to_dict().get("message", ""),
        }

    @staticmethod
    def _watchlist_dedup_key(
        track_id: int,
        watchlist_id: str,
        camera_id: int,
    ) -> str:
        return f"{int(camera_id)}:{EventType.WATCHLIST_MATCH}:{int(track_id)}:{watchlist_id}"

    @staticmethod
    def _apply_severity(alert: Alert, context: SeverityContext) -> None:
        prediction = severity_scorer.predict(context)
        meta = prediction.to_metadata()
        alert.severity = prediction.severity
        alert.severity_source = str(meta["severity_source"])
        alert.rule_severity = meta["rule_severity"]
        alert.severity_probs = meta["severity_probs"]

    def create_from_watchlist_match(
        self,
        *,
        camera: str,
        source_type: str,
        camera_id: int,
        track_id: int,
        watchlist_id: str,
        watchlist_name: str,
        watchlist_category: str,
        risk_level: str,
        distance: float,
        threshold: float,
        face_snapshot: str | None = None,
        video_filename: str | None = None,
        video_time: str | None = None,
        wall_now: float | None = None,
        people_count: int = 0,
        track_summary: dict | None = None,
    ) -> Alert | None:
        cam_id = int(camera_id)
        dedup = self._watchlist_dedup_key(track_id, watchlist_id, cam_id)

        with self._lock:
            if dedup in self._dedup_keys:
                return None

            wall_now = wall_now if wall_now is not None else time.time()
            alert_id = self._next_id()
            time_label = self._wall_label(wall_now)
            message = (
                f"Watchlist match: {watchlist_name} on track #{track_id} "
                f"(distance {distance:.3f}, threshold {threshold:.3f})"
            )

            alert = Alert(
                id=alert_id,
                event_type=EventType.WATCHLIST_MATCH,
                track_id=int(track_id),
                zone_index=-1,
                zone_label="Watchlist",
                camera=camera,
                source_type=source_type,
                camera_id=cam_id,
                timestamp=wall_now,
                time_label=time_label,
                video_filename=video_filename,
                video_time=video_time,
                generated_at=wall_now,
                generated_label=time_label,
                severity=severity_for_watchlist_risk(risk_level),
                status=AlertStatus.NEW,
                focus_snapshot=face_snapshot,
                face_snapshot=face_snapshot,
                incident_clip_status="none",
                watchlist_id=watchlist_id,
                watchlist_name=watchlist_name,
                watchlist_category=watchlist_category,
                match_distance=round(float(distance), 4),
                match_threshold=round(float(threshold), 4),
                timeline=[
                    {
                        "timestamp": wall_now,
                        "time_label": time_label,
                        "event_type": EventType.WATCHLIST_MATCH,
                        "event_label": EventType.label(EventType.WATCHLIST_MATCH),
                        "message": message,
                    }
                ],
                created_at=wall_now,
                updated_at=wall_now,
            )
            self._apply_severity(
                alert,
                SeverityContext.from_watchlist_match(
                    timestamp=wall_now,
                    source_type=source_type,
                    people_count=people_count,
                    risk_level=risk_level,
                    face_match_distance=distance,
                    track_summary=track_summary,
                ),
            )
            self._alerts[alert_id] = alert
            self._dedup_keys.add(dedup)
            self._persist(alert)
            return alert

    def create_from_behavior_anomaly(
        self,
        *,
        camera: str,
        source_type: str,
        camera_id: int,
        anomaly_score: float,
        anomaly_threshold: float,
        focus_snapshot: str | None = None,
        video_filename: str | None = None,
        video_time: str | None = None,
        wall_now: float | None = None,
        people_count: int = 0,
    ) -> Alert | None:
        cam_id = int(camera_id)
        wall_now = wall_now if wall_now is not None else time.time()

        with self._lock:
            last_at = self._behavior_last_alert_at.get(cam_id, 0.0)
            if wall_now - last_at < DEDUP_COOLDOWN_SEC:
                return None

            alert_id = self._next_id()
            time_label = self._wall_label(wall_now)
            message = (
                f"Potential anomalous activity detected "
                f"(score {anomaly_score:.5f}, threshold {anomaly_threshold:.5f})"
            )

            alert = Alert(
                id=alert_id,
                event_type=EventType.BEHAVIOR_ANOMALY,
                track_id=-1,
                zone_index=-1,
                zone_label="Behavior",
                camera=camera,
                source_type=source_type,
                camera_id=cam_id,
                timestamp=wall_now,
                time_label=time_label,
                video_filename=video_filename,
                video_time=video_time,
                generated_at=wall_now,
                generated_label=time_label,
                severity=severity_for_event(EventType.BEHAVIOR_ANOMALY),
                status=AlertStatus.NEW,
                focus_snapshot=focus_snapshot,
                full_snapshot=focus_snapshot,
                incident_clip_status="none",
                anomaly_score=round(float(anomaly_score), 6),
                anomaly_threshold=round(float(anomaly_threshold), 6),
                timeline=[
                    {
                        "timestamp": wall_now,
                        "time_label": time_label,
                        "event_type": EventType.BEHAVIOR_ANOMALY,
                        "event_label": EventType.label(EventType.BEHAVIOR_ANOMALY),
                        "message": message,
                    }
                ],
                created_at=wall_now,
                updated_at=wall_now,
            )
            self._apply_severity(
                alert,
                SeverityContext.from_behavior_anomaly(
                    timestamp=wall_now,
                    source_type=source_type,
                    people_count=people_count,
                    anomaly_score=anomaly_score,
                    anomaly_threshold=anomaly_threshold,
                ),
            )
            self._alerts[alert_id] = alert
            self._behavior_last_alert_at[cam_id] = wall_now
            self._persist(alert)
            return alert

    def clear_watchlist_dedup_for_track(self, camera_id: int, track_id: int) -> None:
        prefix = f"{int(camera_id)}:{EventType.WATCHLIST_MATCH}:{int(track_id)}:"
        with self._lock:
            self._dedup_keys = {k for k in self._dedup_keys if not k.startswith(prefix)}

    def create_from_security_event(
        self,
        event: SecurityEvent,
        *,
        camera: str,
        source_type: str,
        camera_id: int = 1,
        video_filename: str | None = None,
        video_time: str | None = None,
        full_snapshot: str | None = None,
        focus_snapshot: str | None = None,
        wall_now: float | None = None,
        people_count: int = 0,
        track_summary: dict | None = None,
    ) -> Alert | None:
        event_type = normalize_zone_event_type(event.event_type)
        cam_id = int(camera_id)
        dedup = self._dedup_key(event_type, event.track_id, event.zone_index, cam_id)

        with self._lock:
            if dedup in self._dedup_keys:
                return None

            wall_now = wall_now if wall_now is not None else time.time()
            alert_id = self._next_id()
            zone_label = f"Zone {event.zone_index + 1}"

            alert = Alert(
                id=alert_id,
                event_type=event_type,
                track_id=int(event.track_id),
                zone_index=int(event.zone_index),
                zone_label=zone_label,
                camera=camera,
                source_type=source_type,
                camera_id=int(camera_id),
                timestamp=float(event.timestamp),
                time_label=event.time_label,
                video_filename=video_filename,
                video_time=video_time,
                generated_at=wall_now,
                generated_label=self._wall_label(wall_now),
                severity=severity_for_event(event_type),
                status=AlertStatus.NEW,
                full_snapshot=full_snapshot,
                focus_snapshot=focus_snapshot,
                incident_clip_status="recording",
                security_event_id=int(event.event_id),
                timeline=[self._timeline_entry(event, event_type)],
                created_at=wall_now,
                updated_at=wall_now,
            )
            self._apply_severity(
                alert,
                SeverityContext.from_security_event(
                    event,
                    source_type=source_type,
                    people_count=people_count,
                    track_summary=track_summary,
                    wall_now=wall_now,
                ),
            )
            self._alerts[alert_id] = alert
            self._dedup_keys.add(dedup)
            self._persist(alert)
            return alert

    def attach_evidence(
        self,
        track_id: int,
        zone_index: int,
        event_type: str,
        *,
        camera_id: int,
        full_snapshot: str | None = None,
        focus_snapshot: str | None = None,
        incident_clip: str | None = None,
    ) -> None:
        normalized = normalize_zone_event_type(event_type)
        dedup = self._dedup_key(normalized, track_id, zone_index, camera_id)
        with self._lock:
            for alert in self._alerts.values():
                if (
                    self._dedup_key(
                        alert.event_type, alert.track_id, alert.zone_index, alert.camera_id
                    )
                    != dedup
                ):
                    continue
                if full_snapshot and not alert.full_snapshot:
                    alert.full_snapshot = full_snapshot
                if focus_snapshot and not alert.focus_snapshot:
                    alert.focus_snapshot = focus_snapshot
                if incident_clip and not alert.incident_clip:
                    alert.incident_clip = incident_clip
                    alert.incident_clip_status = "ready"
                alert.updated_at = time.time()
                self._persist(alert)
                return

    @staticmethod
    def _incident_key(camera_id: int, track_id: int, zone_index: int) -> tuple[int, int, int]:
        return int(camera_id), int(track_id), int(zone_index)

    def set_incident_clip_status(
        self,
        camera_id: int,
        track_id: int,
        zone_index: int,
        event_type: str,
        status: str,
    ) -> None:
        key = self._incident_key(camera_id, track_id, zone_index)
        with self._lock:
            for alert in self._alerts.values():
                if self._incident_key(alert.camera_id, alert.track_id, alert.zone_index) != key:
                    continue
                if alert.incident_clip_status == "ready" and alert.incident_clip:
                    continue
                alert.incident_clip_status = status
                alert.updated_at = time.time()
                self._persist(alert)

    def attach_incident_clip(
        self,
        camera_id: int,
        track_id: int,
        zone_index: int,
        event_type: str,
        filename: str,
    ) -> None:
        key = self._incident_key(camera_id, track_id, zone_index)
        with self._lock:
            for alert in self._alerts.values():
                if self._incident_key(alert.camera_id, alert.track_id, alert.zone_index) != key:
                    continue
                if not alert.incident_clip:
                    alert.incident_clip = filename
                alert.incident_clip_status = "ready"
                alert.updated_at = time.time()
                self._persist(alert)

    def list_alerts(
        self,
        *,
        status: str | None = None,
        severity: str | None = None,
        event_type: str | None = None,
        filter_preset: str | None = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._alerts.values())

        if filter_preset == "new":
            items = [a for a in items if a.status == AlertStatus.NEW]
        elif filter_preset == "high":
            items = [a for a in items if a.severity in ("high", "critical")]
        elif filter_preset == "resolved":
            items = [a for a in items if a.status == AlertStatus.RESOLVED]

        if status:
            items = [a for a in items if a.status == status]
        if severity:
            items = [a for a in items if a.severity == severity]
        if event_type:
            items = [a for a in items if a.event_type == event_type]

        items.sort(key=lambda a: a.created_at, reverse=True)
        return [a.to_dict() for a in items]

    def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        with self._lock:
            alert = self._alerts.get(alert_id)
            return alert.to_dict() if alert else None

    def count_new(self) -> int:
        with self._lock:
            return sum(1 for a in self._alerts.values() if a.status == AlertStatus.NEW)

    def update_status(self, alert_id: str, new_status: str) -> dict[str, Any]:
        if new_status not in AlertStatus.ALL:
            raise ValueError(f"Invalid status: {new_status}")

        with self._lock:
            alert = self._alerts.get(alert_id)
            if alert is None:
                raise KeyError(alert_id)

            allowed = ALLOWED_STATUS_TRANSITIONS.get(alert.status, frozenset())
            if new_status != alert.status and new_status not in allowed:
                raise ValueError(
                    f"Cannot transition from {alert.status} to {new_status}"
                )

            alert.status = new_status
            alert.updated_at = time.time()
            self._persist(alert)
            return alert.to_dict()
