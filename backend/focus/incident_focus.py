from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from focus.face_finder import FACE_HEIGHT_IN_CROP, FACE_Y_IN_CROP, FaceFinder, FaceHit
from zones.restricted_zone import (
    EVENT_ENTRY as ZONE_EVENT_ENTRY,
    EVENT_LOITERING as ZONE_EVENT_LOITERING,
    MAX_ZONES_PER_SOURCE,
    SecurityEvent,
)

logger = logging.getLogger("guardian.focus")

TARGET_LOST_GRACE_SECONDS = 4.0
FACE_REFRESH_SEC = 0.45
FACE_REFRESH_MANUAL_SEC = float(os.getenv("GUARDIAN_FACE_REFRESH_MANUAL_SEC", "1.0"))
AUTO_RELEASE_AFTER_LOST_SECONDS = 20.0
MIN_DIGITAL_ZOOM = 1.0
MAX_DIGITAL_ZOOM = 3.0
FACE_FOCUS_MARGIN_RATIO = 0.28
ZOOM_SMOOTHING = 0.10
FACE_SMOOTHING = 0.12
MANUAL_FACE_SMOOTHING = float(os.getenv("GUARDIAN_MANUAL_FACE_SMOOTHING", "0.06"))
MANUAL_ZOOM_SMOOTHING = float(os.getenv("GUARDIAN_MANUAL_ZOOM_SMOOTHING", "0.05"))
MANUAL_CROP_SMOOTHING = float(os.getenv("GUARDIAN_MANUAL_CROP_SMOOTHING", "0.07"))
MANUAL_PAN_DEADZONE = float(os.getenv("GUARDIAN_MANUAL_PAN_DEADZONE", "8"))
MANUAL_MAX_PAN_STEP = float(os.getenv("GUARDIAN_MANUAL_MAX_PAN_STEP", "16"))
FOCUS_OUTPUT_WIDTH = 640

MODE_AUTO = "auto"
MODE_MANUAL = "manual"
MODE_INCIDENT = "incident"

STATUS_ACTIVE = "active"
STATUS_SEARCHING = "searching"
STATUS_LOST = "lost"
STATUS_IDLE = "idle"
STATUS_RECORDED = "recorded"

EVENT_MANUAL = "manual_follow"
EVENT_RESTRICTED = "restricted_entry"
EVENT_LOITERING = "loitering"
EVENT_INCIDENT = "incident_record"
EVENT_WATCHLIST = "watchlist_match"

EVENT_PRIORITY = {
    ZONE_EVENT_ENTRY: 1,
    ZONE_EVENT_LOITERING: 2,
    EVENT_WATCHLIST: 3,
}


@dataclass
class FocusSlot:
    slot_id: str
    track_id: int
    zone_index: int | None = None
    zone_label: str = ""
    mode: str = MODE_AUTO
    event: str | None = None
    tracking_status: str = STATUS_ACTIVE
    zoom: float = MIN_DIGITAL_ZOOM
    lost_since: float | None = None
    smooth_cx: float | None = None
    smooth_cy: float | None = None
    smooth_face_w: float | None = None
    smooth_face_h: float | None = None
    smooth_crop_x: float | None = None
    smooth_crop_y: float | None = None
    smooth_zoom: float = MIN_DIGITAL_ZOOM
    last_face: FaceHit | None = None
    face_detected_at: float = 0.0
    last_frame: np.ndarray | None = None


@dataclass
class FocusUpdateResult:
    frames: dict[str, np.ndarray] = field(default_factory=dict)
    evidence_saved: list[str] = field(default_factory=list)


class IncidentFocusManager:

    def __init__(self, incidents_dir: Path) -> None:
        self._incidents_dir = incidents_dir
        self._slots: dict[str, FocusSlot] = {}
        self._saved_evidence_keys: set[str] = set()
        self._last_now: float = 0.0
        self._face_finder = FaceFinder()
        self._current_camera_id: int = 1

    @staticmethod
    def _auto_slot_key(zone_index: int) -> str:
        return f"z{int(zone_index)}"

    @staticmethod
    def _manual_slot_key() -> str:
        return "manual"

    @staticmethod
    def _legacy_auto_slot_prefix(zone_index: int) -> str:
        return f"z{int(zone_index)}_t"

    def _purge_legacy_zone_slots(self, zone_index: int) -> None:
        prefix = self._legacy_auto_slot_prefix(zone_index)
        canonical = self._auto_slot_key(zone_index)
        for sid in list(self._slots):
            if sid.startswith(prefix) and sid != canonical:
                del self._slots[sid]

    def _clear_zone_evidence_keys(self, zone_index: int) -> None:
        prefix = f"zone{int(zone_index)}:"
        self._saved_evidence_keys = {
            key for key in self._saved_evidence_keys if not key.startswith(prefix)
        }

    def _retarget_slot(self, slot: FocusSlot, track_id: int) -> None:
        tid = int(track_id)
        if slot.track_id == tid:
            slot.tracking_status = STATUS_ACTIVE
            slot.lost_since = None
            return
        slot.track_id = tid
        slot.tracking_status = STATUS_ACTIVE
        slot.lost_since = None
        slot.smooth_cx = None
        slot.smooth_cy = None
        slot.smooth_face_w = None
        slot.smooth_face_h = None
        slot.smooth_crop_x = None
        slot.smooth_crop_y = None
        slot.smooth_zoom = MIN_DIGITAL_ZOOM
        slot.last_face = None
        slot.last_frame = None

    def reset(self) -> None:
        self._slots.clear()
        self._saved_evidence_keys.clear()

    def release(self, slot_id: str | None = None) -> dict[str, Any]:
        if slot_id:
            slot = self._slots.get(slot_id)
            if slot is not None and slot.zone_index is not None:
                self._clear_zone_evidence_keys(slot.zone_index)
            self._slots.pop(slot_id, None)
        else:
            self._slots.clear()
            self._saved_evidence_keys.clear()
        return self.get_status()

    def follow_manual(
        self,
        track_id: int,
        person_bbox: tuple[int, int, int, int] | None = None,
        frame: np.ndarray | None = None,
        tracks: list[Any] | None = None,
    ) -> dict[str, Any]:
        for sid in list(self._slots):
            if sid == self._manual_slot_key() or sid.startswith("manual_t"):
                del self._slots[sid]
        sid = self._manual_slot_key()
        if len(self._slots) >= MAX_ZONES_PER_SOURCE:
            self._drop_lowest_priority_slot()
        slot = FocusSlot(
            slot_id=sid,
            track_id=int(track_id),
            zone_index=None,
            zone_label="Manual",
            mode=MODE_MANUAL,
            event=EVENT_MANUAL,
            tracking_status=STATUS_ACTIVE,
        )
        if person_bbox is not None:
            head = self._seed_face_for_track(
                int(track_id),
                person_bbox,
                frame,
                tracks or [],
            )
            slot.smooth_cx = head.cx
            slot.smooth_cy = head.cy
            slot.smooth_face_w = float(head.bbox[2] - head.bbox[0])
            slot.smooth_face_h = float(head.bbox[3] - head.bbox[1])
            slot.last_face = head
            slot.smooth_zoom = MIN_DIGITAL_ZOOM
            slot.face_detected_at = time.time()
        self._slots[sid] = slot
        return self.get_status()

    def focus_incident_person_live(
        self,
        track_id: int,
        *,
        person_bbox: tuple[int, int, int, int] | None = None,
        frame: np.ndarray | None = None,
        tracks: list[Any] | None = None,
    ) -> dict[str, Any]:
        self._slots.clear()
        return self.follow_manual(
            track_id,
            person_bbox=person_bbox,
            frame=frame,
            tracks=tracks,
        )

    def focus_incident_person_recorded(
        self,
        *,
        alert_id: str,
        track_id: int,
        zone_index: int,
        zone_label: str,
        image: np.ndarray,
    ) -> dict[str, Any]:
        self._slots.clear()
        sid = self._incident_slot_key(alert_id)
        slot = FocusSlot(
            slot_id=sid,
            track_id=int(track_id),
            zone_index=int(zone_index),
            zone_label=zone_label or f"Zone {int(zone_index) + 1}",
            mode=MODE_INCIDENT,
            event=EVENT_INCIDENT,
            tracking_status=STATUS_RECORDED,
            zoom=1.0,
            last_frame=image.copy(),
        )
        self._slots[sid] = slot
        return self.get_status()

    @staticmethod
    def _incident_slot_key(alert_id: str) -> str:
        return f"alert_{alert_id}"

    def _seed_face_for_track(
        self,
        track_id: int,
        person_bbox: tuple[int, int, int, int],
        frame: np.ndarray | None,
        tracks: list[Any],
    ) -> FaceHit:
        if frame is not None and frame.size > 0:
            detected = self._face_finder.find_face(frame, person_bbox, tight=True)
            if detected is None:
                faces = self._face_finder.scan_faces(frame)
                detected = self._face_finder.face_for_track(
                    faces,
                    tracks,
                    track_id,
                )
            if detected is not None:
                return detected
        return self._face_finder.estimate_head(person_bbox)

    def focus_watchlist_match(
        self,
        track_id: int,
        watchlist_name: str,
        *,
        person_bbox: tuple[int, int, int, int] | None = None,
        frame: np.ndarray | None = None,
        tracks: list[Any] | None = None,
    ) -> dict[str, Any]:
        tid = int(track_id)
        sid = f"watchlist_t{tid}"
        for existing_sid in list(self._slots):
            if existing_sid.startswith("watchlist_t") and existing_sid != sid:
                del self._slots[existing_sid]
        if len(self._slots) >= MAX_ZONES_PER_SOURCE and sid not in self._slots:
            self._drop_lowest_priority_slot()
        slot = self._slots.get(sid)
        if slot is None:
            slot = FocusSlot(
                slot_id=sid,
                track_id=tid,
                zone_index=None,
                zone_label=f"Watchlist · {watchlist_name}",
                mode=MODE_AUTO,
                event=EVENT_WATCHLIST,
                tracking_status=STATUS_ACTIVE,
            )
            self._slots[sid] = slot
        else:
            slot.track_id = tid
            slot.zone_label = f"Watchlist · {watchlist_name}"
            slot.event = EVENT_WATCHLIST
            slot.tracking_status = STATUS_ACTIVE
            slot.lost_since = None
        if person_bbox is not None:
            head = self._seed_face_for_track(tid, person_bbox, frame, tracks or [])
            slot.smooth_cx = head.cx
            slot.smooth_cy = head.cy
            slot.smooth_face_w = float(head.bbox[2] - head.bbox[0])
            slot.smooth_face_h = float(head.bbox[3] - head.bbox[1])
            slot.last_face = head
            slot.face_detected_at = time.time()
        manual_key = self._manual_slot_key()
        if manual_key in self._slots and self._slots[manual_key].track_id == tid:
            del self._slots[manual_key]
        return self.get_status()

    def lock_auto(self, track_id: int, event_type: str, zone_index: int = 0) -> dict[str, Any]:
        tid = int(track_id)
        zidx = int(zone_index)
        if event_type == ZONE_EVENT_LOITERING:
            new_event = EVENT_LOITERING
            new_pri = 2
        elif event_type == ZONE_EVENT_ENTRY:
            new_event = EVENT_RESTRICTED
            new_pri = 1
        else:
            return self.get_status()

        self._purge_legacy_zone_slots(zidx)
        sid = self._auto_slot_key(zidx)
        existing = self._slots.get(sid)
        if existing is None:
            if len(self._slots) >= MAX_ZONES_PER_SOURCE:
                self._drop_lowest_priority_slot()
            self._slots[sid] = FocusSlot(
                slot_id=sid,
                track_id=tid,
                zone_index=zidx,
                zone_label=f"Zone {zidx + 1}",
                mode=MODE_AUTO,
                event=new_event,
                tracking_status=STATUS_ACTIVE,
            )
        elif existing.mode == MODE_AUTO:
            self._retarget_slot(existing, tid)
            cur_pri = 2 if existing.event == EVENT_LOITERING else 1
            if new_pri >= cur_pri:
                existing.event = new_event
        manual_key = self._manual_slot_key()
        manual = self._slots.get(manual_key)
        if manual is not None and manual.track_id == tid:
            del self._slots[manual_key]
        return self.get_status()

    def _drop_lowest_priority_slot(self) -> None:
        lost = [s for s in self._slots if self._slots[s].tracking_status == STATUS_LOST]
        if lost:
            del self._slots[lost[0]]
            return
        manual = [s for s in self._slots if self._slots[s].mode == MODE_MANUAL]
        if manual:
            del self._slots[manual[0]]
            return
        entry = [s for s in self._slots if self._slots[s].event == EVENT_RESTRICTED]
        if entry:
            del self._slots[entry[0]]
            return
        loiter = [s for s in self._slots if self._slots[s].event == EVENT_LOITERING]
        if loiter:
            del self._slots[loiter[0]]

    def get_status(self) -> dict[str, Any]:
        focuses = []
        for slot in self._slots.values():
            event_label = {
                EVENT_RESTRICTED: "RESTRICTED ENTRY",
                EVENT_LOITERING: "LOITERING",
                EVENT_WATCHLIST: "WATCHLIST MATCH",
                EVENT_MANUAL: "MANUAL FOLLOW",
                EVENT_INCIDENT: "INCIDENT RECORD",
            }.get(slot.event or "", slot.event or "—")
            status_label = {
                STATUS_ACTIVE: "ACTIVE",
                STATUS_SEARCHING: "SEARCHING…",
                STATUS_LOST: "TARGET LOST",
                STATUS_RECORDED: "RECORDED",
            }.get(slot.tracking_status, slot.tracking_status.upper())
            focuses.append(
                {
                    "slot_id": slot.slot_id,
                    "track_id": slot.track_id,
                    "zone_index": slot.zone_index,
                    "zone_label": slot.zone_label or (
                        f"Zone {(slot.zone_index or 0) + 1}" if slot.zone_index is not None else "—"
                    ),
                    "mode": slot.mode,
                    "event": slot.event,
                    "event_label": event_label,
                    "tracking_status": slot.tracking_status,
                    "tracking_label": status_label,
                    "zoom": round(slot.zoom, 1),
                }
            )
        active = len(focuses) > 0
        primary = focuses[0] if focuses else None
        result: dict[str, Any] = {
            "active": active,
            "count": len(focuses),
            "focuses": focuses,
            "label": "INCIDENT FOCUS" if active else "NO ACTIVE INCIDENT",
        }
        if primary:
            result.update(primary)
        else:
            result.update(
                {
                    "slot_id": None,
                    "track_id": None,
                    "zone_index": None,
                    "mode": None,
                    "event": None,
                    "tracking_status": STATUS_IDLE,
                    "zoom": None,
                }
            )
        return result

    def get_frame(self, slot_id: str | None = None) -> np.ndarray | None:
        if not self._slots:
            return None
        if slot_id and slot_id in self._slots:
            frame = self._slots[slot_id].last_frame
            return None if frame is None else frame.copy()
        for slot in self._slots.values():
            if slot.last_frame is not None:
                return slot.last_frame.copy()
        return None

    def _security_event_name(self, event_type: str) -> str:
        if event_type == ZONE_EVENT_LOITERING:
            return EVENT_LOITERING
        return EVENT_RESTRICTED

    def _handle_security_events(self, events: list[SecurityEvent]) -> None:
        for event in events:
            if event.event_type not in (ZONE_EVENT_ENTRY, ZONE_EVENT_LOITERING):
                continue
            self.lock_auto(int(event.track_id), event.event_type, int(event.zone_index))

    def sync_active_violations(self, violations: list[tuple[int, int, str]]) -> None:
        best: dict[int, tuple[int, str, int]] = {}
        for track_id, zone_index, event_type in violations:
            if event_type not in (ZONE_EVENT_ENTRY, ZONE_EVENT_LOITERING):
                continue
            zidx = int(zone_index)
            pri = 2 if event_type == ZONE_EVENT_LOITERING else 1
            cur = best.get(zidx)
            tid = int(track_id)
            if cur is None or pri > cur[2] or (pri == cur[2] and tid >= cur[0]):
                best[zidx] = (tid, event_type, pri)
        for zidx, (tid, event_type, _pri) in best.items():
            self.lock_auto(tid, event_type, zidx)

    def _consolidate_legacy_slots(self) -> None:
        for sid in list(self._slots):
            if not sid.startswith("z") or "_t" not in sid:
                continue
            try:
                zpart, _rest = sid.split("_t", 1)
                zidx = int(zpart[1:])
            except ValueError:
                continue
            legacy = self._slots.pop(sid)
            canonical = self._auto_slot_key(zidx)
            current = self._slots.get(canonical)
            if current is None:
                legacy.slot_id = canonical
                self._slots[canonical] = legacy
            elif legacy.tracking_status == STATUS_ACTIVE:
                self._retarget_slot(current, legacy.track_id)

    @staticmethod
    def _find_track(tracks: list[Any], track_id: int) -> Any | None:
        for t in tracks:
            if int(getattr(t, "track_id", -1)) == track_id:
                return t
        return None

    def _face_margin(self, face_bbox: tuple[int, int, int, int]) -> int:
        fh = max(18, face_bbox[3] - face_bbox[1])
        return max(14, int(fh * FACE_FOCUS_MARGIN_RATIO))

    def _max_zoom_for_full_face(
        self,
        face_bbox: tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
    ) -> float:
        fx1, fy1, fx2, fy2 = face_bbox
        margin = self._face_margin(face_bbox)
        need_w = (fx2 - fx1) + 2 * margin
        need_h = (fy2 - fy1) + 2 * margin
        if need_w <= 0 or need_h <= 0:
            return 1.0
        return float(min(frame_w / need_w, frame_h / need_h, MAX_DIGITAL_ZOOM))

    def _target_zoom_for_face(
        self, face_bbox: tuple[int, int, int, int], frame_w: int, frame_h: int
    ) -> float:
        fx1, fy1, fx2, fy2 = face_bbox
        fh = max(18, fy2 - fy1)
        fw = max(18, fx2 - fx1)
        margin = self._face_margin(face_bbox)
        padded_h = fh + 2 * margin
        padded_w = fw + 2 * margin
        need_h = padded_h / FACE_HEIGHT_IN_CROP
        need_w = padded_w / 0.52
        ideal = min(frame_w / need_w, frame_h / need_h)
        cap = self._max_zoom_for_full_face(face_bbox, frame_w, frame_h)
        zoom = min(ideal, cap)
        return float(max(MIN_DIGITAL_ZOOM, min(zoom, MAX_DIGITAL_ZOOM)))

    def _resolve_face(
        self,
        slot: FocusSlot,
        frame: np.ndarray,
        person_bbox: tuple[int, int, int, int],
        tracks: list[Any],
    ) -> FaceHit:
        now = time.time()
        manual = slot.mode == MODE_MANUAL
        track_id = int(slot.track_id)
        refresh_sec = FACE_REFRESH_MANUAL_SEC if manual else FACE_REFRESH_SEC
        anchor = (
            (slot.smooth_cx, slot.smooth_cy)
            if slot.smooth_cx is not None and slot.smooth_cy is not None
            else None
        )
        refresh = (
            slot.last_face is None
            or slot.face_detected_at <= 0
            or (now - slot.face_detected_at) >= refresh_sec
            or (manual and slot.last_face is not None and slot.last_face.confidence <= 0)
        )
        detected: FaceHit | None = None

        def _owned(face: FaceHit | None) -> FaceHit | None:
            if face is None:
                return None
            owner = self._face_finder.owner_track_id(face, tracks)
            return face if owner == track_id else None

        if refresh:
            if manual:
                detected = _owned(self._face_finder.find_face(frame, person_bbox, tight=True))
                if detected is None:
                    faces = self._face_finder.scan_faces(frame)
                    detected = self._face_finder.face_for_track(
                        faces, tracks, track_id, anchor=anchor
                    )
            else:
                faces = self._face_finder.scan_faces(frame)
                detected = self._face_finder.face_for_track(
                    faces, tracks, track_id, anchor=anchor
                )
                if detected is None:
                    detected = _owned(self._face_finder.find_face(frame, person_bbox))
            slot.face_detected_at = now
        elif slot.last_face is not None:
            detected = (
                _owned(slot.last_face)
                if manual and slot.last_face.confidence > 0
                else slot.last_face
            )

        if detected is None and not manual:
            faces = self._face_finder.scan_faces(frame)
            detected = self._face_finder.face_for_track(
                faces, tracks, track_id, anchor=anchor
            )
        if detected is None:
            return self._face_finder.estimate_head(person_bbox)

        fx1, fy1, fx2, fy2 = detected.bbox
        fw = max(18.0, float(fx2 - fx1))
        fh = max(18.0, float(fy2 - fy1))
        target_cx, target_cy = detected.cx, detected.cy

        if manual:
            if slot.smooth_cx is not None and slot.smooth_cy is not None:
                dx = target_cx - slot.smooth_cx
                dy = target_cy - slot.smooth_cy
                dist = (dx * dx + dy * dy) ** 0.5
                if dist > MANUAL_MAX_PAN_STEP:
                    scale = MANUAL_MAX_PAN_STEP / dist
                    target_cx = slot.smooth_cx + dx * scale
                    target_cy = slot.smooth_cy + dy * scale
            rate = MANUAL_FACE_SMOOTHING * (0.65 if detected.confidence <= 0 else 1.0)
            if slot.smooth_cx is None or slot.smooth_cy is None:
                slot.smooth_cx, slot.smooth_cy = target_cx, target_cy
            else:
                slot.smooth_cx = self._smooth_scalar(
                    slot.smooth_cx, target_cx, rate, deadzone=MANUAL_PAN_DEADZONE
                )
                slot.smooth_cy = self._smooth_scalar(
                    slot.smooth_cy, target_cy, rate, deadzone=MANUAL_PAN_DEADZONE * 0.75
                )
            if slot.smooth_face_w is None or slot.smooth_face_h is None:
                slot.smooth_face_w, slot.smooth_face_h = fw, fh
            else:
                slot.smooth_face_w = self._smooth_scalar(slot.smooth_face_w, fw, rate)
                slot.smooth_face_h = self._smooth_scalar(slot.smooth_face_h, fh, rate)
            cx, cy = slot.smooth_cx, slot.smooth_cy
            fw, fh = slot.smooth_face_w, slot.smooth_face_h
        else:
            smooth_rate = FACE_SMOOTHING * 1.35
            if slot.smooth_cx is None or slot.smooth_cy is None:
                slot.smooth_cx, slot.smooth_cy = target_cx, target_cy
            else:
                slot.smooth_cx += (target_cx - slot.smooth_cx) * smooth_rate
                slot.smooth_cy += (target_cy - slot.smooth_cy) * smooth_rate
            cx, cy = slot.smooth_cx, slot.smooth_cy

        smooth_bbox = (
            int(round(cx - fw / 2)),
            int(round(cy - fh / 2)),
            int(round(cx + fw / 2)),
            int(round(cy + fh / 2)),
        )
        return FaceHit(cx=cx, cy=cy, bbox=smooth_bbox, confidence=detected.confidence)

    @staticmethod
    def _smooth_scalar(
        current: float,
        target: float,
        rate: float,
        *,
        deadzone: float = 0.0,
        max_step: float | None = None,
    ) -> float:
        delta = target - current
        if deadzone > 0 and abs(delta) < deadzone:
            return current
        step = delta * rate
        if max_step is not None and abs(step) > max_step:
            step = max_step if step > 0 else -max_step
        return current + step

    def _smooth_crop_rect(
        self,
        slot: FocusSlot,
        crop_rect: tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
    ) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = crop_rect
        crop_w = max(1, x2 - x1)
        crop_h = max(1, y2 - y1)
        if slot.mode != MODE_MANUAL:
            return crop_rect

        if slot.smooth_crop_x is None or slot.smooth_crop_y is None:
            slot.smooth_crop_x = float(x1)
            slot.smooth_crop_y = float(y1)
        else:
            slot.smooth_crop_x = self._smooth_scalar(
                slot.smooth_crop_x,
                float(x1),
                MANUAL_CROP_SMOOTHING,
                deadzone=MANUAL_PAN_DEADZONE,
                max_step=MANUAL_MAX_PAN_STEP,
            )
            slot.smooth_crop_y = self._smooth_scalar(
                slot.smooth_crop_y,
                float(y1),
                MANUAL_CROP_SMOOTHING,
                deadzone=MANUAL_PAN_DEADZONE * 0.75,
                max_step=MANUAL_MAX_PAN_STEP * 0.8,
            )

        sx1 = int(round(max(0.0, min(slot.smooth_crop_x, frame_w - crop_w))))
        sy1 = int(round(max(0.0, min(slot.smooth_crop_y, frame_h - crop_h))))
        return sx1, sy1, sx1 + crop_w, sy1 + crop_h

    def _face_crop_rect(
        self,
        frame_w: int,
        frame_h: int,
        face: FaceHit,
        zoom: float,
    ) -> tuple[int, int, int, int]:
        fx1, fy1, fx2, fy2 = face.bbox
        margin = self._face_margin(face.bbox)

        zoom = min(zoom, self._max_zoom_for_full_face(face.bbox, frame_w, frame_h))
        zoom = max(MIN_DIGITAL_ZOOM, zoom)

        crop_w = frame_w / zoom
        crop_h = frame_h / zoom

        crop_x1 = face.cx - crop_w / 2.0
        crop_y1 = face.cy - crop_h * FACE_Y_IN_CROP

        if fx1 - margin < 0 or fy1 - margin < 0 or fx2 + margin > frame_w or fy2 + margin > frame_h:
            return 0, 0, frame_w, frame_h

        if fx1 - margin < crop_x1:
            crop_x1 = fx1 - margin
        if fy1 - margin < crop_y1:
            crop_y1 = fy1 - margin
        if fx2 + margin > crop_x1 + crop_w:
            crop_x1 = fx2 + margin - crop_w
        if fy2 + margin > crop_y1 + crop_h:
            crop_y1 = fy2 + margin - crop_h

        crop_x1 = max(0.0, min(crop_x1, frame_w - crop_w))
        crop_y1 = max(0.0, min(crop_y1, frame_h - crop_h))

        if (
            fx1 - margin < crop_x1
            or fx2 + margin > crop_x1 + crop_w
            or fy1 - margin < crop_y1
            or fy2 + margin > crop_y1 + crop_h
        ):
            return 0, 0, frame_w, frame_h

        ix1 = int(round(crop_x1))
        iy1 = int(round(crop_y1))
        ix2 = int(round(min(frame_w, ix1 + crop_w)))
        iy2 = int(round(min(frame_h, iy1 + crop_h)))
        return ix1, iy1, max(ix1 + 1, ix2), max(iy1 + 1, iy2)

    def _draw_target_overlay(
        self,
        crop: np.ndarray,
        bbox: tuple[int, int, int, int],
        crop_rect: tuple[int, int, int, int],
        slot: FocusSlot,
        face: FaceHit | None = None,
    ) -> np.ndarray:
        out = crop.copy()
        cx1, cy1, _cx2, _cy2 = crop_rect

        if face is not None:
            fx1, fy1, fx2, fy2 = face.bbox
            frx1 = max(0, int(fx1 - cx1))
            fry1 = max(0, int(fy1 - cy1))
            frx2 = min(out.shape[1], int(fx2 - cx1))
            fry2 = min(out.shape[0], int(fy2 - cy1))
            face_accent = (90, 230, 255)
            if frx2 > frx1 and fry2 > fry1:
                cv2.rectangle(out, (frx1, fry1), (frx2, fry2), face_accent, 1, cv2.LINE_AA)
            marker_x = max(0, min(out.shape[1] - 1, int(face.cx - cx1)))
            marker_y = max(0, min(out.shape[0] - 1, int(face.cy - cy1)))
            cv2.drawMarker(
                out,
                (marker_x, marker_y),
                face_accent,
                cv2.MARKER_CROSS,
                10,
                1,
                cv2.LINE_AA,
            )
        return out

    def _resize_focus(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        if w <= 0:
            return frame
        out_h = int(FOCUS_OUTPUT_WIDTH * h / w)
        return cv2.resize(frame, (FOCUS_OUTPUT_WIDTH, out_h), interpolation=cv2.INTER_LINEAR)

    def _event_key(self, event: SecurityEvent) -> str:
        return f"{event.event_type}:{event.track_id}:{event.zone_index}:{event.event_id}"

    def _save_evidence(
        self, full_frame: np.ndarray, focus_frame: np.ndarray, event: SecurityEvent
    ) -> list[str]:
        key = self._event_key(event)
        if key in self._saved_evidence_keys:
            return []
        self._saved_evidence_keys.add(key)
        self._incidents_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        et = "loitering" if event.event_type == ZONE_EVENT_LOITERING else "entry"
        zlabel = f"zone{event.zone_index + 1}"
        cam = int(getattr(self, "_current_camera_id", 1))
        base = f"incident_cam{cam}_{stamp}_track{event.track_id}_{zlabel}_{et}"
        full_name = f"{base}_full.jpg"
        focus_name = f"{base}_focus.jpg"
        cv2.imwrite(str(self._incidents_dir / full_name), full_frame)
        cv2.imwrite(str(self._incidents_dir / focus_name), focus_frame)
        return [full_name, focus_name]

    def _update_slot(
        self,
        slot: FocusSlot,
        annotated_frame: np.ndarray,
        tracks: list[Any],
        now: float,
        events: list[SecurityEvent],
        evidence: list[str],
    ) -> np.ndarray | None:
        if slot.mode == MODE_INCIDENT:
            return slot.last_frame
        track = self._find_track(tracks, slot.track_id)
        frame_h, frame_w = annotated_frame.shape[:2]

        if track is not None:
            slot.lost_since = None
            slot.tracking_status = STATUS_ACTIVE
            bbox = getattr(track, "bbox", None)
            if bbox is None:
                return slot.last_frame

            face = self._resolve_face(slot, annotated_frame, bbox, tracks)
            slot.last_face = face
            target_zoom = self._target_zoom_for_face(face.bbox, frame_w, frame_h)

            zoom_rate = MANUAL_ZOOM_SMOOTHING if slot.mode == MODE_MANUAL else ZOOM_SMOOTHING
            if slot.smooth_zoom is None:
                slot.smooth_zoom = target_zoom
            else:
                slot.smooth_zoom += (target_zoom - slot.smooth_zoom) * zoom_rate

            slot.zoom = slot.smooth_zoom
            crop_rect = self._face_crop_rect(frame_w, frame_h, face, slot.smooth_zoom)
            crop_rect = self._smooth_crop_rect(slot, crop_rect, frame_w, frame_h)
            x1, y1, x2, y2 = crop_rect
            crop_w = max(1, x2 - x1)
            slot.zoom = round(min(MAX_DIGITAL_ZOOM, frame_w / crop_w), 1)
            crop = annotated_frame[y1:y2, x1:x2].copy()
            focus_frame = self._resize_focus(
                self._draw_target_overlay(crop, bbox, crop_rect, slot, face)
            )
            slot.last_frame = focus_frame

            for event in events:
                if (
                    int(event.track_id) == slot.track_id
                    and slot.zone_index is not None
                    and int(event.zone_index) == slot.zone_index
                    and event.event_type in (ZONE_EVENT_ENTRY, ZONE_EVENT_LOITERING)
                ):
                    evidence.extend(self._save_evidence(annotated_frame, focus_frame, event))
            return focus_frame

        if slot.lost_since is None:
            slot.lost_since = now
            slot.tracking_status = STATUS_SEARCHING
        elif now - slot.lost_since >= TARGET_LOST_GRACE_SECONDS:
            slot.tracking_status = STATUS_LOST

        if slot.last_frame is not None:
            return slot.last_frame.copy()
        return None

    def _quick_person_focus(
        self,
        annotated_frame: np.ndarray,
        bbox: tuple[int, int, int, int],
    ) -> np.ndarray:
        frame_h, frame_w = annotated_frame.shape[:2]
        x1, y1, x2, y2 = bbox
        bw, bh = max(1, x2 - x1), max(1, y2 - y1)
        pad_x = int(bw * 0.15)
        pad_y = int(bh * 0.1)
        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(frame_w, x2 + pad_x)
        cy2 = min(frame_h, y2 + pad_y)
        crop = annotated_frame[cy1:cy2, cx1:cx2].copy()
        if crop.size == 0:
            return annotated_frame.copy()
        return self._resize_focus(crop)

    def _capture_pending_evidence(
        self,
        annotated_frame: np.ndarray,
        tracks: list[Any],
        events: list[SecurityEvent],
        evidence: list[str],
    ) -> None:
        for event in events:
            if event.event_type not in (ZONE_EVENT_ENTRY, ZONE_EVENT_LOITERING):
                continue
            if self._event_key(event) in self._saved_evidence_keys:
                continue

            focus_frame: np.ndarray | None = None
            sid = self._auto_slot_key(int(event.zone_index))
            slot = self._slots.get(sid)
            if (
                slot is not None
                and slot.last_frame is not None
                and int(slot.track_id) == int(event.track_id)
            ):
                focus_frame = slot.last_frame

            if focus_frame is None:
                track = self._find_track(tracks, int(event.track_id))
                if track is not None:
                    bbox = getattr(track, "bbox", None)
                    if bbox is not None:
                        focus_frame = self._quick_person_focus(annotated_frame, bbox)

            if focus_frame is None:
                focus_frame = annotated_frame.copy()

            evidence.extend(self._save_evidence(annotated_frame, focus_frame, event))

    def update(
        self,
        annotated_frame: np.ndarray,
        tracks: list[Any],
        events: list[SecurityEvent],
        *,
        active_violations: list[tuple[int, int, str]] | None = None,
        now: float | None = None,
        camera_id: int = 1,
    ) -> FocusUpdateResult:
        now = now if now is not None else time.time()
        self._last_now = now
        self._current_camera_id = int(camera_id)
        evidence: list[str] = []

        self._consolidate_legacy_slots()
        if active_violations:
            self.sync_active_violations(active_violations)
        if events:
            self._handle_security_events(events)

        frames: dict[str, np.ndarray] = {}
        for sid, slot in list(self._slots.items()):
            if slot.mode == MODE_INCIDENT:
                if slot.last_frame is not None:
                    frames[sid] = slot.last_frame
                continue
            frame = self._update_slot(slot, annotated_frame, tracks, now, events, evidence)
            if (
                slot.mode != MODE_MANUAL
                and slot.tracking_status == STATUS_LOST
                and slot.lost_since is not None
                and now - slot.lost_since
                >= TARGET_LOST_GRACE_SECONDS + AUTO_RELEASE_AFTER_LOST_SECONDS
            ):
                slot = self._slots.get(sid)
                if slot is not None and slot.zone_index is not None:
                    self._clear_zone_evidence_keys(slot.zone_index)
                self._slots.pop(sid, None)
                continue
            if frame is not None:
                frames[sid] = frame

        if events:
            self._capture_pending_evidence(annotated_frame, tracks, events, evidence)

        return FocusUpdateResult(frames=frames, evidence_saved=evidence)
