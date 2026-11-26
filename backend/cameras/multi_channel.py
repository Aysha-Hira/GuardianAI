from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from detection import load_model
from frame_processor import FrameProcessor, ProcessResult
from zones.restricted_zone import SOURCE_WEBCAM

MONITOR_AI_MAX_FPS = 30.0
WALL_AI_MAX_FPS = 8.0
SINGLE_AI_MAX_FPS = 30.0

WALL_JPEG_WIDTH = 960
WALL_JPEG_QUALITY = 82
MONITOR_WALL_JPEG_WIDTH = 1280
MONITOR_WALL_JPEG_QUALITY = 88
WALL_JPEG_MAX_FPS = 24.0


@dataclass
class ChannelRuntime:
    channel_id: int
    processor: FrameProcessor
    source_type: str = SOURCE_WEBCAM
    ai_enabled: bool = True
    show_boxes: bool = True
    display_frame: np.ndarray | None = field(default=None, repr=False)
    wall_jpeg: bytes | None = field(default=None, repr=False)
    wall_jpeg_version: int = 0
    people_count: int = 0
    vehicle_count: int = 0
    active_track_count: int = 0
    track_summaries: list[dict] = field(default_factory=list)
    fps: float = 0.0
    last_process_at: float = 0.0
    last_wall_jpeg_at: float = 0.0
    playback_position: float = 0.0
    video_filename: str | None = None 

    def label(self) -> str:
        return self.video_filename or f"Camera {self.channel_id}"


class MultiChannelManager:

    def __init__(self) -> None:
        self._model = None
        self.monitor_channel_id: int | None = None
        self._bg_yolo_turn = 0
        self._bg_yolo_done_this_pass = False
        self._channels: dict[int, ChannelRuntime] = {}

    def add_channel(self, camera_id: int, source_type: str, name: str) -> ChannelRuntime:
        channel = ChannelRuntime(
            channel_id=camera_id,
            processor=FrameProcessor(camera_id, source_type),
            source_type=source_type,
            video_filename=name,
        )
        if self._model is not None:
            channel.processor.set_model(self._model)
        self._channels[camera_id] = channel
        if self.monitor_channel_id is None:
            self.monitor_channel_id = camera_id
        return channel

    def remove_channel(self, camera_id: int) -> None:
        self._channels.pop(camera_id, None)
        if self.monitor_channel_id == camera_id:
            self.monitor_channel_id = next(iter(self._channels), None)

    def ids(self) -> list[int]:
        return list(self._channels)

    def ensure_model(self) -> None:
        if self._model is None:
            self._model = load_model()
        for channel in self._channels.values():
            channel.processor.set_model(self._model)

    @property
    def model_ready(self) -> bool:
        return self._model is not None

    def get(self, channel_id: int) -> ChannelRuntime | None:
        return self._channels.get(channel_id)

    def processor_for(self, channel_id: int) -> FrameProcessor:
        return self._channels[channel_id].processor

    def set_monitor_channel(self, channel_id: int) -> None:
        if channel_id not in self._channels:
            raise ValueError(f"Unknown channel {channel_id}")
        self.monitor_channel_id = channel_id

    def set_ai_enabled(self, channel_id: int, enabled: bool) -> dict[str, Any]:
        channel = self._channels[channel_id]
        channel.ai_enabled = bool(enabled)
        return {"ok": True, "camera_id": channel_id, "ai_enabled": channel.ai_enabled}

    def set_show_boxes(self, channel_id: int, show: bool) -> dict[str, Any]:
        channel = self._channels[channel_id]
        channel.show_boxes = bool(show)
        return {"ok": True, "camera_id": channel_id, "show_boxes": channel.show_boxes}

    def set_show_trails(self, enabled: bool) -> None:
        for channel in self._channels.values():
            channel.processor.set_show_trails(enabled)

    def set_loitering_threshold(self, seconds: float) -> float:
        value = seconds
        for channel in self._channels.values():
            value = channel.processor.set_loitering_threshold(seconds)
        return value

    def active_ai_channel_count(self) -> int:
        return sum(1 for channel in self._channels.values() if channel.ai_enabled)

    def _background_ai_channels(self) -> list[int]:
        return sorted(
            channel_id for channel_id, channel in self._channels.items()
            if channel.ai_enabled and channel_id != self.monitor_channel_id
        )

    def should_run_ai(self, channel_id: int, active_ai_count: int) -> bool:
        channel = self._channels.get(channel_id)
        if channel is None or not channel.ai_enabled:
            return False
        if active_ai_count <= 1 or channel_id == self.monitor_channel_id:
            return self.should_process(channel_id, active_ai_count)

        background_channels = self._background_ai_channels()
        if channel_id not in background_channels:
            return False
        if self._bg_yolo_done_this_pass:
            return False
        if not self.should_process(channel_id, active_ai_count):
            return False
        return channel_id == background_channels[
            self._bg_yolo_turn % len(background_channels)]

    def begin_pass(self) -> None:
        self._bg_yolo_done_this_pass = False

    def note_background_yolo_ran(self, channel_id: int) -> None:
        background_channels = self._background_ai_channels()
        if channel_id in background_channels:
            self._bg_yolo_turn = (self._bg_yolo_turn +
                                  1) % len(background_channels)
            self._bg_yolo_done_this_pass = True

    def should_process(self, channel_id: int, active_ai_count: int) -> bool:
        channel = self._channels[channel_id]
        if not channel.ai_enabled:
            return False
        if active_ai_count <= 1:
            max_fps = SINGLE_AI_MAX_FPS
        elif channel_id == self.monitor_channel_id:
            max_fps = MONITOR_AI_MAX_FPS
        else:
            max_fps = WALL_AI_MAX_FPS

        now = time.time()
        if now - channel.last_process_at < 1.0 / max_fps:
            return False
        channel.last_process_at = now
        return True

    def should_refresh_wall_jpeg(self, channel_id: int) -> bool:
        channel = self._channels.get(channel_id)
        if channel is None:
            return False
        now = time.time()
        if now - channel.last_wall_jpeg_at < 1.0 / WALL_JPEG_MAX_FPS:
            return False
        channel.last_wall_jpeg_at = now
        return True

    def update_display(self, channel_id: int, frame: np.ndarray) -> None:
        channel = self._channels.get(channel_id)
        if channel is None:
            return
        channel.display_frame = frame
        if self.should_refresh_wall_jpeg(channel_id):
            self._refresh_wall_jpeg(channel)

    @staticmethod
    def _encode_wall_jpeg(
        frame: np.ndarray,
        *,
        max_width: int = WALL_JPEG_WIDTH,
        quality: int = WALL_JPEG_QUALITY,
    ) -> bytes | None:
        height, width = frame.shape[:2]
        if width > max_width:
            scale = max_width / width
            frame = cv2.resize(
                frame,
                (max_width, max(1, int(height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        encoded_ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        return encoded.tobytes() if encoded_ok else None

    def _refresh_wall_jpeg(self, channel: ChannelRuntime) -> None:
        if channel.display_frame is None:
            return
        is_monitor = channel.channel_id == self.monitor_channel_id
        jpeg = self._encode_wall_jpeg(
            channel.display_frame,
            max_width=MONITOR_WALL_JPEG_WIDTH if is_monitor else WALL_JPEG_WIDTH,
            quality=MONITOR_WALL_JPEG_QUALITY if is_monitor else WALL_JPEG_QUALITY,
        )
        if jpeg is not None:
            channel.wall_jpeg = jpeg
            channel.wall_jpeg_version += 1
            channel.last_wall_jpeg_at = time.time()

    def get_wall_jpeg(self, channel_id: int) -> tuple[bytes | None, int]:
        channel = self._channels.get(channel_id)
        if channel is None:
            return None, 0
        return channel.wall_jpeg, channel.wall_jpeg_version

    def get_display_frame(self, channel_id: int) -> np.ndarray | None:
        channel = self._channels.get(channel_id)
        if channel is None or channel.display_frame is None:
            return None
        return channel.display_frame.copy()

    def process_frame(
        self,
        channel_id: int,
        frame: np.ndarray,
        *,
        now: float | None = None,
        lite: bool = False,
        preview: bool = False,
    ) -> ProcessResult | None:
        channel = self._channels[channel_id]

        if not channel.ai_enabled:
            channel.display_frame = frame
            channel.people_count = 0
            channel.vehicle_count = 0
            channel.active_track_count = 0
            channel.track_summaries = []
            self._refresh_wall_jpeg(channel)
            return None

        result = channel.processor.process_frame(
            frame,
            now=now,
            draw_boxes=channel.show_boxes,
            lite=lite,
            preview=preview,
        )
        self._store_result(channel, result)
        self._refresh_wall_jpeg(channel)
        return result

    def render_overlay(
        self,
        channel_id: int,
        frame: np.ndarray,
        *,
        now: float | None = None,
        preview: bool = False,
    ) -> ProcessResult:
        channel = self._channels[channel_id]
        result = channel.processor.render_tracked_display(
            frame, now=now, draw_boxes=channel.show_boxes, preview=preview)
        self._store_result(channel, result)
        if self.should_refresh_wall_jpeg(channel_id):
            self._refresh_wall_jpeg(channel)
        return result

    @staticmethod
    def _store_result(channel: ChannelRuntime, result: ProcessResult) -> None:
        channel.display_frame = result.annotated
        channel.people_count = result.people_count
        channel.vehicle_count = getattr(result, "vehicle_count", 0)
        channel.active_track_count = result.active_track_count
        channel.track_summaries = result.track_summaries

    def channel_meta(self, channel_id: int) -> dict[str, Any]:
        channel = self._channels[channel_id]
        return {
            "id": channel_id,
            "label": channel.label(),
            "type": channel.source_type,
            "available": True,
            "filename": channel.video_filename,
            "status": "online" if channel.wall_jpeg is not None else "searching",
            "active": self.monitor_channel_id == channel_id,
            "ai_enabled": channel.ai_enabled,
            "show_boxes": channel.show_boxes,
            "people_count": channel.people_count,
            "vehicle_count": channel.vehicle_count,
            "active_tracks": channel.active_track_count,
        }
