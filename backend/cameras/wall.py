from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

WALL_WEBCAM_SLOT = 1
WALL_VIDEO_SLOTS = (2, 3, 4)
WALL_SEARCHING_SLOT = 5
ROAD_CAMERA_ID = 4
WALL_SLOT_IDS = (1, 2, 3, 4, 5)

JPEG_QUALITY = 82
WALL_PLAYBACK_MAX_FPS = 30.0


@dataclass
class VideoSlotState:
    slot_id: int
    path: Path | None = None
    display_name: str | None = None
    fps: float = 0.0
    frame_count: int = 0
    duration: float = 0.0
    latest_frame: np.ndarray | None = field(default=None, repr=False)
    source_frame: np.ndarray | None = field(default=None, repr=False)
    status: str = "offline"
    _cap: cv2.VideoCapture | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _frame_index: int = 0
    _next_read_at: float = 0.0

    def configured(self) -> bool:
        return self.path is not None and self.path.exists()


class CameraWall:

    def __init__(self) -> None:
        self._slots: dict[int, VideoSlotState] = {
            slot_id: VideoSlotState(slot_id=slot_id) for slot_id in WALL_VIDEO_SLOTS
        }

    def get_slot(self, slot_id: int) -> VideoSlotState | None:
        if slot_id in WALL_VIDEO_SLOTS:
            return self._slots[slot_id]
        return None

    def slot_configured(self, slot_id: int) -> bool:
        slot = self.get_slot(slot_id)
        return slot is not None and slot.configured()

    def _reset_slot(self, slot: VideoSlotState) -> None:
        self._release_capture(slot)
        slot.path = None
        slot.display_name = None
        slot.fps = 0.0
        slot.frame_count = 0
        slot.duration = 0.0
        slot.latest_frame = None
        slot.source_frame = None
        slot.status = "offline"
        slot._frame_index = 0
        slot._next_read_at = 0.0

    def clear_slot(self, slot_id: int) -> None:
        if slot_id not in WALL_VIDEO_SLOTS:
            return
        slot = self._slots[slot_id]
        with slot._lock:
            self._reset_slot(slot)

    def assign_upload(self, slot_id: int, path: Path, display_name: str) -> dict[str, Any]:
        if slot_id not in WALL_VIDEO_SLOTS:
            raise ValueError(f"Cannot upload to camera slot {slot_id}")
        slot = self._slots[slot_id]
        with slot._lock:
            self._reset_slot(slot)
            slot.path = path
            slot.display_name = display_name
            if not self._open_capture(slot):
                slot.path = None
                slot.display_name = None
                raise RuntimeError("Could not open uploaded video for playback.")
            slot.status = "playback"
        return {"camera_id": slot_id, "filename": display_name, "stored_as": path.name}

    def read_frame(self, slot_id: int) -> tuple[np.ndarray | None, bool, bool]:
        import time

        slot = self.get_slot(slot_id)
        if slot is None or not slot.configured():
            return None, False, False

        now = time.time()
        native_fps = slot.fps if slot.fps > 0 else WALL_PLAYBACK_MAX_FPS
        max_fps = min(native_fps, WALL_PLAYBACK_MAX_FPS)
        if now < slot._next_read_at:
            with slot._lock:
                if slot.source_frame is not None:
                    return slot.source_frame.copy(), False, False
            return None, False, False
        slot._next_read_at = now + (1.0 / max_fps)

        with slot._lock:
            cap = slot._cap
            if cap is None or not cap.isOpened():
                if not self._open_capture(slot):
                    return None, False, False
                cap = slot._cap
            if cap is None:
                return None, False, False

            looped = False
            ret, frame = cap.read()
            if not ret or frame is None:
                self._seek_start(slot)
                ret, frame = cap.read()
                if not ret or frame is None:
                    return None, False, False
                slot._frame_index = 1
                looped = True
            else:
                slot._frame_index += 1
                if slot.frame_count > 0 and slot._frame_index >= slot.frame_count:
                    looped = True
                    slot._frame_index = 0
                    self._seek_start(slot)

            slot.source_frame = frame.copy()
            slot.latest_frame = frame
            slot.status = "playback"
        return frame, looped, True

    def store_display_frame(self, slot_id: int, frame: np.ndarray) -> None:
        slot = self.get_slot(slot_id)
        if slot is None:
            return
        with slot._lock:
            slot.latest_frame = frame.copy()

    def get_source_frame(self, slot_id: int) -> np.ndarray | None:
        if slot_id in WALL_VIDEO_SLOTS:
            slot = self._slots[slot_id]
            with slot._lock:
                return None if slot.source_frame is None else slot.source_frame.copy()
        return None

    def get_latest_frame(self, slot_id: int) -> np.ndarray | None:
        if slot_id in WALL_VIDEO_SLOTS:
            slot = self._slots[slot_id]
            with slot._lock:
                return None if slot.latest_frame is None else slot.latest_frame.copy()
        return None

    def get_jpeg(self, slot_id: int) -> bytes | None:
        frame = self.get_latest_frame(slot_id)
        if frame is None:
            return None
        ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        )
        return encoded.tobytes() if ok else None

    def configured_slots(self) -> dict[int, bool]:
        return {slot_id: self.slot_configured(slot_id) for slot_id in WALL_VIDEO_SLOTS}

    def stop_all(self) -> None:
        for slot_id in WALL_VIDEO_SLOTS:
            self._release_capture(self._slots[slot_id])

    def seek_slot_start(self, slot_id: int) -> None:
        slot = self.get_slot(slot_id)
        if slot is not None:
            self._seek_start(slot)

    def _open_capture(self, slot: VideoSlotState) -> bool:
        if slot.path is None:
            return False
        self._release_capture(slot)
        cap = cv2.VideoCapture(str(slot.path))
        if not cap.isOpened():
            cap.release()
            return False
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
        slot._cap = cap
        slot.fps = float(fps)
        slot.frame_count = frame_count
        slot.duration = duration
        slot._frame_index = 0
        slot.status = "playback"
        return True

    def _release_capture(self, slot: VideoSlotState) -> None:
        if slot._cap is not None:
            try:
                slot._cap.release()
            except Exception:
                pass
            slot._cap = None

    def _seek_start(self, slot: VideoSlotState) -> None:
        if slot._cap is not None:
            slot._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        slot._frame_index = 0
