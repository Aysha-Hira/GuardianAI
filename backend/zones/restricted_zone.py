from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from settings import app_settings

logger = logging.getLogger("guardian.zones")

ZONES_CONFIG_DIR = Path(__file__).resolve().parent.parent / "zone_configs"

SOURCE_WEBCAM = "webcam"
SOURCE_VIDEO = "video"
MAX_ZONES_PER_SOURCE = 5

ENTRY_CONFIRMATION_SECONDS = float(os.getenv("GUARDIAN_ENTRY_CONFIRMATION_SECONDS", "0.5"))
EVENT_TTL_SECONDS = 30.0
MAX_STORED_EVENTS = 30
DEBUG_ZONES = os.getenv("GUARDIAN_DEBUG_TRACKING", "0") == "1"

EVENT_ENTRY = "entry"
EVENT_LOITERING = "loitering"


@dataclass
class NormalizedZone:
    x: float
    y: float
    width: float
    height: float

    def to_dict(self) -> dict[str, float]:
        return {
            "x": round(self.x, 4),
            "y": round(self.y, 4),
            "width": round(self.width, 4),
            "height": round(self.height, 4),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NormalizedZone:
        return cls(
            x=float(data["x"]),
            y=float(data["y"]),
            width=float(data["width"]),
            height=float(data["height"]),
        )

    def clamp(self) -> NormalizedZone:
        x = max(0.0, min(1.0, self.x))
        y = max(0.0, min(1.0, self.y))
        w = max(0.01, min(1.0 - x, self.width))
        h = max(0.01, min(1.0 - y, self.height))
        return NormalizedZone(x=x, y=y, width=w, height=h)

    def pixel_rect(self, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
        x1 = int(self.x * frame_w)
        y1 = int(self.y * frame_h)
        x2 = int((self.x + self.width) * frame_w)
        y2 = int((self.y + self.height) * frame_h)
        return x1, y1, x2, y2


@dataclass
class SecurityEvent:

    event_id: int
    event_type: str
    track_id: int
    zone_index: int
    timestamp: float
    time_label: str
    duration_seconds: float | None = None
    zone_label: str | None = None
    subject: str = "person"

    def to_dict(self) -> dict[str, Any]:
        label = self.zone_label or f"Zone {self.zone_index + 1}"
        is_vehicle = self.subject == "vehicle"
        if self.event_type == EVENT_LOITERING:
            dur = int(round(self.duration_seconds or 0))
            title = "⚠ VEHICLE LOITERING" if is_vehicle else "⚠ LOITERING DETECTED"
            msg_kind = "VEHICLE" if is_vehicle else "Track"
            return {
                "event_id": self.event_id,
                "event_type": EVENT_LOITERING,
                "track_id": self.track_id,
                "zone_index": self.zone_index,
                "zone_label": label,
                "timestamp": self.timestamp,
                "time_label": self.time_label,
                "duration_seconds": round(self.duration_seconds or 0, 1),
                "message": f"LOITERING DETECTED — {msg_kind} #{self.track_id} ({label})",
                "title": title,
            }
        entry_title = "⚠ VEHICLE DETECTED" if is_vehicle else "⚠ RESTRICTED AREA ENTRY"
        entry_msg = (
            f"VEHICLE DETECTED — #{self.track_id} ({label})"
            if is_vehicle
            else f"RESTRICTED AREA ENTRY — Track #{self.track_id} ({label})"
        )
        return {
            "event_id": self.event_id,
            "event_type": EVENT_ENTRY,
            "track_id": self.track_id,
            "zone_index": self.zone_index,
            "zone_label": label,
            "timestamp": self.timestamp,
            "time_label": self.time_label,
            "duration_seconds": None,
            "message": entry_msg,
            "title": entry_title,
        }


ZoneEntryEvent = SecurityEvent


@dataclass
class TrackZoneInfo:
    state: str = "outside"
    inside_since: float | None = None
    inside_duration: float = 0.0
    loitering_detected: bool = False
    loitering_event_sent: bool = False


def _point_in_zone(px: float, py: float, zone: NormalizedZone, frame_w: int, frame_h: int) -> bool:
    x1, y1, x2, y2 = zone.pixel_rect(frame_w, frame_h)
    return x1 <= px <= x2 and y1 <= py <= y2


def _track_in_zone(track: Any, zone: NormalizedZone, frame_w: int, frame_h: int) -> bool:
    cx, cy = track.center
    bx, by = track.bottom_center
    return (
        _point_in_zone(float(cx), float(cy), zone, frame_w, frame_h)
        or _point_in_zone(float(bx), float(by), zone, frame_w, frame_h)
    )


def _format_video_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


class RestrictedZoneManager:

    def __init__(self, channel_id: int = 1, source_type: str = SOURCE_WEBCAM) -> None:
        self._channel_id = channel_id
        self._zones: dict[str, list[NormalizedZone]] = {
            SOURCE_WEBCAM: [],
            SOURCE_VIDEO: [],
        }
        self._zone_meta: dict[str, list[dict[str, str]]] = {
            SOURCE_WEBCAM: [],
            SOURCE_VIDEO: [],
        }
        self._active_source = (
            source_type if source_type in self._zones else SOURCE_WEBCAM
        )
        self._track_states: dict[tuple[str, int, int], TrackZoneInfo] = {}
        self._pending_since: dict[tuple[str, int, int], float] = {}
        self._events: deque[SecurityEvent] = deque(maxlen=MAX_STORED_EVENTS)
        self._event_seq = 0
        self._last_now: float | None = None
        self._time_label_fn: Callable[[float], str] = self._wall_time_label
        self.set_time_mode(self._active_source)
        self._load_persisted_zones()

    def _config_path(self) -> Path:
        return ZONES_CONFIG_DIR / f"channel_{self._channel_id}.json"

    def _legacy_config_path(self) -> Path | None:
        if self._channel_id == 1:
            return ZONES_CONFIG_DIR / "webcam.json"
        if self._channel_id == 2:
            return ZONES_CONFIG_DIR / "video.json"
        return None

    def _apply_zone_payload(self, raw: list, source: str) -> None:
        parsed_zones: list[NormalizedZone] = []
        parsed_meta: list[dict[str, str]] = []
        for z in raw[:MAX_ZONES_PER_SOURCE]:
            if not isinstance(z, dict):
                continue
            parsed_zones.append(NormalizedZone.from_dict(z).clamp())
            parsed_meta.append(
                {
                    "label": str(z.get("label") or f"Zone {len(parsed_zones)}"),
                    "target": str(z.get("target") or "person"),
                }
            )
        self._zones[source] = parsed_zones
        self._zone_meta[source] = parsed_meta

    def _load_persisted_zones(self) -> None:
        ZONES_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        src = self._active_source
        path = self._config_path()
        loaded_from_legacy = False
        raw: list | None = None
        if path.exists():
            try:
                parsed = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(parsed, list):
                    self._apply_zone_payload(parsed, src)
                    return
            except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
                logger.warning(
                    "Could not load zones for channel %s from %s", self._channel_id, path
                )
        if raw is None:
            legacy = self._legacy_config_path()
            if legacy is None or not legacy.exists():
                return
            try:
                parsed = json.loads(legacy.read_text(encoding="utf-8"))
                if not isinstance(parsed, list) or not parsed:
                    return
                raw = parsed
                loaded_from_legacy = True
            except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
                logger.warning(
                    "Could not load legacy zones for channel %s from %s",
                    self._channel_id,
                    legacy,
                )
                return
        try:
            self._apply_zone_payload(raw, src)
        except (KeyError, TypeError, ValueError):
            logger.warning("Invalid zone payload for channel %s", self._channel_id)
            return
        if loaded_from_legacy:
            self._persist_zones(src)

    def _persist_zones(self, source: str) -> None:
        ZONES_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        path = self._config_path()
        payload: list[dict[str, Any]] = []
        zones = self._zones.get(source, [])
        meta = self._zone_meta.get(source, [])
        for idx, zone in enumerate(zones):
            item = zone.to_dict()
            extra = meta[idx] if idx < len(meta) else {}
            if extra.get("label"):
                item["label"] = extra["label"]
            if extra.get("target"):
                item["target"] = extra["target"]
            payload.append(item)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _zone_label(self, zone_index: int, source: str | None = None) -> str:
        src = source or self._active_source
        meta = self._zone_meta.get(src, [])
        if 0 <= zone_index < len(meta):
            return meta[zone_index].get("label", f"Zone {zone_index + 1}")
        return f"Zone {zone_index + 1}"

    def _zone_target(self, zone_index: int, source: str | None = None) -> str:
        src = source or self._active_source
        meta = self._zone_meta.get(src, [])
        if 0 <= zone_index < len(meta):
            return meta[zone_index].get("target", "person")
        return "person"

    @staticmethod
    def _track_kind(track: Any) -> str:
        class_name = getattr(track, "class_name", "person")
        return "vehicle" if class_name != "person" else "person"

    @staticmethod
    def _track_matches_zone_target(track: Any, target: str) -> bool:
        class_name = getattr(track, "class_name", "person")
        if target == "vehicle":
            return class_name != "person"
        if target == "person":
            return class_name == "person"
        return True

    @property
    def loitering_threshold_seconds(self) -> float:
        return app_settings.loitering_threshold_seconds

    def set_loitering_threshold(self, seconds: float) -> float:
        value = app_settings.set_loitering_threshold(seconds)
        threshold = self.loitering_threshold_seconds
        for info in self._track_states.values():
            if info.state == "inside":
                info.loitering_detected = info.inside_duration >= threshold
        return value

    def set_time_mode(self, source: str) -> None:
        if source == SOURCE_VIDEO:
            self._time_label_fn = _format_video_time
        else:
            self._time_label_fn = self._wall_time_label

    @staticmethod
    def _wall_time_label(ts: float) -> str:
        return time.strftime("%H:%M:%S", time.localtime(ts))

    def set_active_source(self, source: str) -> None:
        if source not in self._zones:
            source = SOURCE_WEBCAM
        if source != self._active_source:
            self._active_source = source
            self.set_time_mode(source)
            self.reset_track_states()

    @property
    def active_source(self) -> str:
        return self._active_source

    def is_active(self, source: str | None = None) -> bool:
        src = source or self._active_source
        return len(self._zones.get(src, [])) > 0

    def get_zones(self, source: str | None = None) -> list[dict[str, float]]:
        src = source or self._active_source
        return [z.to_dict() for z in self._zones.get(src, [])]

    def set_zones(
        self,
        zone_dicts: list[dict[str, Any]],
        source: str | None = None,
        *,
        reset_states: bool = True,
    ) -> list[dict]:
        src = source or self._active_source
        zones: list[NormalizedZone] = []
        meta: list[dict[str, str]] = []
        for raw in zone_dicts[:MAX_ZONES_PER_SOURCE]:
            zones.append(NormalizedZone.from_dict(raw).clamp())
            meta.append(
                {
                    "label": str(raw.get("label") or f"Zone {len(zones)}"),
                    "target": str(raw.get("target") or "person"),
                }
            )
        self._zones[src] = zones
        self._zone_meta[src] = meta
        self._persist_zones(src)
        if src == self._active_source and reset_states:
            self.reset_track_states()
        return [z.to_dict() for z in zones]

    def clear_zones(self, source: str | None = None) -> None:
        src = source or self._active_source
        self._zones[src] = []
        self._zone_meta[src] = []
        self._persist_zones(src)
        if src == self._active_source:
            self.reset_track_states()

    def reset_track_states(self) -> None:
        self._track_states.clear()
        self._pending_since.clear()
        self._last_now = None

    def loitering_zone_indices(self) -> set[int]:
        active: set[int] = set()
        for (_kind, _tid, zidx), info in self._track_states.items():
            if info.state == "inside" and info.loitering_detected:
                active.add(zidx)
        return active

    def _state_key(self, track_id: int, zone_index: int, kind: str = "person") -> tuple[str, int, int]:
        return kind, track_id, zone_index

    def _append_event(
        self,
        event_type: str,
        track_id: int,
        zone_index: int,
        now: float,
        duration: float | None = None,
    ) -> SecurityEvent:
        self._event_seq += 1
        target = self._zone_target(zone_index)
        event = SecurityEvent(
            event_id=self._event_seq,
            event_type=event_type,
            track_id=track_id,
            zone_index=zone_index,
            timestamp=now,
            time_label=self._time_label_fn(now),
            duration_seconds=duration,
            zone_label=self._zone_label(zone_index),
            subject="vehicle" if target == "vehicle" else "person",
        )
        self._events.append(event)
        return event

    def _check_loitering(
        self,
        tid: int,
        zidx: int,
        info: TrackZoneInfo,
        now: float,
        new_events: list[SecurityEvent],
    ) -> None:
        threshold = self.loitering_threshold_seconds
        if info.state != "inside" or info.inside_since is None:
            info.loitering_detected = False
            return

        info.inside_duration = max(0.0, now - info.inside_since)
        if info.inside_duration >= threshold:
            info.loitering_detected = True
            if not info.loitering_event_sent:
                info.loitering_event_sent = True
                event = self._append_event(
                    EVENT_LOITERING,
                    tid,
                    zidx,
                    now,
                    duration=info.inside_duration,
                )
                new_events.append(event)
                if DEBUG_ZONES:
                    logger.info(
                        "Track #%s loitering threshold reached (%.1fs)",
                        tid,
                        info.inside_duration,
                    )
        else:
            info.loitering_detected = False

    def update_tracks(
        self,
        tracks: list[Any],
        frame_w: int,
        frame_h: int,
        now: float | None = None,
    ) -> list[SecurityEvent]:
        now = now if now is not None else time.time()

        if self._last_now is not None and now < self._last_now - 0.5:
            if DEBUG_ZONES:
                logger.info("Zone timers reset (playback time regression)")
            self.reset_track_states()
        self._last_now = now

        new_events: list[SecurityEvent] = []
        visible_ids: set[tuple[str, int]] = set()
        active_zones = self._zones.get(self._active_source, [])
        threshold = self.loitering_threshold_seconds

        if not active_zones:
            for track in tracks:
                track.in_zone = False
                track.zone_status = "outside"
                track.inside_zone_duration = 0.0
                track.loitering_detected = False
                track.loitering_threshold_seconds = threshold
            return new_events

        for track in tracks:
            tid = int(track.track_id)
            kind = self._track_kind(track)
            visible_ids.add((kind, tid))
            any_inside = False
            any_loitering = False
            max_inside_duration = 0.0
            worst_status = "outside"

            for zidx, zone in enumerate(active_zones):
                zone_target = self._zone_target(zidx)
                if not self._track_matches_zone_target(track, zone_target):
                    continue

                key = self._state_key(tid, zidx, kind)
                inside_geom = _track_in_zone(track, zone, frame_w, frame_h)

                info = self._track_states.get(key)
                if info is None:
                    info = TrackZoneInfo()
                    self._track_states[key] = info

                if inside_geom:
                    if info.state == "outside":
                        if key not in self._pending_since:
                            self._pending_since[key] = now
                            info.state = "pending"
                        elif now - self._pending_since[key] >= ENTRY_CONFIRMATION_SECONDS:
                            info.state = "inside"
                            info.inside_since = now
                            info.inside_duration = 0.0
                            info.loitering_detected = False
                            info.loitering_event_sent = False
                            del self._pending_since[key]
                            event = self._append_event(EVENT_ENTRY, tid, zidx, now)
                            new_events.append(event)
                            if DEBUG_ZONES:
                                logger.info("Track #%s entered zone %s", tid, zidx + 1)
                    elif info.state == "pending":
                        if now - self._pending_since.get(key, now) >= ENTRY_CONFIRMATION_SECONDS:
                            info.state = "inside"
                            info.inside_since = now
                            info.inside_duration = 0.0
                            info.loitering_detected = False
                            info.loitering_event_sent = False
                            self._pending_since.pop(key, None)
                            event = self._append_event(EVENT_ENTRY, tid, zidx, now)
                            new_events.append(event)
                            if DEBUG_ZONES:
                                logger.info("Track #%s entered zone %s", tid, zidx + 1)

                    if info.state == "inside" and info.inside_since is not None:
                        self._check_loitering(tid, zidx, info, now, new_events)
                else:
                    if info.state == "inside" and DEBUG_ZONES:
                        logger.info("Track #%s exited zone", tid)
                    self._pending_since.pop(key, None)
                    info.state = "outside"
                    info.inside_since = None
                    info.inside_duration = 0.0
                    info.loitering_detected = False
                    info.loitering_event_sent = False

                if info.state == "inside":
                    any_inside = True
                    max_inside_duration = max(max_inside_duration, info.inside_duration)
                    if info.loitering_detected:
                        any_loitering = True
                elif info.state == "pending" and worst_status == "outside":
                    worst_status = "pending"

            track.in_zone = any_inside
            track.loitering_detected = any_loitering
            track.loitering_threshold_seconds = threshold
            track.zone_status = "loitering" if any_loitering else ("inside" if any_inside else worst_status)
            track.inside_zone_duration = max_inside_duration if any_inside else 0.0

            if any_loitering:
                track.status = f"Loitering ({max_inside_duration:.1f}s)"
            elif any_inside:
                track.status = f"Inside Zone ({max_inside_duration:.1f}s)"
            elif track.zone_status == "pending":
                track.status = "Visible"

        stale = [k for k in self._track_states if (k[0], k[1]) not in visible_ids]
        for key in stale:
            del self._track_states[key]
            self._pending_since.pop(key, None)

        return new_events

    def get_active_violations(self) -> list[tuple[int, int, str]]:
        results: list[tuple[int, int, str]] = []
        for (_kind, tid, zidx), info in self._track_states.items():
            if info.state == "inside":
                et = EVENT_LOITERING if info.loitering_detected else EVENT_ENTRY
                results.append((tid, zidx, et))
        return results

    def recent_events(self, max_age: float = EVENT_TTL_SECONDS) -> list[dict[str, Any]]:
        cutoff = time.time() - max_age if self._active_source == SOURCE_WEBCAM else 0.0
        results: list[dict[str, Any]] = []
        for event in self._events:
            if self._active_source == SOURCE_WEBCAM and event.timestamp < cutoff:
                continue
            results.append(event.to_dict())
        return results
