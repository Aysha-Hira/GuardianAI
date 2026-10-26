from __future__ import annotations

import logging
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from focus.face_finder import FaceFinder
from recognition.deepface_client import deepface_client
from recognition.match_events import WatchlistMatchEvent
from watchlist.config import (
    FACE_RECOGNITION_INTERVAL_SECONDS,
    MATCH_THRESHOLD,
    MIN_FACE_WIDTH_PX,
)
from watchlist.store import watchlist_store

logger = logging.getLogger("guardian.recognition.track")

TrackKey = tuple[int, int]


@dataclass
class TrackIdentityState:
    camera_id: int
    track_id: int
    identity: str = "Unknown"
    watchlist_id: str | None = None
    distance: float | None = None
    matched: bool = False
    last_checked: float = 0.0
    risk_level: str | None = None
    category: str | None = None
    threshold: float = MATCH_THRESHOLD


class TrackIdentityMatcher:

    def __init__(self, *, incidents_dir: Path | None = None) -> None:
        self._lock = threading.Lock()
        self._face_finder: FaceFinder | None = None
        self._states: dict[TrackKey, TrackIdentityState] = {}
        self._pending: set[TrackKey] = set()
        self._worker_lock = threading.Lock()
        self._incidents_dir = incidents_dir
        self._on_match: Callable[[WatchlistMatchEvent], None] | None = None

    def set_match_handler(
        self, handler: Callable[[WatchlistMatchEvent], None] | None
    ) -> None:
        self._on_match = handler

    def configure(
        self,
        *,
        incidents_dir: Path,
        on_match: Callable[[WatchlistMatchEvent], None] | None = None,
    ) -> None:
        self._incidents_dir = incidents_dir
        self._on_match = on_match

    def reset(self) -> None:
        with self._lock:
            self._states.clear()
            self._pending.clear()

    @staticmethod
    def _key(camera_id: int, track_id: int) -> TrackKey:
        return int(camera_id), int(track_id)

    def _finder(self) -> FaceFinder:
        if self._face_finder is None:
            self._face_finder = FaceFinder()
        return self._face_finder

    def _should_check(self, state: TrackIdentityState | None, now: float) -> bool:
        if state is None:
            return True
        interval = FACE_RECOGNITION_INTERVAL_SECONDS
        if state.matched:
            interval = max(interval, 8.0)
        return (now - state.last_checked) >= interval

    @staticmethod
    def _attach_identities(
        summaries: list[dict[str, Any]],
        states: dict[TrackKey, TrackIdentityState],
        camera_id: int,
    ) -> list[dict[str, Any]]:
        enriched: list[dict[str, Any]] = []
        cam_id = int(camera_id)
        for item in summaries:
            tid = int(item.get("track_id", -1))
            state = states.get((cam_id, tid))
            out = dict(item)
            out["camera_id"] = cam_id
            if state is not None and state.matched:
                out["identity"] = state.identity
                out["identity_matched"] = True
                out["watchlist_id"] = state.watchlist_id
                out["watchlist_name"] = state.identity
                out["risk_level"] = state.risk_level
                out["match_distance"] = state.distance
                out["match_threshold"] = state.threshold
            else:
                out["identity"] = "Unknown"
                out["identity_matched"] = False
            enriched.append(out)
        return enriched

    def enrich_summaries(
        self,
        frame: np.ndarray,
        tracks: list,
        summaries: list[dict[str, Any]],
        *,
        camera_id: int,
        now: float | None = None,
    ) -> list[dict[str, Any]]:
        now = now if now is not None else time.time()
        cam_id = int(camera_id)

        with self._lock:
            states_snapshot = dict(self._states)

        if not watchlist_store.has_entries():
            return self._attach_identities(summaries, states_snapshot, cam_id)

        if not deepface_client.live_matching_enabled():
            return self._attach_identities(summaries, states_snapshot, cam_id)

        if frame is None or frame.size == 0 or not tracks:
            return self._attach_identities(summaries, states_snapshot, cam_id)

        visible_keys = {
            self._key(cam_id, int(getattr(t, "track_id", -1))) for t in tracks
        }
        with self._lock:
            for key in list(self._states.keys()):
                if key[0] == cam_id and key not in visible_keys:
                    del self._states[key]
                    self._pending.discard(key)

        finder = self._finder()
        scanned_faces = finder.scan_faces(frame)
        for track in tracks:
            tid = int(track.track_id)
            key = self._key(cam_id, tid)
            with self._lock:
                state = self._states.get(key)
                pending = key in self._pending
            if pending or not self._should_check(state, now):
                continue
            face = finder.find_face(frame, track.bbox)
            if face is None and scanned_faces:
                face = finder.face_for_track(scanned_faces, tracks, tid)
            if face is None and scanned_faces:
                face = finder.pick_face_for_focus(
                    scanned_faces,
                    track.bbox,
                    frame.shape[1],
                    frame.shape[0],
                    strict=False,
                )
            if face is None or face.confidence < 0.45:
                continue
            fx1, fy1, fx2, fy2 = face.bbox
            if (fx2 - fx1) < MIN_FACE_WIDTH_PX:
                continue
            self._schedule_match(cam_id, tid, frame, face.bbox, now)

        with self._lock:
            return self._attach_identities(summaries, dict(self._states), cam_id)

    def _schedule_match(
        self,
        camera_id: int,
        track_id: int,
        frame: np.ndarray,
        face_bbox: tuple[int, int, int, int],
        now: float,
    ) -> None:
        key = self._key(camera_id, track_id)
        with self._lock:
            if key in self._pending:
                return
            self._pending.add(key)
            state = self._states.get(key)
            if state is None:
                self._states[key] = TrackIdentityState(
                    camera_id=camera_id,
                    track_id=track_id,
                    last_checked=now,
                )
            else:
                state.last_checked = now

        x1, y1, x2, y2 = face_bbox
        pad_x = int((x2 - x1) * 0.08)
        pad_y = int((y2 - y1) * 0.08)
        h, w = frame.shape[:2]
        crop = frame[
            max(0, y1 - pad_y) : min(h, y2 + pad_y),
            max(0, x1 - pad_x) : min(w, x2 + pad_x),
        ].copy()

        def run() -> None:
            try:
                self._run_match(camera_id, track_id, crop, now)
            finally:
                with self._lock:
                    self._pending.discard(key)

        threading.Thread(
            target=run,
            daemon=True,
            name=f"face-match-c{camera_id}-t{track_id}",
        ).start()

    def _save_face_snapshot(
        self,
        camera_id: int,
        track_id: int,
        watchlist_id: str,
        crop: np.ndarray,
    ) -> str | None:
        if self._incidents_dir is None or crop.size == 0:
            return None
        self._incidents_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_id = watchlist_id.replace("/", "_")
        filename = f"watchlist_{safe_id}_cam{int(camera_id)}_track{int(track_id)}_{stamp}_face.jpg"
        path = self._incidents_dir / filename
        if not cv2.imwrite(str(path), crop):
            return None
        return filename

    def _run_match(
        self,
        camera_id: int,
        track_id: int,
        crop: np.ndarray,
        now: float,
    ) -> None:
        if crop.size == 0:
            return
        key = self._key(camera_id, track_id)
        tmp_path: Path | None = None
        try:
            with self._lock:
                prev = self._states.get(key)

            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            if not cv2.imwrite(str(tmp_path), crop):
                return
            with self._worker_lock:
                resp = deepface_client.represent(tmp_path)
            if not resp.get("ok"):
                return
            match = watchlist_store.match_embedding(resp["embedding"])
            state = TrackIdentityState(
                camera_id=camera_id,
                track_id=track_id,
                last_checked=now,
            )
            if match and match.get("matched"):
                state.identity = str(match["name"])
                state.watchlist_id = match.get("watchlist_id")
                state.distance = match.get("distance")
                state.risk_level = match.get("risk_level")
                state.category = match.get("category")
                state.matched = True
                state.threshold = float(match.get("threshold", MATCH_THRESHOLD))
                logger.info(
                    "CCTV %s track #%s matched watchlist %s (distance=%s, threshold=%s)",
                    camera_id,
                    track_id,
                    state.identity,
                    state.distance,
                    state.threshold,
                )
                already_alerted = (
                    prev is not None
                    and prev.matched
                    and prev.watchlist_id == state.watchlist_id
                )
                if not already_alerted and self._on_match and state.watchlist_id:
                    face_file = self._save_face_snapshot(
                        camera_id,
                        track_id,
                        state.watchlist_id,
                        crop,
                    )
                    if face_file:
                        self._on_match(
                            WatchlistMatchEvent(
                                camera_id=camera_id,
                                track_id=track_id,
                                watchlist_id=state.watchlist_id,
                                watchlist_name=state.identity,
                                category=str(state.category or "general"),
                                risk_level=str(state.risk_level or "medium"),
                                distance=float(state.distance or 0.0),
                                threshold=state.threshold,
                                face_snapshot=face_file,
                                timestamp=now,
                            )
                        )
            else:
                state.identity = "Unknown"
                state.matched = False
                if match:
                    state.distance = match.get("distance")
                    state.threshold = float(match.get("threshold", MATCH_THRESHOLD))
                    logger.debug(
                        "CCTV %s track #%s no watchlist match (distance=%s, threshold=%s)",
                        camera_id,
                        track_id,
                        state.distance,
                        state.threshold,
                    )
            with self._lock:
                self._states[key] = state
        except Exception as exc:
            logger.debug("CCTV %s track #%s face match failed: %s", camera_id, track_id, exc)
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)


track_identity_matcher = TrackIdentityMatcher()
