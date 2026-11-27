from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from detection import DETECT_VEHICLES, detect_objects
from tracking.tracker import PersonTracker, TrackResult
from zones.restricted_zone import (
    SOURCE_WEBCAM,
    NormalizedZone,
    RestrictedZoneManager,
    SecurityEvent,
)

logger = logging.getLogger("guardian.frame_processor")

# BGR colours
COLOR_NORMAL = (80, 200, 80)
COLOR_IN_ZONE = (0, 165, 255)
COLOR_LOITERING = (60, 60, 230)
COLOR_VEHICLE = (230, 170, 60)
COLOR_ZONE = (60, 60, 230)

LITE_IMGSZ = 480


@dataclass
class ProcessResult:
    annotated: np.ndarray
    tracks: list[TrackResult] = field(default_factory=list)
    people_count: int = 0
    vehicle_count: int = 0
    active_track_count: int = 0
    track_summaries: list[dict[str, Any]] = field(default_factory=list)
    zone_events: list[SecurityEvent] = field(default_factory=list)
    active_violations: list[tuple[int, int, str]] = field(default_factory=list)
    display_scale: float = 1.0


class FrameProcessor:
    def __init__(self, channel_id: int = 1, source_type: str = SOURCE_WEBCAM) -> None:
        self.channel_id = channel_id
        self._model = None
        self._person_tracker = PersonTracker(kind="person")
        self._zones = RestrictedZoneManager(channel_id, source_type)
        self._zones.set_active_source(source_type)
        self._zones_editing = False
        self._last_tracks: list[TrackResult] = []
        self._last_summaries: list[dict[str, Any]] = []
        self._warned_no_model = False
        self._vehicle_tracker = None
    # ------------------------------------------------------------------ setup

    def set_model(self, model) -> None:
        self._model = model

    def reset_tracker(self) -> None:
        self._person_tracker.reset()
        if self._vehicle_tracker is not None:
            self._vehicle_tracker.reset()
        self._last_tracks = []
        self._last_summaries = []

    def set_show_trails(self, enabled: bool) -> None:
        self._person_tracker.set_show_trails(enabled)
        if self._vehicle_tracker is not None:
            self._vehicle_tracker.set_show_trails(enabled)

    def get_settings(self) -> dict[str, Any]:
        return {
            "show_trails": self._person_tracker.show_trails,
            "loitering_threshold_seconds": round(self._zones.loitering_threshold_seconds, 1),
        }

    # ------------------------------------------------------------------ zones

    def set_active_source(self, source: str) -> None:
        self._zones.set_active_source(source)

    def get_zones(self, source: str | None = None) -> list[dict[str, float]]:
        return self._zones.get_zones(source)

    def set_zones(
        self, zones: list[dict], source: str | None = None, *, reset_states: bool = True
    ) -> list[dict]:
        return self._zones.set_zones(zones, source, reset_states=reset_states)

    def clear_zones(self, source: str | None = None) -> None:
        self._zones.clear_zones(source)

    def set_zones_editing(self, active: bool) -> None:
        self._zones_editing = bool(active)

    def reset_zone_states(self) -> None:
        self._zones.reset_track_states()

    def set_loitering_threshold(self, seconds: float) -> float:
        return self._zones.set_loitering_threshold(seconds)

    def recent_zone_events(self) -> list[dict[str, Any]]:
        return self._zones.recent_events()

    # ------------------------------------------------------------------ pipeline

    def process_frame(
        self,
        frame: np.ndarray,
        *,
        now: float | None = None,
        draw_boxes: bool = True,
        lite: bool = False,
        preview: bool = False,
    ) -> ProcessResult:
        now = now if now is not None else time.time()
        if self._model is None:
            if not self._warned_no_model:
                logger.warning(
                    "FrameProcessor has no model yet; returning the raw frame")
                self._warned_no_model = True
            return ProcessResult(annotated=frame.copy())

        frame_h, frame_w = frame.shape[:2]
        try:
            detections = detect_objects(
                self._model, frame, imgsz=LITE_IMGSZ if lite else None
            )
        except Exception:
            logger.exception(
                "YOLO inference failed on channel %s", self.channel_id)
            detections = []

        person_dets = [d for d in detections if d[5] == "person"]
        vehicle_dets = [d for d in detections if d[5] != "person"]

        tracks = list(self._person_tracker.update(
            frame, person_dets, timestamp=now))
        summaries = list(self._person_tracker.get_track_summaries(tracks))
        if self._vehicle_tracker is not None:
            v_tracks = list(self._vehicle_tracker.update(
                frame, vehicle_dets, timestamp=now))
            summaries += self._vehicle_tracker.get_track_summaries(v_tracks)
            tracks += v_tracks

        events: list[SecurityEvent] = []
        if not self._zones_editing:
            events = self._zones.update_tracks(tracks, frame_w, frame_h, now)
            # zone state changed on the track objects; refresh summaries with it
            summaries = list(self._person_tracker.get_track_summaries(
                [t for t in tracks if t.class_name == "person"]
            ))
            if self._vehicle_tracker is not None:
                summaries += self._vehicle_tracker.get_track_summaries(
                    [t for t in tracks if t.class_name != "person"]
                )

        self._last_tracks = tracks
        self._last_summaries = summaries
        return self._build_result(frame, tracks, summaries, events, draw_boxes, preview)

    def render_tracked_display(
        self,
        frame: np.ndarray,
        *,
        now: float | None = None,
        draw_boxes: bool = True,
        preview: bool = False,
    ) -> ProcessResult:
        return self._build_result(
            frame, self._last_tracks, self._last_summaries, [], draw_boxes, preview
        )

    # ------------------------------------------------------------------ drawing

    def _build_result(
        self,
        frame: np.ndarray,
        tracks: list[TrackResult],
        summaries: list[dict[str, Any]],
        events: list[SecurityEvent],
        draw_boxes: bool,
        preview: bool,
    ) -> ProcessResult:
        annotated = frame.copy()
        self._draw_zones(annotated)
        if draw_boxes:
            self._draw_tracks(annotated, tracks, preview)
        people = sum(1 for t in tracks if t.class_name ==
                     "person" and not t.coasting)
        vehicles = sum(1 for t in tracks if t.class_name !=
                       "person" and not t.coasting)
        return ProcessResult(
            annotated=annotated,
            tracks=tracks,
            people_count=people,
            vehicle_count=vehicles,
            active_track_count=len(tracks),
            track_summaries=summaries,
            zone_events=events,
            active_violations=self._zones.get_active_violations(),
            display_scale=1.0,
        )

    def _draw_zones(self, img: np.ndarray) -> None:
        zones = self._zones.get_zones()
        if not zones:
            return
        h, w = img.shape[:2]
        overlay = img.copy()
        for raw in zones:
            x1, y1, x2, y2 = NormalizedZone.from_dict(raw).pixel_rect(w, h)
            cv2.rectangle(overlay, (x1, y1), (x2, y2), COLOR_ZONE, -1)
        cv2.addWeighted(overlay, 0.15, img, 0.85, 0, dst=img)
        for raw in zones:
            x1, y1, x2, y2 = NormalizedZone.from_dict(raw).pixel_rect(w, h)
            cv2.rectangle(img, (x1, y1), (x2, y2), COLOR_ZONE, 2)

    def _draw_tracks(self, img: np.ndarray, tracks: list[TrackResult], preview: bool) -> None:
        thickness = 1 if preview else 2
        for t in tracks:
            x1, y1, x2, y2 = t.bbox
            if t.class_name != "person":
                color = COLOR_VEHICLE
            elif t.loitering_detected:
                color = COLOR_LOITERING
            elif t.in_zone:
                color = COLOR_IN_ZONE
            else:
                color = COLOR_NORMAL
            cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
            if self._person_tracker.show_trails and len(t.trail) > 1:
                cv2.polylines(
                    img, [np.array(t.trail, dtype=np.int32)], False, color, 1)
            if preview:
                cv2.putText(
                    img, f"#{t.track_id}", (x1 + 2, max(12, y1 - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA,
                )
                continue
            label = f"ID {t.track_id}"
            if t.loitering_detected:
                label += " LOITERING"
            elif t.in_zone:
                label += f" {t.inside_zone_duration:.0f}s"
            (tw, th), _ = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            top = max(0, y1 - th - 6)
            cv2.rectangle(img, (x1, top), (x1 + tw +
                          6, top + th + 6), color, -1)
            cv2.putText(
                img, label, (x1 + 3, top + th + 1),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA,
            )
