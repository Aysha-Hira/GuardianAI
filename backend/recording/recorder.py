from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger("guardian.recording")

PRE_ROLL_SECONDS = 5.0
DEFAULT_FPS = 20.0
MIN_FPS = 8.0
MAX_FPS = 30.0

_CODEC_CANDIDATES = ("avc1", "h264", "mp4v") if sys.platform == "darwin" else ("avc1", "mp4v", "MJPG")


@dataclass
class FinalizedClip:
    camera_id: int
    track_id: int
    zone_index: int
    event_type: str
    filename: str


@dataclass
class ClipProcessResult:
    finalized: list[FinalizedClip]
    failed: list[FinalizedClip]


@dataclass
class ClipFinalizeOutcome:
    clip: FinalizedClip
    ok: bool


@dataclass
class _IncidentSession:
    camera_id: int
    track_id: int
    zone_index: int
    event_type: str
    path: Path
    writer: cv2.VideoWriter
    frame_size: tuple[int, int]
    started_at: float = field(default_factory=time.time)


class FrameRingBuffer:

    def __init__(self, max_seconds: float = PRE_ROLL_SECONDS) -> None:
        self._max_seconds = max_seconds
        self._frames: deque[tuple[float, np.ndarray]] = deque()

    def push(self, frame: np.ndarray, ts: float) -> None:
        self._frames.append((ts, frame.copy()))
        cutoff = ts - self._max_seconds
        while self._frames and self._frames[0][0] < cutoff:
            self._frames.popleft()

    def snapshot(self) -> list[tuple[float, np.ndarray]]:
        return [(ts, frame.copy()) for ts, frame in self._frames]


class ClipWriter:
    def __init__(self, path: Path, fps: float, frame_size: tuple[int, int]) -> None:
        self._path = path
        self._fps = min(MAX_FPS, max(MIN_FPS, fps if fps > 0 else DEFAULT_FPS))
        self._size = _even_frame_size(frame_size)
        self._writer = _open_video_writer(path, self._fps, self._size)

    def write(self, frame: np.ndarray) -> None:
        self._writer.write(_normalize_frame(frame, self._size))

    def close(self) -> None:
        self._writer.release()


def _even_frame_size(size: tuple[int, int]) -> tuple[int, int]:
    w, h = size
    return max(2, w - (w % 2)), max(2, h - (h % 2))


def _normalize_frame(frame: np.ndarray, target_size: tuple[int, int]) -> np.ndarray:
    if frame is None or frame.size == 0:
        raise ValueError("Cannot write empty frame to recording")

    if frame.dtype != np.uint8:
        frame = np.clip(frame, 0, 255).astype(np.uint8)

    if frame.ndim == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    elif frame.shape[2] == 4:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
    elif frame.shape[2] != 3:
        frame = frame[:, :, :3]

    target_w, target_h = target_size
    h, w = frame.shape[:2]
    if (w, h) != (target_w, target_h):
        frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)

    return np.ascontiguousarray(frame)


def _open_video_writer(path: Path, fps: float, size: tuple[int, int]) -> cv2.VideoWriter:
    errors: list[str] = []
    for codec in _CODEC_CANDIDATES:
        fourcc = cv2.VideoWriter_fourcc(*codec)
        writer = cv2.VideoWriter(str(path), fourcc, fps, size)
        if writer.isOpened():
            return writer
        errors.append(codec)
        writer.release()

    raise RuntimeError(
        f"Could not open video writer for {path.name} (tried: {', '.join(errors)})"
    )


def finalize_mp4_for_web(path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None or not path.is_file() or path.stat().st_size < 512:
        return

    temp_path = path.with_name(f"{path.stem}.web{path.suffix}")
    cmd = [
        ffmpeg,
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        str(temp_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, check=False, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("ffmpeg transcode failed for %s: %s", path.name, exc)
        temp_path.unlink(missing_ok=True)
        return

    if result.returncode != 0 or not temp_path.is_file() or temp_path.stat().st_size < 512:
        logger.warning(
            "ffmpeg transcode rejected %s: %s",
            path.name,
            result.stderr.decode("utf-8", errors="replace")[:240],
        )
        temp_path.unlink(missing_ok=True)
        return

    temp_path.replace(path)


class RecordingManager:

    def __init__(self, output_dir: Path) -> None:
        self._output_dir = output_dir
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._buffers: dict[int, FrameRingBuffer] = {}
        self._manual_writer: ClipWriter | None = None
        self._manual_path: Path | None = None
        self._manual_started_at: float = 0.0
        self._manual_frame_size: tuple[int, int] | None = None
        self._incidents: dict[tuple[int, int, int], _IncidentSession] = {}

    def status(self) -> dict:
        with self._lock:
            manual = self._manual_writer is not None
            duration = round(time.time() - self._manual_started_at, 1) if manual else 0.0
            return {
                "manual_recording": manual,
                "manual_filename": self._manual_path.name if self._manual_path else None,
                "manual_duration_sec": duration,
                "active_incident_clips": len(self._incidents),
            }

    def start_manual(self) -> dict:
        with self._lock:
            if self._manual_writer is not None:
                return {"ok": True, "already_recording": True, **self.status()}
            stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            path = self._output_dir / f"manual_{stamp}.mp4"
            self._manual_path = path
            self._manual_started_at = time.time()
            self._manual_writer = None
            return {
                "ok": True,
                "filename": path.name,
                "already_recording": False,
            }

    def stop_manual(self) -> dict:
        with self._lock:
            if self._manual_writer is None and self._manual_path is None:
                return {"ok": False, "error": "Not recording"}
            filename = self._manual_path.name if self._manual_path else None
            if self._manual_writer is not None:
                self._manual_writer.close()
            self._manual_writer = None
            self._manual_path = None
            self._manual_started_at = 0.0
            self._manual_frame_size = None
            return {"ok": True, "filename": filename}

    def process_frame(
        self,
        camera_id: int,
        frame: np.ndarray,
        *,
        now: float,
        fps: float,
        zone_events: list,
        active_violations: list[tuple[int, int, str]],
        record_manual: bool = False,
    ) -> ClipProcessResult:
        finalized: list[FinalizedClip] = []
        failed: list[FinalizedClip] = []
        write_fps = max(MIN_FPS, fps)
        cid = int(camera_id)

        with self._lock:
            buffer = self._buffers.setdefault(cid, FrameRingBuffer(PRE_ROLL_SECONDS))
            buffer.push(frame, now)

            for event in zone_events:
                key = (cid, int(event.track_id), int(event.zone_index))
                if key in self._incidents:
                    continue
                self._start_incident_session(key, event, write_fps, buffer)

            active_keys = {(cid, int(tid), int(zidx)) for tid, zidx, _ in active_violations}
            for key in list(self._incidents.keys()):
                if key[0] != cid:
                    continue
                if key not in active_keys:
                    outcome = self._finalize_incident_session(key)
                    if outcome.ok:
                        finalized.append(outcome.clip)
                    else:
                        failed.append(outcome.clip)

            if record_manual:
                if self._manual_writer is None and self._manual_path is not None:
                    self._manual_writer = ClipWriter(
                        self._manual_path, write_fps, self._frame_size(frame)
                    )
                    self._manual_frame_size = self._frame_size(frame)

                if self._manual_writer is not None:
                    self._manual_writer.write(frame)

            for key, session in self._incidents.items():
                if key[0] == cid:
                    session.writer.write(frame)

        return ClipProcessResult(finalized=finalized, failed=failed)

    def finalize_all(self) -> ClipProcessResult:
        finalized: list[FinalizedClip] = []
        failed: list[FinalizedClip] = []
        with self._lock:
            for key in list(self._incidents.keys()):
                outcome = self._finalize_incident_session(key)
                if outcome.ok:
                    finalized.append(outcome.clip)
                else:
                    failed.append(outcome.clip)
        return ClipProcessResult(finalized=finalized, failed=failed)

    def active_incidents(self) -> list[tuple[int, int, int, str]]:
        with self._lock:
            return [
                (session.camera_id, session.track_id, session.zone_index, session.event_type)
                for session in self._incidents.values()
            ]

    @staticmethod
    def _frame_size(frame: np.ndarray) -> tuple[int, int]:
        h, w = frame.shape[:2]
        return _even_frame_size((w, h))

    def _start_incident_session(
        self,
        key: tuple[int, int, int],
        event,
        fps: float,
        buffer: FrameRingBuffer,
    ) -> None:
        camera_id, track_id, zone_index = key
        et = "loitering" if event.event_type == "loitering" else "entry"
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = (
            f"incident_clip_{stamp}_cam{camera_id}_track{track_id}"
            f"_zone{zone_index + 1}_{et}.mp4"
        )
        path = self._output_dir / filename

        pre_frames = buffer.snapshot()
        if not pre_frames:
            return

        frame_size = self._frame_size(pre_frames[-1][1])
        frame_size = _even_frame_size(frame_size)
        writer = ClipWriter(path, fps, frame_size)
        for _, pre_frame in pre_frames:
            writer.write(pre_frame)

        self._incidents[key] = _IncidentSession(
            camera_id=camera_id,
            track_id=track_id,
            zone_index=zone_index,
            event_type=et,
            path=path,
            writer=writer,
            frame_size=frame_size,
        )

    def _finalize_incident_session(self, key: tuple[int, int, int]) -> ClipFinalizeOutcome:
        session = self._incidents.pop(key, None)
        if session is None:
            camera_id, track_id, zone_index = key
            stub = FinalizedClip(camera_id, track_id, zone_index, "entry", "")
            return ClipFinalizeOutcome(clip=stub, ok=False)

        clip = FinalizedClip(
            camera_id=session.camera_id,
            track_id=session.track_id,
            zone_index=session.zone_index,
            event_type=session.event_type,
            filename=session.path.name,
        )
        session.writer.close()
        if not session.path.is_file() or session.path.stat().st_size < 512:
            try:
                session.path.unlink(missing_ok=True)
            except OSError:
                pass
            return ClipFinalizeOutcome(clip=clip, ok=False)
        return ClipFinalizeOutcome(clip=clip, ok=True)
