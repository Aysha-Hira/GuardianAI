from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

WALL_WEBCAM_SLOT = 1
WALL_VIDEO_SLOTS = (2, 3, 4)
WALL_SEARCHING_SLOT = 5
ROAD_CAMERA_ID = 4
WALL_SLOT_IDS = (1, 2, 3, 4, 5)

JPEG_QUALITY = 82
WALL_PLAYBACK_MAX_FPS = 30.0


class _LiveReader:
    def __init__(self, url: str) -> None:
        self._url = url
        self._frame: np.ndarray | None = None
        self._seq = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _open(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(
            self._url,
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 3000,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000,
            ],
        )
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _run(self) -> None:
        cap = self._open()
        while not self._stop.is_set():
            ok, frame = cap.read() if cap.isOpened() else (False, None)
            if not ok or frame is None:
                cap.release()
                if self._stop.wait(2.0):
                    break
                cap = self._open()
                continue
            with self._lock:
                self._frame = frame
                self._seq += 1
        cap.release()

    def latest(self) -> tuple[np.ndarray | None, int]:
        with self._lock:
            return self._frame, self._seq

    def stop(self) -> None:
        self._stop.set()


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
    live_url: str | None = None
    _reader: Any = field(default=None, repr=False)
    _last_seq: int = 0
    _live_started_at: float = 0.0

    def configured(self) -> bool:
        if self.live_url is not None:
            return True
        return self.path is not None and self.path.exists()

    def playback_position(self) -> float:
        if self.live_url is not None:
            return time.time() - self._live_started_at
        return self._frame_index / self.fps if self.fps > 0 else 0.0


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
        slot.live_url = None
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
        slot._last_seq = 0

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
                raise RuntimeError(
                    "Could not open uploaded video for playback.")
            slot.status = "playback"
        return {"camera_id": slot_id, "filename": display_name, "stored_as": path.name}

    def assign_live(self, slot_id: int, url: str, display_name: str) -> dict[str, Any]:
        if slot_id not in WALL_VIDEO_SLOTS:
            raise ValueError(f"Cannot assign a live stream to slot {slot_id}")
        slot = self._slots[slot_id]
        with slot._lock:
            self._reset_slot(slot)
            slot.live_url = url
            slot.display_name = display_name
            slot._live_started_at = time.time()
            slot._reader = _LiveReader(url)
            slot.status = "playback"
        return {"camera_id": slot_id, "filename": display_name}

    def read_frame(self, slot_id: int) -> tuple[np.ndarray | None, bool, bool]:
        slot = self.get_slot(slot_id)
        if slot is None or not slot.configured():
            return None, False, False

        if slot.live_url is not None:
            reader = slot._reader
            frame, seq = reader.latest() if reader else (None, 0)
            if frame is None:
                return None, False, False
            is_new = seq != slot._last_seq
            slot._last_seq = seq
            if is_new:
                with slot._lock:
                    slot.source_frame = frame.copy()
                    slot.latest_frame = frame
                    slot.status = "playback"
            return frame, False, is_new

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
        if slot._reader is not None:
            slot._reader.stop()
            slot._reader = None
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
