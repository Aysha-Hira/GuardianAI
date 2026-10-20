from __future__ import annotations

import logging
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from detection import open_webcam, scale_tracks_for_display
from focus.incident_focus import IncidentFocusManager
from alerts.store import AlertStore
from behavior.anomaly_engine import BehaviorAnomalyEvent, get_behavior_engine
from recognition.match_events import WatchlistMatchEvent
from recognition.track_matcher import track_identity_matcher
from recording.recorder import RecordingManager, finalize_mp4_for_web, DEFAULT_FPS
from cameras.multi_channel import MultiChannelManager
from cameras.wall import CameraWall, ROAD_CAMERA_ID, WALL_SEARCHING_SLOT, WALL_VIDEO_SLOTS, WALL_WEBCAM_SLOT

BASE_DIR = Path(__file__).resolve().parent
SNAPSHOTS_DIR = BASE_DIR / "snapshots"
INCIDENTS_DIR = SNAPSHOTS_DIR / "incidents"
RECORDINGS_DIR = SNAPSHOTS_DIR / "recordings"
UPLOADS_DIR = BASE_DIR / "uploads"
TEST_VIDEOS_DIR = BASE_DIR / "test_videos"

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

SOURCE_WEBCAM = "webcam"
SOURCE_VIDEO = "video"

PLAYBACK_IDLE = "idle"
PLAYBACK_PLAYING = "playing"
PLAYBACK_PAUSED = "paused"
PLAYBACK_COMPLETE = "complete"
PLAYBACK_STOPPED = "stopped"

MAX_CONSECUTIVE_FAILURES = 20
CAMERA_INDICES = (0, 1)
RECONNECT_PAUSE_SEC = 0.8
RETRY_WHILE_OFFLINE_SEC = 0.75

logger = logging.getLogger("guardian.media")


def _format_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _safe_upload_name(original: str) -> str:
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type '{ext or 'unknown'}'. Use MP4, AVI, or MOV.")
    token = secrets.token_hex(4)
    return f"cctv_{token}{ext}"


class MediaService:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

        self._multi = MultiChannelManager()
        self._wall = CameraWall()
        self._incident_focus_by_channel: dict[int, IncidentFocusManager] = {}
        self._alert_store = AlertStore()
        self._recorder = RecordingManager(RECORDINGS_DIR)

        self._source_type = SOURCE_WEBCAM
        self._webcam_cap: cv2.VideoCapture | None = None
        self._camera_index: int | None = None

        self._active = False
        self._people_count = 0
        self._vehicle_count = 0
        self._fps = 0.0
        self._width = 0
        self._height = 0
        self._latest_frame: np.ndarray | None = None
        self._latest_source_frame: np.ndarray | None = None
        self._latest_focus_frame: np.ndarray | None = None
        self._focus_frames: dict[str, np.ndarray] = {}
        self._focus_status: dict = {"active": False, "focuses": []}
        self._last_evidence_files: list[str] = []
        self._active_tracks: list[dict] = []
        self._active_track_count = 0
        self._last_focus_tracks: list = []
        self._error: str | None = None

        self._video_fps = 0.0
        self._video_duration = 0.0
        self._playback_state = PLAYBACK_IDLE
        self._playback_position = 0.0
        self._video_paused = False
        self._pending_upload_path: Path | None = None
        self._pending_upload_name: str | None = None
        self._user_upload_path: Path | None = None
        self._video_loop = True

        self._active_camera_id = WALL_WEBCAM_SLOT
        self._active_video_slot: int | None = None
        self._channel_prev_times: dict[int, float] = {}
        self._behavior_frame_indices: dict[int, int] = {}

        track_identity_matcher.configure(
            incidents_dir=INCIDENTS_DIR,
            on_match=self._handle_watchlist_match,
        )

    @property
    def _processor(self):
        return self._multi.processor_for(self._active_camera_id)

    def _incident_focus_for(self, channel_id: int) -> IncidentFocusManager:
        mgr = self._incident_focus_by_channel.get(channel_id)
        if mgr is None:
            mgr = IncidentFocusManager(INCIDENTS_DIR)
            self._incident_focus_by_channel[channel_id] = mgr
        return mgr

    @property
    def _incident_focus(self) -> IncidentFocusManager:
        return self._incident_focus_for(self._active_camera_id)

    def _combined_focus_status(self) -> dict:
        active_id = self._active_camera_id
        order = [active_id] + [c for c in sorted(self._incident_focus_by_channel) if c != active_id]
        focuses: list[dict] = []
        for cid in order:
            mgr = self._incident_focus_by_channel.get(cid)
            if mgr is None:
                continue
            for f in mgr.get_status().get("focuses", []):
                item = dict(f)
                item["camera_id"] = cid
                if cid != active_id and item.get("slot_id"):
                    item["slot_id"] = f"cam{cid}:{item['slot_id']}"
                focuses.append(item)
        status = self._incident_focus.get_status()
        status["focuses"] = focuses
        status["count"] = len(focuses)
        status["active"] = bool(focuses)
        status["label"] = "INCIDENT FOCUS" if focuses else "NO ACTIVE INCIDENT"
        return status

    def _focus_manager_for_slot(self, slot_id: str | None) -> tuple[IncidentFocusManager, str | None]:
        if slot_id and slot_id.startswith("cam") and ":" in slot_id:
            cid, local = slot_id[3:].split(":", 1)
            if cid.isdigit():
                return self._incident_focus_for(int(cid)), local
        return self._incident_focus, slot_id

    def _reset_incident_focus(self) -> None:
        for mgr in self._incident_focus_by_channel.values():
            mgr.reset()
        self._incident_focus_by_channel.clear()

    def _camera2_configured(self) -> bool:
        return self._wall.slot_configured(2)

    def _camera3_configured(self) -> bool:
        return self._wall.slot_configured(3)

    def _camera4_configured(self) -> bool:
        return self._wall.slot_configured(4)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        TEST_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

        self._source_type = SOURCE_WEBCAM
        self._playback_state = PLAYBACK_PLAYING
        self._multi.processor_for(WALL_WEBCAM_SLOT).set_active_source(SOURCE_WEBCAM)
        for slot_id in WALL_VIDEO_SLOTS:
            self._multi.processor_for(slot_id).set_active_source(SOURCE_VIDEO)
        self._reset_incident_focus()

        print("Opening webcam...")
        if not self._try_open_webcam():
            self._active = False
            self._error = "Camera offline — will keep retrying"
            print(f"Camera offline at startup: {self._error}")

        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()

        print("Loading YOLOv11 model...")
        try:
            self._multi.ensure_model()
        except Exception as exc:
            self._error = f"Failed to load YOLO model: {exc}"
            print(self._error)
            return

        print("Media service running (webcam).")

    def stop(self) -> None:
        self.request_stop()
        self._release_all_captures()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._thread = None

        with self._lock:
            self._active = False
            self._latest_frame = None
            self._latest_focus_frame = None
            self._focus_status = {"active": False}
            self._active_tracks = []
            self._active_track_count = 0

        self._wall.stop_all()
        for slot_id in (WALL_WEBCAM_SLOT, *WALL_VIDEO_SLOTS):
            self._multi.processor_for(slot_id).reset_tracker()
        self._reset_incident_focus()
        self.cleanup_user_upload()
        print("Media service stopped.")

    def request_stop(self) -> None:
        self._stop_event.set()

    def is_stopped(self) -> bool:
        return self._stop_event.is_set()

    def get_status(self) -> dict:
        with self._lock:
            status = {
                "source_type": self._source_type,
                "camera_id": self._active_camera_id,
                "camera2_available": self._camera2_configured(),
                "camera3_available": self._camera3_configured(),
                "camera4_available": self._camera4_configured(),
                "camera_active": self._active,
                "people_count": self._people_count,
                "vehicle_count": self._vehicle_count,
                "active_tracks": self._active_track_count,
                "fps": round(self._fps, 1),
                "resolution": f"{self._width}x{self._height}" if self._width else "—",
                "error": self._error,
                "playback_state": self._playback_state,
            }

            if self._source_type == SOURCE_VIDEO:
                slot = self._wall.get_slot(self._active_camera_id) if self._active_camera_id in WALL_VIDEO_SLOTS else None
                display_name = slot.display_name if slot else None
                video_fps = slot.fps if slot else self._video_fps
                video_duration = slot.duration if slot else self._video_duration
                status.update(
                    {
                        "video_filename": display_name,
                        "camera_label": f"CCTV 0{self._active_camera_id} — {display_name or 'Recording'}",
                        "source_fps": round(video_fps, 2) if video_fps else None,
                        "video_duration": round(video_duration, 2),
                        "playback_position": round(self._playback_position, 2),
                        "playback_time": _format_time(self._playback_position),
                        "total_time": _format_time(video_duration),
                        "video_loop": self._video_loop,
                    }
                )
            else:
                status.update(
                    {
                        "video_filename": None,
                        "camera_label": "CCTV 01 — Laptop Camera",
                        "source_fps": None,
                        "video_duration": None,
                        "playback_position": None,
                        "playback_time": None,
                        "total_time": None,
                        "video_loop": False,
                    }
                )

            status["cameras"] = self._build_camera_list()
            zones = self._processor.get_zones()
            status["restricted_zones"] = zones
            status["restricted_zone"] = zones[0] if zones else None
            status["restricted_zone_active"] = len(zones) > 0
            status["restricted_zone_label"] = (
                f"Active ({len(zones)})" if zones else "Not Set"
            )
            status["zone_source"] = self._source_type
            status.update(self._processor.get_settings())
            status["incident_focus"] = dict(self._focus_status)
            status.update(self._recorder.status())
            status["face_recognition"] = self._face_recognition_status()
            from alerts.severity_service import severity_scorer

            status["severity_model"] = severity_scorer.status()
            status["behavior_model"] = self._behavior_status()
            return status

    @staticmethod
    def _behavior_status() -> dict:
        engine = get_behavior_engine()
        return engine.status()

    @staticmethod
    def _face_recognition_status() -> dict:
        from recognition.deepface_client import deepface_client
        from watchlist.config import ENABLE_FACE_RECOGNITION
        from watchlist.store import watchlist_store
        from watchlist.weights import weights_status

        probe = deepface_client.probe()
        wstatus = weights_status()
        return {
            "enabled": ENABLE_FACE_RECOGNITION,
            "available": deepface_client.live_matching_enabled(),
            "watchlist_count": len(watchlist_store.list_entries()),
            "model": wstatus.get("model"),
            "match_threshold": wstatus.get("threshold"),
            "weights_ready": wstatus.get("ready"),
            "engine": probe,
            "weights": wstatus,
        }

    def _reset_track_identities(self) -> None:
        track_identity_matcher.reset()

    def get_zones(self, source: str | None = None) -> list[dict]:
        return self._processor.get_zones(source)

    def set_zones(
        self, zones: list[dict], source: str | None = None, *, reset_states: bool = True
    ) -> dict:
        saved = self._processor.set_zones(zones, source, reset_states=reset_states)
        return {
            "ok": True,
            "restricted_zones": saved,
            "restricted_zone_active": len(saved) > 0,
            "zone_source": source or self._source_type,
        }

    def set_zones_editing(self, active: bool) -> dict:
        self._processor.set_zones_editing(active)
        return {"ok": True, "zones_editing": active}

    def clear_zones(self, source: str | None = None) -> dict:
        self._processor.clear_zones(source)
        self._handle_incident_clip_results(self._recorder.finalize_all())
        return {
            "ok": True,
            "restricted_zones": [],
            "restricted_zone_active": False,
            "zone_source": source or self._source_type,
        }

    def get_zone_events(self) -> list[dict]:
        events: list[dict] = []
        for channel_id in (WALL_WEBCAM_SLOT, *WALL_VIDEO_SLOTS):
            if channel_id in WALL_VIDEO_SLOTS and not self._wall.slot_configured(channel_id):
                continue
            proc = self._multi.processor_for(channel_id)
            for event in proc.recent_zone_events():
                item = dict(event)
                item["camera_id"] = channel_id
                events.append(item)
        events.sort(key=lambda item: int(item.get("event_id", 0)))
        return events

    def set_camera_ai(self, camera_id: int, enabled: bool) -> dict:
        if camera_id not in (WALL_WEBCAM_SLOT, *WALL_VIDEO_SLOTS):
            raise ValueError(f"Invalid camera id {camera_id}")
        return self._multi.set_ai_enabled(camera_id, enabled)

    def set_camera_boxes(self, camera_id: int, show: bool) -> dict:
        if camera_id not in (WALL_WEBCAM_SLOT, *WALL_VIDEO_SLOTS):
            raise ValueError(f"Invalid camera id {camera_id}")
        return self._multi.set_show_boxes(camera_id, show)

    def _build_camera_list(self) -> list[dict]:
        webcam_online = self._webcam_is_open() and self._active
        cameras = [
            self._multi.channel_meta(WALL_WEBCAM_SLOT, webcam_online=webcam_online),
        ]
        for slot_id in WALL_VIDEO_SLOTS:
            cameras.append(
                self._multi.channel_meta(
                    slot_id,
                    wall_slot=self._wall.get_slot(slot_id),
                    webcam_online=False,
                )
            )
        cameras.append(
            {
                "id": WALL_SEARCHING_SLOT,
                "label": "CCTV 05 — Remote Perimeter",
                "type": "searching",
                "available": False,
                "filename": None,
                "status": "searching",
                "active": self._active_camera_id == WALL_SEARCHING_SLOT,
                "ai_enabled": False,
                "show_boxes": False,
                "people_count": 0,
                "vehicle_count": 0,
                "active_tracks": 0,
            }
        )
        return cameras

    def get_settings(self) -> dict:
        return self._processor.get_settings()

    def clear_alerts(self) -> dict:
        removed = self._alert_store.clear_all()
        files_deleted = 0
        for alert in removed:
            for key, folder in (("full_snapshot", INCIDENTS_DIR), ("focus_snapshot", INCIDENTS_DIR), ("incident_clip", RECORDINGS_DIR)):
                name = alert.get(key)
                if not name or "/" in name or "\\" in name or ".." in name:
                    continue
                path = folder / name
                try:
                    if path.is_file():
                        path.unlink()
                        files_deleted += 1
                except OSError:
                    pass
        return {"ok": True, "deleted": len(removed), "files_deleted": files_deleted}

    def get_alerts(
        self,
        *,
        status: str | None = None,
        severity: str | None = None,
        event_type: str | None = None,
        filter_preset: str | None = None,
    ) -> dict:
        alerts = self._alert_store.list_alerts(
            status=status,
            severity=severity,
            event_type=event_type,
            filter_preset=filter_preset,
        )
        alerts = [self._enrich_alert_clip_status(alert) for alert in alerts]
        return {
            "alerts": alerts,
            "new_count": self._alert_store.count_new(),
            "total": len(alerts),
        }

    def _enrich_alert_clip_status(self, alert: dict) -> dict:
        if alert.get("incident_clip"):
            alert["incident_clip_status"] = "ready"
            return alert

        status = alert.get("incident_clip_status") or "none"
        if status in ("processing", "failed"):
            return alert

        active_keys = {
            (cam_id, track_id, zone_index)
            for cam_id, track_id, zone_index, _ in self._recorder.active_incidents()
        }
        cam = int(alert.get("camera_id") or self._active_camera_id)
        if (cam, int(alert.get("track_id", -1)), int(alert.get("zone_index", -1))) in active_keys:
            alert["incident_clip_status"] = "recording"
        elif status == "recording":
            alert["incident_clip_status"] = "failed"
        return alert

    def _handle_incident_clip_results(self, result) -> None:
        for clip in result.finalized:
            self._queue_incident_clip_finalize(clip)
        for clip in result.failed:
            self._alert_store.set_incident_clip_status(
                clip.camera_id,
                clip.track_id,
                clip.zone_index,
                clip.event_type,
                "failed",
            )

    def get_alert(self, alert_id: str) -> dict | None:
        alert = self._alert_store.get_alert(alert_id)
        if alert is None:
            return None
        alert = self._enrich_alert_clip_status(alert)
        with self._lock:
            active_ids = {int(t.get("track_id", -1)) for t in self._active_tracks}
        alert["track_active"] = int(alert.get("track_id", -1)) in active_ids
        return alert

    def _queue_incident_clip_finalize(self, clip) -> None:
        self._alert_store.set_incident_clip_status(
            clip.camera_id,
            clip.track_id,
            clip.zone_index,
            clip.event_type,
            "processing",
        )
        threading.Thread(
            target=self._finalize_and_attach_clip,
            args=(
                clip.camera_id,
                clip.track_id,
                clip.zone_index,
                clip.event_type,
                clip.filename,
            ),
            daemon=True,
        ).start()

    def _finalize_and_attach_clip(
        self,
        camera_id: int,
        track_id: int,
        zone_index: int,
        event_type: str,
        filename: str,
    ) -> None:
        path = RECORDINGS_DIR / filename
        try:
            finalize_mp4_for_web(path)
            if path.is_file() and path.stat().st_size >= 512:
                self._alert_store.attach_incident_clip(
                    camera_id,
                    track_id,
                    zone_index,
                    event_type,
                    filename,
                )
            else:
                self._alert_store.set_incident_clip_status(
                    camera_id, track_id, zone_index, event_type, "failed"
                )
        except Exception:
            self._alert_store.set_incident_clip_status(
                camera_id, track_id, zone_index, event_type, "failed"
            )

    def update_alert_status(self, alert_id: str, status: str) -> dict:
        return self._alert_store.update_status(alert_id, status)

    def _alert_source_context(
        self, channel_id: int | None = None
    ) -> tuple[str, str, str | None, str | None]:
        cid = channel_id if channel_id is not None else self._active_camera_id
        channel = self._multi.get(cid)
        if channel is None:
            return "CCTV — Unknown", SOURCE_WEBCAM, None, None
        if channel.source_type == SOURCE_VIDEO:
            camera = f"CCTV {cid:02d} — {channel.video_filename or 'Recording'}"
            return camera, SOURCE_VIDEO, channel.video_filename, _format_time(channel.playback_position)
        return channel.label(), SOURCE_WEBCAM, None, None

    @staticmethod
    def _evidence_for_event(
        event,
        evidence_files: list[str],
        *,
        camera_id: int | None = None,
    ) -> tuple[str | None, str | None]:
        tid = int(event.track_id)
        zlabel = f"zone{int(event.zone_index) + 1}"
        et = "loitering" if event.event_type == "loitering" else "entry"
        cam_tag = f"cam{int(camera_id)}_" if camera_id is not None else None
        full_name: str | None = None
        focus_name: str | None = None
        for fname in evidence_files:
            if cam_tag and cam_tag not in fname:
                continue
            if f"track{tid}" not in fname or zlabel not in fname or et not in fname:
                continue
            if fname.endswith("_full.jpg"):
                full_name = fname
            elif fname.endswith("_focus.jpg"):
                focus_name = fname
        return full_name, focus_name

    def _save_behavior_snapshot(self, camera_id: int, frame: np.ndarray) -> str | None:
        INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"behavior_anomaly_cam{int(camera_id)}_{stamp}.jpg"
        path = INCIDENTS_DIR / filename
        if cv2.imwrite(str(path), frame):
            return filename
        return None

    def _handle_behavior_anomaly(self, event: BehaviorAnomalyEvent) -> None:
        try:
            cam_id = int(event.camera_id)
        except ValueError:
            cam_id = self._active_camera_id
        camera, source_type, video_filename, video_time = self._alert_source_context(cam_id)
        channel = self._multi.get(cam_id)
        people_count = channel.people_count if channel is not None else 0

        snapshot_name = None
        if event.snapshot is not None:
            snapshot_name = self._save_behavior_snapshot(cam_id, event.snapshot)

        alert = self._alert_store.create_from_behavior_anomaly(
            camera=camera,
            source_type=source_type,
            camera_id=cam_id,
            anomaly_score=event.score,
            anomaly_threshold=event.threshold,
            focus_snapshot=snapshot_name,
            video_filename=video_filename,
            video_time=video_time if source_type == SOURCE_VIDEO else None,
            wall_now=time.time(),
            people_count=people_count,
        )
        if alert is None:
            return

        logger.info(
            "Behavior anomaly alert %s — CCTV %s score=%.5f threshold=%.5f",
            alert.id,
            cam_id,
            event.score,
            event.threshold,
        )

    def _process_behavior_anomaly(self, channel_id: int, frame: np.ndarray) -> None:
        engine = get_behavior_engine()
        if not engine.available:
            return
        idx = self._behavior_frame_indices.get(channel_id, 0) + 1
        self._behavior_frame_indices[channel_id] = idx
        event = engine.process_frame(str(channel_id), frame, idx)
        if event is not None:
            self._handle_behavior_anomaly(event)

    def _handle_watchlist_match(self, event: WatchlistMatchEvent) -> None:
        camera, source_type, video_filename, video_time = self._alert_source_context(
            event.camera_id
        )
        with self._lock:
            track_summary = next(
                (
                    t
                    for t in self._active_tracks
                    if int(t.get("track_id", -1)) == event.track_id
                ),
                None,
            )
        channel = self._multi.get(event.camera_id)
        people_count = channel.people_count if channel is not None else 0
        if track_summary is None and channel is not None:
            track_summary = next(
                (
                    s
                    for s in channel.track_summaries
                    if int(s.get("track_id", -1)) == event.track_id
                ),
                None,
            )
        alert = self._alert_store.create_from_watchlist_match(
            camera=camera,
            source_type=source_type,
            camera_id=event.camera_id,
            track_id=event.track_id,
            watchlist_id=event.watchlist_id,
            watchlist_name=event.watchlist_name,
            watchlist_category=event.category,
            risk_level=event.risk_level,
            distance=event.distance,
            threshold=event.threshold,
            face_snapshot=event.face_snapshot,
            video_filename=video_filename,
            video_time=video_time if source_type == SOURCE_VIDEO else None,
            wall_now=event.timestamp,
            people_count=people_count,
            track_summary=track_summary,
        )
        if alert is None:
            return

        logger.info(
            "Watchlist alert %s — %s on CCTV %s track #%s",
            alert.id,
            event.watchlist_name,
            event.camera_id,
            event.track_id,
        )

        if event.camera_id != self._active_camera_id:
            return

        seed_bbox = None
        frame = None
        tracks: list = []
        with self._lock:
            for track in self._last_focus_tracks:
                if int(getattr(track, "track_id", -1)) == event.track_id:
                    seed_bbox = getattr(track, "bbox", None)
                    break
            if self._latest_frame is not None:
                frame = self._latest_frame.copy()
            tracks = list(self._last_focus_tracks)

        focus_mgr = self._incident_focus_for(event.camera_id)
        self._focus_status = focus_mgr.focus_watchlist_match(
            event.track_id,
            event.watchlist_name,
            person_bbox=seed_bbox,
            frame=frame,
            tracks=tracks,
        )

    def _process_security_events_for_alerts(
        self,
        zone_events: list,
        evidence_files: list[str],
        wall_now: float,
        *,
        channel_id: int | None = None,
        people_count: int = 0,
        track_summaries: list[dict] | None = None,
    ) -> None:
        if not zone_events:
            return
        camera, source_type, video_filename, video_time = self._alert_source_context(channel_id)
        cam_id = channel_id if channel_id is not None else self._active_camera_id
        summaries = track_summaries or []
        for event in zone_events:
            full_snap, focus_snap = self._evidence_for_event(
                event, evidence_files, camera_id=cam_id
            )
            track_summary = next(
                (s for s in summaries if int(s.get("track_id", -1)) == int(event.track_id)),
                None,
            )
            self._alert_store.create_from_security_event(
                event,
                camera=camera,
                source_type=source_type,
                camera_id=cam_id,
                video_filename=video_filename,
                video_time=video_time if source_type == SOURCE_VIDEO else None,
                full_snapshot=full_snap,
                focus_snapshot=focus_snap,
                wall_now=wall_now,
                people_count=people_count,
                track_summary=track_summary,
            )
            if full_snap or focus_snap:
                self._alert_store.attach_evidence(
                    int(event.track_id),
                    int(event.zone_index),
                    event.event_type,
                    camera_id=cam_id,
                    full_snapshot=full_snap,
                    focus_snapshot=focus_snap,
                )

    def set_loitering_threshold(self, seconds: float) -> dict:
        value = self._multi.set_loitering_threshold(seconds)
        return {"ok": True, "loitering_threshold_seconds": round(value, 1)}

    def get_focus_status(self) -> dict:
        with self._lock:
            status = dict(self._focus_status)
            if self._last_evidence_files:
                status["evidence_saved"] = list(self._last_evidence_files)
                self._last_evidence_files = []
            return status

    def follow_track(self, track_id: int) -> dict:
        with self._lock:
            seed_bbox = None
            tid = int(track_id)
            for track in self._last_focus_tracks:
                if int(getattr(track, "track_id", -1)) == tid:
                    seed_bbox = getattr(track, "bbox", None)
                    break
            frame = self._latest_frame.copy() if self._latest_frame is not None else None
            tracks = list(self._last_focus_tracks)
            result = self._incident_focus.focus_incident_person_live(
                tid,
                person_bbox=seed_bbox,
                frame=frame,
                tracks=tracks,
            )
            self._focus_status = result
        return {"ok": True, **result}

    def focus_from_alert(self, alert_id: str) -> dict:
        alert = self._alert_store.get_alert(alert_id)
        if alert is None:
            raise KeyError(f"Alert not found: {alert_id}")

        camera_id = int(alert.get("camera_id") or self._active_camera_id)
        if camera_id != self._active_camera_id:
            self.switch_to_camera(camera_id)

        track_id = int(alert["track_id"])
        with self._lock:
            track_active = any(
                int(getattr(track, "track_id", -1)) == track_id
                for track in self._last_focus_tracks
            )
            if track_active:
                seed_bbox = None
                for track in self._last_focus_tracks:
                    if int(getattr(track, "track_id", -1)) == track_id:
                        seed_bbox = getattr(track, "bbox", None)
                        break
                frame = self._latest_frame.copy() if self._latest_frame is not None else None
                tracks = list(self._last_focus_tracks)
                result = self._incident_focus.focus_incident_person_live(
                    track_id,
                    person_bbox=seed_bbox,
                    frame=frame,
                    tracks=tracks,
                )
                live = True
            else:
                focus_file = alert.get("focus_snapshot") or alert.get("full_snapshot")
                if not focus_file:
                    raise ValueError("No saved focus image for this incident")
                path = INCIDENTS_DIR / focus_file
                if not path.is_file():
                    raise ValueError("Saved incident evidence is missing on disk")
                import cv2

                image = cv2.imread(str(path))
                if image is None or image.size == 0:
                    raise ValueError("Could not load saved incident evidence")
                result = self._incident_focus.focus_incident_person_recorded(
                    alert_id=alert_id,
                    track_id=track_id,
                    zone_index=int(alert.get("zone_index") or 0),
                    zone_label=str(alert.get("zone_label") or ""),
                    image=image,
                )
                live = False
                sid = result.get("slot_id") or f"alert_{alert_id}"
                self._focus_frames = {sid: image}
                self._latest_focus_frame = image

            self._focus_status = result

        return {
            "ok": True,
            "live": live,
            "camera_id": camera_id,
            **result,
        }

    def lock_focus_auto(
        self, track_id: int, event_type: str, zone_index: int = 0, camera_id: int | None = None
    ) -> dict:
        cid = int(camera_id) if camera_id is not None else self._active_camera_id
        with self._lock:
            self._incident_focus_for(cid).lock_auto(track_id, event_type, zone_index)
            result = self._combined_focus_status()
            self._focus_status = result
        return {"ok": True, "camera_id": cid, **result}

    def release_focus(self, slot_id: str | None = None) -> dict:
        with self._lock:
            if slot_id:
                mgr, local_id = self._focus_manager_for_slot(slot_id)
                mgr.release(local_id)
            else:
                for mgr in self._incident_focus_by_channel.values():
                    mgr.release(None)
            result = self._combined_focus_status()
            self._focus_status = result
            if slot_id:
                self._focus_frames.pop(slot_id, None)
            else:
                self._focus_frames.clear()
                self._latest_focus_frame = None
        return {"ok": True, **result}

    def get_focus_jpeg(self, slot_id: str | None = None) -> bytes | None:
        with self._lock:
            if slot_id:
                stored = self._focus_frames.get(slot_id)
                frame = stored.copy() if stored is not None else None
            elif self._focus_frames:
                frame = next(iter(self._focus_frames.values())).copy()
            elif self._latest_focus_frame is not None:
                frame = self._latest_focus_frame.copy()
            else:
                frame = None
        if frame is None:
            return None
        from detection import JPEG_QUALITY

        ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        )
        return encoded.tobytes() if ok else None

    def _sync_zone_source(self) -> None:
        self._processor.set_active_source(self._source_type)

    def get_cameras(self) -> list[dict]:
        return self._build_camera_list()

    def get_camera_jpeg(self, camera_id: int) -> bytes | None:
        if camera_id == WALL_SEARCHING_SLOT:
            return None
        if camera_id in WALL_VIDEO_SLOTS and not self._wall.slot_configured(camera_id):
            return None

        if camera_id == self._active_camera_id:
            jpeg = self.get_jpeg()
            if jpeg is not None:
                return jpeg

        jpeg, _version = self._multi.get_wall_jpeg(camera_id)
        if jpeg is not None:
            return jpeg

        frame = self._multi.get_display_frame(camera_id)
        if frame is None and camera_id == WALL_WEBCAM_SLOT:
            with self._lock:
                if self._latest_source_frame is not None:
                    frame = self._latest_source_frame.copy()
        if frame is None and camera_id in WALL_VIDEO_SLOTS:
            frame = self._wall.get_latest_frame(camera_id)

        if frame is None:
            return None

        return MultiChannelManager._encode_wall_jpeg(frame)

    def get_camera_raw_jpeg(self, camera_id: int) -> bytes | None:
        if camera_id == WALL_SEARCHING_SLOT:
            return None
        if camera_id in WALL_VIDEO_SLOTS and not self._wall.slot_configured(camera_id):
            return None

        frame = None
        if camera_id == WALL_WEBCAM_SLOT:
            with self._lock:
                if self._latest_source_frame is not None:
                    frame = self._latest_source_frame.copy()
        elif camera_id in WALL_VIDEO_SLOTS:
            frame = self._wall.get_source_frame(camera_id)

        if frame is None:
            return None

        return MultiChannelManager._encode_wall_jpeg(frame, max_width=240, quality=45)

    def switch_to_camera(self, camera_id: int) -> dict:
        if camera_id == WALL_WEBCAM_SLOT:
            return self.switch_to_webcam()
        if camera_id in WALL_VIDEO_SLOTS:
            if not self._wall.slot_configured(camera_id):
                raise RuntimeError(
                    f"No recording loaded for CCTV 0{camera_id}. Upload a video first."
                )
            return self._set_monitor_channel(camera_id)
        raise ValueError(f"Unknown camera id {camera_id}")

    def _set_monitor_channel(self, camera_id: int) -> dict:
        self._active_camera_id = camera_id
        self._multi.set_monitor_channel(camera_id)
        self._source_type = SOURCE_WEBCAM if camera_id == WALL_WEBCAM_SLOT else SOURCE_VIDEO
        self._active_video_slot = None if camera_id == WALL_WEBCAM_SLOT else camera_id
        self._processor.set_active_source(self._source_type)

        slot = self._wall.get_slot(camera_id) if camera_id in WALL_VIDEO_SLOTS else None
        if slot is not None:
            self._video_fps = slot.fps
            self._video_duration = slot.duration
            channel = self._multi.get(camera_id)
            if channel is not None:
                channel.video_filename = slot.display_name

        monitor = self._multi.get(camera_id)
        return {
            "ok": True,
            "source_type": self._source_type,
            "camera_id": camera_id,
            "video_filename": monitor.video_filename if monitor else None,
        }

    def get_tracks(self) -> list[dict]:
        with self._lock:
            return list(self._active_tracks)

    def set_show_trails(self, enabled: bool) -> None:
        self._multi.set_show_trails(enabled)

    def get_jpeg(self) -> bytes | None:
        with self._lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
        if frame is None:
            return None
        from detection import JPEG_QUALITY

        ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        )
        return encoded.tobytes() if ok else None

    def save_snapshot(self) -> dict:
        SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        with self._lock:
            if self._latest_frame is None:
                raise RuntimeError("No frame available to snapshot")
            frame = self._latest_frame.copy()

        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"snapshot_{stamp}.jpg"
        path = SNAPSHOTS_DIR / filename
        if not cv2.imwrite(str(path), frame):
            raise RuntimeError("Failed to write snapshot file")
        return {"filename": filename, "path": str(path)}

    def start_recording(self) -> dict:
        return self._recorder.start_manual()

    def stop_recording(self) -> dict:
        return self._recorder.stop_manual()

    def save_upload(self, content: bytes, original_filename: str, camera_id: int = 2) -> dict:
        if camera_id not in WALL_VIDEO_SLOTS:
            raise ValueError(
                f"Uploads are only supported for CCTV 0{WALL_VIDEO_SLOTS[0]}–"
                f"0{WALL_VIDEO_SLOTS[-1]}."
            )

        if len(content) > MAX_UPLOAD_BYTES:
            raise ValueError(f"File too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
        if len(content) < 1024:
            raise ValueError("File is too small to be a valid video.")

        safe_name = _safe_upload_name(original_filename)
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        dest = UPLOADS_DIR / safe_name
        dest.write_bytes(content)

        if not self._probe_video(dest):
            dest.unlink(missing_ok=True)
            raise ValueError(
                "OpenCV could not read this video. Export as MP4 with H.264 codec "
                "(QuickTime: File → Export → 1080p; avoid HEVC/H.265)."
            )

        if camera_id == 2:
            self.cleanup_user_upload()
            self._user_upload_path = dest
        self._pending_upload_path = dest
        self._pending_upload_name = original_filename

        try:
            result = self._wall.assign_upload(camera_id, dest, original_filename)
        except RuntimeError:
            dest.unlink(missing_ok=True)
            if camera_id == 2:
                self._user_upload_path = None
            self._pending_upload_path = None
            self._pending_upload_name = None
            raise

        channel = self._multi.get(camera_id)
        if channel is not None:
            channel.video_filename = original_filename
            channel.processor.reset_tracker()
            channel.processor.clear_zones()
            channel.display_frame = None
            channel.wall_jpeg = None
            channel.people_count = 0
            channel.active_track_count = 0
            channel.track_summaries = []

        return {
            "ok": True,
            "stored_as": safe_name,
            "original_filename": original_filename,
            "size_bytes": len(content),
            "camera_id": camera_id,
            **result,
        }

    def switch_to_webcam(self) -> dict:
        self._video_paused = False
        self._processor.set_zones_editing(False)
        self._playback_state = PLAYBACK_PLAYING
        self._error = None
        result = self._set_monitor_channel(WALL_WEBCAM_SLOT)

        if not self._webcam_is_open():
            if not self._try_open_webcam():
                with self._lock:
                    self._active = False
                    self._error = "Camera offline — will keep retrying"
            else:
                with self._lock:
                    self._active = True
                    self._error = None
        else:
            with self._lock:
                self._active = True
                self._error = None

        return result

    def switch_to_camera2(self, use_pending: bool = True) -> dict:
        return self.switch_to_video_slot(2, use_pending=use_pending)

    def switch_to_video_slot(self, slot_id: int, use_pending: bool = True) -> dict:
        if slot_id not in WALL_VIDEO_SLOTS:
            raise ValueError(f"Invalid video slot {slot_id}")

        if use_pending and self._pending_upload_path and slot_id == 2:
            path = self._pending_upload_path
            name = self._pending_upload_name
            if path and path.exists() and not self._wall.slot_configured(2):
                self._wall.assign_upload(2, path, name or path.name)

        if not self._wall.slot_configured(slot_id):
            raise RuntimeError(f"No recording loaded for CCTV 0{slot_id}. Upload a video first.")

        self._video_paused = False
        self._processor.set_zones_editing(False)
        self._playback_state = PLAYBACK_PLAYING
        with self._lock:
            self._active = True
            self._error = None

        result = self._set_monitor_channel(slot_id)
        slot = self._wall.get_slot(slot_id)
        if slot is not None:
            result["duration"] = round(slot.duration, 2)
        return result

    def start_video_analysis(self, use_pending: bool = True) -> dict:
        return self.switch_to_video_slot(2, use_pending=use_pending)

    def delete_camera2(self) -> dict:
        return self.delete_camera_slot(2)

    def delete_camera_slot(self, slot_id: int) -> dict:
        if slot_id not in WALL_VIDEO_SLOTS:
            raise ValueError(f"Cannot delete camera slot {slot_id}")

        was_monitor = self._active_camera_id == slot_id
        self._wall.clear_slot(slot_id)
        channel = self._multi.get(slot_id)
        if channel is not None:
            channel.video_filename = None
            channel.processor.reset_tracker()

        if slot_id == 2:
            self.cleanup_user_upload()
            self._pending_upload_path = None
            self._pending_upload_name = None

        if was_monitor:
            self._set_monitor_channel(WALL_WEBCAM_SLOT)

        return {
            "ok": True,
            "deleted": True,
            "source_type": self._source_type,
            "camera_id": self._active_camera_id,
            "camera2_available": self._camera2_configured(),
            "camera3_available": self._camera3_configured(),
            "camera4_available": self._camera4_configured(),
        }

    def pause_video(self) -> dict:
        if self._source_type != SOURCE_VIDEO:
            raise RuntimeError("Pause is only available for uploaded video.")
        self._video_paused = True
        with self._lock:
            self._playback_state = PLAYBACK_PAUSED
        return {"ok": True, "playback_state": PLAYBACK_PAUSED}

    def resume_video(self) -> dict:
        if self._source_type != SOURCE_VIDEO:
            raise RuntimeError("Resume is only available for CCTV 02.")
        self._video_paused = False
        with self._lock:
            self._playback_state = PLAYBACK_PLAYING
        return {"ok": True, "playback_state": PLAYBACK_PLAYING}

    def restart_video(self) -> dict:
        if self._source_type != SOURCE_VIDEO or self._active_video_slot is None:
            raise RuntimeError("No uploaded video session to restart.")
        slot = self._wall.get_slot(self._active_video_slot)
        if slot is None or not slot.configured():
            raise RuntimeError("No uploaded video session to restart.")
        self._processor.reset_tracker()
        self._reset_track_identities()
        self._reset_incident_focus()
        self._wall.seek_slot_start(self._active_video_slot)
        self._playback_position = 0.0
        self._video_paused = False
        with self._lock:
            self._playback_state = PLAYBACK_PLAYING
            self._active = True
            self._error = None
        return {"ok": True, "playback_state": PLAYBACK_PLAYING}

    def stop_video(self) -> dict:
        if self._source_type != SOURCE_VIDEO:
            raise RuntimeError("Stop is only available for uploaded video.")
        self._playback_state = PLAYBACK_STOPPED
        self._set_monitor_channel(WALL_WEBCAM_SLOT)
        if not self._webcam_is_open():
            self._try_open_webcam()
        return {"ok": True, "source_type": SOURCE_WEBCAM, "playback_state": PLAYBACK_STOPPED}

    def cleanup_user_upload(self) -> None:
        if self._user_upload_path and self._user_upload_path.exists():
            try:
                self._user_upload_path.unlink()
            except OSError:
                pass
        self._user_upload_path = None

    def _webcam_is_open(self) -> bool:
        cap = self._webcam_cap
        return cap is not None and cap.isOpened()

    def _release_all_captures(self) -> None:
        self._release_webcam()
        self._wall.stop_all()

    def _release_webcam(self) -> None:
        if self._webcam_cap is not None:
            try:
                self._webcam_cap.release()
            except Exception:
                pass
            self._webcam_cap = None
        self._camera_index = None

    def _probe_video(self, path: Path) -> bool:
        backends: list[int | None] = [None]
        if hasattr(cv2, "CAP_AVFOUNDATION"):
            backends.append(cv2.CAP_AVFOUNDATION)

        for backend in backends:
            cap = cv2.VideoCapture(str(path)) if backend is None else cv2.VideoCapture(str(path), backend)
            if not cap.isOpened():
                cap.release()
                continue
            ok = False
            for _ in range(8):
                ret, _ = cap.read()
                if ret:
                    ok = True
                    break
            cap.release()
            if ok:
                return True
        return False

    def _try_open_webcam(self) -> bool:
        if self._stop_event.is_set():
            return False
        if self._webcam_is_open():
            with self._lock:
                self._active = True
                self._error = None
            return True

        self._release_webcam()
        for index in CAMERA_INDICES:
            if self._stop_event.is_set():
                return False
            try:
                print(f"Trying camera index {index}...")
                cap = open_webcam(index)
                self._webcam_cap = cap
                self._camera_index = index
                with self._lock:
                    self._active = True
                    self._error = None
                print(f"Camera opened on index {index}.")
                return True
            except Exception as exc:
                print(f"Camera index {index} unavailable: {exc}")
        with self._lock:
            self._active = False
            self._error = "Camera offline — retrying…"
        return False

    def _reconnect_webcam(self, reason: str) -> bool:
        if self._stop_event.is_set():
            return False
        print(f"Camera lost ({reason}). Reconnecting…")
        with self._lock:
            self._active = False
            self._people_count = 0
            self._vehicle_count = 0
            self._active_track_count = 0
            self._active_tracks = []
            self._fps = 0.0
            self._error = "Camera disconnected — switching source…"
        self._processor.reset_tracker()
        self._reset_track_identities()
        self._reset_incident_focus()
        self._release_webcam()
        deadline = time.time() + RECONNECT_PAUSE_SEC
        while time.time() < deadline:
            if self._stop_event.is_set():
                return False
            time.sleep(0.1)
        return self._try_open_webcam()

    def _handle_channel_result(self, channel_id: int, result, prev_time: float) -> float:
        now = time.time()
        is_monitor = channel_id == self._active_camera_id
        fps = 1.0 / (now - prev_time) if (now - prev_time) > 0 else DEFAULT_FPS

        focus_tracks = scale_tracks_for_display(result.tracks, result.display_scale)
        focus_mgr = self._incident_focus_for(channel_id)
        focus_update = focus_mgr.update(
            result.annotated,
            focus_tracks,
            result.zone_events,
            active_violations=result.active_violations,
            now=now,
            camera_id=channel_id,
        )

        self._process_security_events_for_alerts(
            result.zone_events,
            focus_update.evidence_saved,
            now,
            channel_id=channel_id,
            people_count=result.people_count,
            track_summaries=result.track_summaries,
        )

        clip_result = self._recorder.process_frame(
            channel_id,
            result.annotated,
            now=now,
            fps=fps,
            zone_events=result.zone_events,
            active_violations=result.active_violations,
            record_manual=is_monitor,
        )
        self._handle_incident_clip_results(clip_result)

        person_tracks = [
            t for t in result.tracks if getattr(t, "class_name", "person") == "person"
        ]
        enriched_summaries = track_identity_matcher.enrich_summaries(
            result.annotated,
            person_tracks,
            result.track_summaries,
            camera_id=channel_id,
            now=now,
        )
        channel = self._multi.get(channel_id)
        if channel is not None:
            channel.track_summaries = enriched_summaries

        with self._lock:
            prefix = "" if is_monitor else f"cam{channel_id}:"
            for sid, frame in focus_update.frames.items():
                self._focus_frames[prefix + sid] = frame
            self._focus_status = self._combined_focus_status()
            active_slot_ids = {
                f["slot_id"] for f in self._focus_status.get("focuses", []) if f.get("slot_id")
            }
            self._focus_frames = {
                sid: frame for sid, frame in self._focus_frames.items() if sid in active_slot_ids
            }
            self._latest_focus_frame = (
                next(iter(self._focus_frames.values()), None) if self._focus_frames else None
            )

        if is_monitor:
            height, width = result.annotated.shape[:2]
            with self._lock:
                self._latest_frame = result.annotated
                self._people_count = result.people_count
                self._vehicle_count = getattr(result, "vehicle_count", 0)
                self._active_track_count = result.active_track_count
                self._active_tracks = enriched_summaries
                self._last_focus_tracks = focus_tracks
                self._fps = fps
                self._width = width
                self._height = height
                self._active = True
                self._error = None
                if focus_update.evidence_saved:
                    self._last_evidence_files = focus_update.evidence_saved
        return now

    def _sync_latest_frame(self, frame: np.ndarray) -> None:
        with self._lock:
            self._latest_frame = frame.copy()
            self._active = True
            self._error = None

    def _process_channel_frame(
        self,
        channel_id: int,
        frame: np.ndarray,
        prev_monitor_time: float,
        *,
        ai_count: int,
        wall_cfg: dict[int, bool],
        now: float | None = None,
        looped: bool = False,
        store_wall: bool = False,
    ) -> float:
        channel = self._multi.get(channel_id)
        is_monitor = channel_id == self._active_camera_id

        if channel_id == WALL_WEBCAM_SLOT:
            with self._lock:
                self._latest_source_frame = frame.copy()

        self._process_behavior_anomaly(channel_id, frame)

        if channel is not None and (
            channel.wall_jpeg is None
            or not self._multi.model_ready
            or not channel.ai_enabled
        ):
            self._multi.update_display(channel_id, frame)
            if is_monitor:
                self._sync_latest_frame(frame)
            if store_wall:
                self._wall.store_display_frame(channel_id, frame)

        if channel is None or not channel.ai_enabled:
            if is_monitor:
                self._sync_latest_frame(frame)
            if store_wall:
                self._wall.store_display_frame(channel_id, frame)
            return prev_monitor_time

        if not self._multi.model_ready:
            if is_monitor:
                self._sync_latest_frame(frame)
            if store_wall:
                self._wall.store_display_frame(channel_id, frame)
            return prev_monitor_time

        run_yolo = self._multi.should_run_ai(
            channel_id, ai_count, wall_configured=wall_cfg
        )
        preview = not is_monitor

        if run_yolo:
            result = self._multi.process_frame(
                channel_id,
                frame,
                now=now,
                looped=looped,
                lite=not is_monitor,
                preview=preview,
            )
            if not is_monitor:
                self._multi.note_background_yolo_ran(channel_id, wall_cfg)
        else:
            result = self._multi.render_overlay(
                channel_id,
                frame,
                now=now,
                preview=preview,
            )

        if channel.display_frame is not None and store_wall:
            self._wall.store_display_frame(channel_id, channel.display_frame)

        if result is None:
            return prev_monitor_time

        prev_channel = self._channel_prev_times.get(channel_id, time.time())
        new_prev = self._handle_channel_result(channel_id, result, prev_channel)
        self._channel_prev_times[channel_id] = new_prev

        if is_monitor:
            return new_prev
        return prev_monitor_time

    def _process_loop(self) -> None:
        prev_monitor_time = time.time()
        webcam_failures = 0

        while not self._stop_event.is_set():
            wall_cfg = self._wall.configured_slots()
            ai_count = self._multi.active_ai_channel_count(wall_cfg)
            self._multi.begin_pass()

            if self._webcam_is_open():
                try:
                    ret, frame = self._webcam_cap.read()
                except Exception:
                    ret, frame = False, None

                if ret and frame is not None:
                    webcam_failures = 0
                    prev_monitor_time = self._process_channel_frame(
                        WALL_WEBCAM_SLOT,
                        frame,
                        prev_monitor_time,
                        ai_count=ai_count,
                        wall_cfg=wall_cfg,
                        now=time.time(),
                    )
                    with self._lock:
                        self._active = True
                        self._playback_state = PLAYBACK_PLAYING
                else:
                    webcam_failures += 1
                    with self._lock:
                        self._active = False
                        self._error = "Camera signal lost — reconnecting…"
                    if webcam_failures >= MAX_CONSECUTIVE_FAILURES:
                        self._reconnect_webcam("no frames")
                        webcam_failures = 0
            elif not self._stop_event.is_set():
                if not self._try_open_webcam():
                    time.sleep(RETRY_WHILE_OFFLINE_SEC)

            if not self._video_paused and self._playback_state != PLAYBACK_PAUSED:
                for slot_id in WALL_VIDEO_SLOTS:
                    if not wall_cfg.get(slot_id):
                        continue

                    slot = self._wall.get_slot(slot_id)
                    if slot is None:
                        continue

                    frame, looped, is_new = self._wall.read_frame(slot_id)
                    if frame is None:
                        continue

                    channel = self._multi.get(slot_id)
                    if not is_new:
                        if channel is not None:
                            self._multi.refresh_wall_display(slot_id)
                            if channel.display_frame is not None:
                                self._wall.store_display_frame(
                                    slot_id, channel.display_frame
                                )
                        continue

                    if channel is not None:
                        channel.video_filename = slot.display_name
                        channel.playback_position = (
                            slot._frame_index / slot.fps if slot.fps > 0 else 0.0
                        )

                    zone_now = channel.playback_position if channel else 0.0
                    prev_monitor_time = self._process_channel_frame(
                        slot_id,
                        frame,
                        prev_monitor_time,
                        ai_count=ai_count,
                        wall_cfg=wall_cfg,
                        now=zone_now,
                        looped=looped,
                        store_wall=True,
                    )
                    if slot_id == self._active_camera_id:
                        self._video_fps = slot.fps
                        self._video_duration = slot.duration
                        self._playback_position = zone_now

            time.sleep(0.002 if ai_count > 1 else 0.001)


camera_service = MediaService()
