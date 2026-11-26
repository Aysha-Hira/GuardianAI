from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from detection import scale_tracks_for_display
from focus.incident_focus import IncidentFocusManager
from alerts.store import AlertStore
from behavior.anomaly_engine import BehaviorAnomalyEvent, get_behavior_engine
from recognition.match_events import WatchlistMatchEvent
from recognition.track_matcher import track_identity_matcher
from recording.recorder import RecordingManager, finalize_mp4_for_web, DEFAULT_FPS
from cameras import camera_service
from cameras.multi_channel import MultiChannelManager
from cameras.readers import make_reader
from zones.restricted_zone import SOURCE_VIDEO, SOURCE_WEBCAM

BASE_DIR = Path(__file__).resolve().parent
SNAPSHOTS_DIR = BASE_DIR / "snapshots"
INCIDENTS_DIR = SNAPSHOTS_DIR / "incidents"
RECORDINGS_DIR = SNAPSHOTS_DIR / "recordings"

PLAYBACK_IDLE = "idle"
PLAYBACK_PLAYING = "playing"
PLAYBACK_COMPLETE = "complete"

logger = logging.getLogger("guardian.media")


def _zone_source(source_type: str) -> str:
    """Zones only know 'webcam' and 'video'; rtsp/http count as 'video'."""
    return SOURCE_WEBCAM if source_type == "webcam" else SOURCE_VIDEO


class MediaService:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

        self._multi = MultiChannelManager()
        self._incident_focus_by_channel: dict[int, IncidentFocusManager] = {}
        self._alert_store = AlertStore()
        self._recorder = RecordingManager(RECORDINGS_DIR)

        self._sources: dict[int, object] = {}
        self._source_last_seq: dict[int, int] = {}
        self._active_camera_id: int | None = None

        self._active = False
        self._people_count = 0
        self._vehicle_count = 0
        self._fps = 0.0
        self._width = 0
        self._height = 0
        self._latest_frame: np.ndarray | None = None
        self._latest_focus_frame: np.ndarray | None = None
        self._focus_frames: dict[str, np.ndarray] = {}
        self._focus_status: dict = {"active": False, "focuses": []}
        self._last_evidence_files: list[str] = []
        self._active_tracks: list[dict] = []
        self._active_track_count = 0
        self._last_focus_tracks: list = []
        self._error: str | None = None

        self._channel_prev_times: dict[int, float] = {}
        self._behavior_frame_indices: dict[int, int] = {}

        track_identity_matcher.configure(
            incidents_dir=INCIDENTS_DIR,
            on_match=self._handle_watchlist_match,
        )

    @property
    def _processor(self):
        if self._active_camera_id is None:
            return None
        return self._multi.processor_for(self._active_camera_id)

    def _incident_focus_for(self, channel_id: int) -> IncidentFocusManager:
        manager = self._incident_focus_by_channel.get(channel_id)
        if manager is None:
            manager = IncidentFocusManager(INCIDENTS_DIR)
            self._incident_focus_by_channel[channel_id] = manager
        return manager

    @property
    def _incident_focus(self) -> IncidentFocusManager:
        if self._active_camera_id is None:
            raise RuntimeError("No camera is active.")
        return self._incident_focus_for(self._active_camera_id)

    def _combined_focus_status(self) -> dict:
        active_id = self._active_camera_id
        order = [active_id] + [
            camera_id for camera_id in sorted(self._incident_focus_by_channel)
            if camera_id != active_id
        ]
        focuses: list[dict] = []
        for camera_id in order:
            manager = self._incident_focus_by_channel.get(camera_id)
            if manager is None:
                continue
            for focus in manager.get_status().get("focuses", []):
                item = dict(focus)
                item["camera_id"] = camera_id
                if camera_id != active_id and item.get("slot_id"):
                    item["slot_id"] = f"cam{camera_id}:{item['slot_id']}"
                focuses.append(item)
        if active_id is not None:
            status = self._incident_focus.get_status()
        else:
            status = {}
        status["focuses"] = focuses
        status["count"] = len(focuses)
        status["active"] = bool(focuses)
        status["label"] = "INCIDENT FOCUS" if focuses else "NO ACTIVE INCIDENT"
        return status

    def _focus_manager_for_slot(
        self, slot_id: str | None
    ) -> tuple[IncidentFocusManager, str | None]:
        if slot_id and slot_id.startswith("cam") and ":" in slot_id:
            camera_part, local_slot = slot_id[3:].split(":", 1)
            if camera_part.isdigit():
                return self._incident_focus_for(int(camera_part)), local_slot
        return self._incident_focus, slot_id

    def _reset_incident_focus(self) -> None:
        for manager in self._incident_focus_by_channel.values():
            manager.reset()
        self._incident_focus_by_channel.clear()

    def _reset_track_identities(self) -> None:
        track_identity_matcher.reset()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._reset_incident_focus()

        for camera_id, name, source_type, url in camera_service.list_active_streams():
            try:
                self.start_camera(camera_id, name, source_type, url)
            except Exception as exc:
                logger.warning("Could not start camera %s: %s", name, exc)

        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()

        print("Loading YOLOv11 model...")
        try:
            self._multi.ensure_model()
        except Exception as exc:
            self._error = f"Failed to load YOLO model: {exc}"
            print(self._error)
            return

        print("Media service running.")

    def stop(self) -> None:
        self.request_stop()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._thread = None

        for camera_id in list(self._sources):
            self.stop_camera(camera_id)

        with self._lock:
            self._active = False
            self._latest_frame = None
            self._latest_focus_frame = None
            self._focus_status = {"active": False}
            self._active_tracks = []
            self._active_track_count = 0

        self._reset_incident_focus()
        print("Media service stopped.")

    def request_stop(self) -> None:
        self._stop_event.set()

    def is_stopped(self) -> bool:
        return self._stop_event.is_set()

    def start_camera(
        self, camera_id: int, name: str, source_type: str, url: str | None
    ) -> None:
        if camera_id in self._sources:
            self.stop_camera(camera_id)
        reader = make_reader(source_type, url)
        self._multi.add_channel(camera_id, _zone_source(source_type), name)
        self._sources[camera_id] = reader
        self._source_last_seq[camera_id] = 0
        if self._active_camera_id is None:
            self._set_monitor_channel(camera_id)

    def stop_camera(self, camera_id: int) -> None:
        reader = self._sources.pop(camera_id, None)
        if reader is not None:
            reader.stop()
        self._source_last_seq.pop(camera_id, None)
        self._channel_prev_times.pop(camera_id, None)
        self._behavior_frame_indices.pop(camera_id, None)
        manager = self._incident_focus_by_channel.pop(camera_id, None)
        if manager is not None:
            manager.reset()
        self._multi.remove_channel(camera_id)

        if self._active_camera_id == camera_id:
            next_id = next(iter(self._sources), None)
            if next_id is None:
                self._active_camera_id = None
                with self._lock:
                    self._active = False
                    self._latest_frame = None
            else:
                self._set_monitor_channel(next_id)

    def restart_camera(self, camera_id: int) -> None:
        self.stop_camera(camera_id)
        for cid, name, source_type, url in camera_service.list_active_streams():
            if cid == camera_id:
                self.start_camera(cid, name, source_type, url)
                return

    def switch_to_camera(self, camera_id: int) -> dict:
        if self._multi.get(camera_id) is None:
            raise ValueError(f"Unknown camera id {camera_id}")
        return self._set_monitor_channel(camera_id)

    def _set_monitor_channel(self, camera_id: int) -> dict:
        self._active_camera_id = camera_id
        self._multi.set_monitor_channel(camera_id)
        channel = self._multi.get(camera_id)
        return {
            "ok": True,
            "source_type": channel.source_type if channel else None,
            "camera_id": camera_id,
            "camera_name": channel.video_filename if channel else None,
        }

    def get_cameras(self) -> list[dict]:
        return self._build_camera_list()

    def _build_camera_list(self) -> list[dict]:
        return [
            self._multi.channel_meta(camera_id)
            for camera_id in self._multi.ids()
        ]

    def set_camera_ai(self, camera_id: int, enabled: bool) -> dict:
        if self._multi.get(camera_id) is None:
            raise ValueError(f"Invalid camera id {camera_id}")
        return self._multi.set_ai_enabled(camera_id, enabled)

    def set_camera_boxes(self, camera_id: int, show: bool) -> dict:
        if self._multi.get(camera_id) is None:
            raise ValueError(f"Invalid camera id {camera_id}")
        return self._multi.set_show_boxes(camera_id, show)
    
    def get_status(self) -> dict:
        with self._lock:
            channel = (
                self._multi.get(self._active_camera_id)
                if self._active_camera_id is not None else None
            )
            status = {
                "source_type": channel.source_type if channel else None,
                "camera_id": self._active_camera_id,
                "camera_label": channel.label() if channel else "No camera",
                "camera_active": self._active,
                "people_count": self._people_count,
                "vehicle_count": self._vehicle_count,
                "active_tracks": self._active_track_count,
                "fps": round(self._fps, 1),
                "resolution": f"{self._width}x{self._height}" if self._width else "—",
                "error": self._error,
                "playback_state": PLAYBACK_PLAYING if self._active else PLAYBACK_IDLE,
                "cameras": self._build_camera_list(),
            }

            processor = self._processor
            zones = processor.get_zones() if processor else []
            status["restricted_zones"] = zones
            status["restricted_zone"] = zones[0] if zones else None
            status["restricted_zone_active"] = len(zones) > 0
            status["restricted_zone_label"] = (
                f"Active ({len(zones)})" if zones else "Not Set"
            )
            status["zone_source"] = channel.source_type if channel else None
            if processor:
                status.update(processor.get_settings())
            status["incident_focus"] = dict(self._focus_status)
            status.update(self._recorder.status())
            status["face_recognition"] = self._face_recognition_status()
            from alerts.severity_service import severity_scorer

            status["severity_model"] = severity_scorer.status()
            status["behavior_model"] = self._behavior_status()
            return status

    @staticmethod
    def _behavior_status() -> dict:
        return get_behavior_engine().status()

    @staticmethod
    def _face_recognition_status() -> dict:
        from recognition.deepface_client import deepface_client
        from watchlist.config import ENABLE_FACE_RECOGNITION
        from watchlist.store import watchlist_store
        from watchlist.weights import weights_status

        probe = deepface_client.probe()
        weights = weights_status()
        return {
            "enabled": ENABLE_FACE_RECOGNITION,
            "available": deepface_client.live_matching_enabled(),
            "watchlist_count": len(watchlist_store.list_entries()),
            "model": weights.get("model"),
            "match_threshold": weights.get("threshold"),
            "weights_ready": weights.get("ready"),
            "engine": probe,
            "weights": weights,
        }

    def get_zones(self, source: str | None = None) -> list[dict]:
        processor = self._processor
        return processor.get_zones(source) if processor else []

    def set_zones(
        self, zones: list[dict], source: str | None = None, *, reset_states: bool = True
    ) -> dict:
        processor = self._processor
        if processor is None:
            raise ValueError("No camera is active.")
        saved = processor.set_zones(zones, source, reset_states=reset_states)
        return {
            "ok": True,
            "restricted_zones": saved,
            "restricted_zone_active": len(saved) > 0,
            "zone_source": source,
        }

    def set_zones_editing(self, active: bool) -> dict:
        processor = self._processor
        if processor is not None:
            processor.set_zones_editing(active)
        return {"ok": True, "zones_editing": active}

    def clear_zones(self, source: str | None = None) -> dict:
        processor = self._processor
        if processor is not None:
            processor.clear_zones(source)
        self._handle_incident_clip_results(self._recorder.finalize_all())
        return {
            "ok": True,
            "restricted_zones": [],
            "restricted_zone_active": False,
            "zone_source": source,
        }

    def get_zone_events(self) -> list[dict]:
        events: list[dict] = []
        for camera_id in self._multi.ids():
            processor = self._multi.processor_for(camera_id)
            for event in processor.recent_zone_events():
                item = dict(event)
                item["camera_id"] = camera_id
                events.append(item)
        events.sort(key=lambda item: int(item.get("event_id", 0)))
        return events

    def get_settings(self) -> dict:
        processor = self._processor
        return processor.get_settings() if processor else {}

    def set_loitering_threshold(self, seconds: float) -> dict:
        value = self._multi.set_loitering_threshold(seconds)
        return {"ok": True, "loitering_threshold_seconds": round(value, 1)}

    def set_show_trails(self, enabled: bool) -> None:
        self._multi.set_show_trails(enabled)

    def clear_alerts(self) -> dict:
        removed = self._alert_store.clear_all()
        files_deleted = 0
        for alert in removed:
            for key, folder in (
                ("full_snapshot", INCIDENTS_DIR),
                ("focus_snapshot", INCIDENTS_DIR),
                ("incident_clip", RECORDINGS_DIR),
            ):
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

        clip_status = alert.get("incident_clip_status") or "none"
        if clip_status in ("processing", "failed"):
            return alert

        active_keys = {
            (camera_id, track_id, zone_index)
            for camera_id, track_id, zone_index, _ in self._recorder.active_incidents()
        }
        camera_id = int(alert.get("camera_id") or self._active_camera_id or 0)
        key = (camera_id, int(alert.get("track_id", -1)),
               int(alert.get("zone_index", -1)))
        if key in active_keys:
            alert["incident_clip_status"] = "recording"
        elif clip_status == "recording":
            alert["incident_clip_status"] = "failed"
        return alert

    def _handle_incident_clip_results(self, result) -> None:
        for clip in result.finalized:
            self._queue_incident_clip_finalize(clip)
        for clip in result.failed:
            self._alert_store.set_incident_clip_status(
                clip.camera_id, clip.track_id, clip.zone_index,
                clip.event_type, "failed",
            )

    def get_alert(self, alert_id: str) -> dict | None:
        alert = self._alert_store.get_alert(alert_id)
        if alert is None:
            return None
        alert = self._enrich_alert_clip_status(alert)
        with self._lock:
            active_ids = {int(t.get("track_id", -1))
                          for t in self._active_tracks}
        alert["track_active"] = int(alert.get("track_id", -1)) in active_ids
        return alert

    def _queue_incident_clip_finalize(self, clip) -> None:
        self._alert_store.set_incident_clip_status(
            clip.camera_id, clip.track_id, clip.zone_index,
            clip.event_type, "processing",
        )
        threading.Thread(
            target=self._finalize_and_attach_clip,
            args=(clip.camera_id, clip.track_id, clip.zone_index,
                  clip.event_type, clip.filename),
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
                    camera_id, track_id, zone_index, event_type, filename)
            else:
                self._alert_store.set_incident_clip_status(
                    camera_id, track_id, zone_index, event_type, "failed")
        except Exception:
            self._alert_store.set_incident_clip_status(
                camera_id, track_id, zone_index, event_type, "failed")

    def update_alert_status(self, alert_id: str, status: str) -> dict:
        return self._alert_store.update_status(alert_id, status)

    def _alert_source_context(
        self, channel_id: int | None = None
    ) -> tuple[str, str, str | None, str | None]:
        camera_id = channel_id if channel_id is not None else self._active_camera_id
        channel = self._multi.get(camera_id) if camera_id is not None else None
        if channel is None:
            return "Unknown camera", SOURCE_WEBCAM, None, None
        return channel.label(), channel.source_type, None, None

    @staticmethod
    def _evidence_for_event(
        event,
        evidence_files: list[str],
        *,
        camera_id: int | None = None,
    ) -> tuple[str | None, str | None]:
        track_id = int(event.track_id)
        zone_label = f"zone{int(event.zone_index) + 1}"
        event_kind = "loitering" if event.event_type == "loitering" else "entry"
        camera_tag = f"cam{int(camera_id)}_" if camera_id is not None else None
        full_name: str | None = None
        focus_name: str | None = None
        for filename in evidence_files:
            if camera_tag and camera_tag not in filename:
                continue
            if (f"track{track_id}" not in filename
                    or zone_label not in filename
                    or event_kind not in filename):
                continue
            if filename.endswith("_full.jpg"):
                full_name = filename
            elif filename.endswith("_focus.jpg"):
                focus_name = filename
        return full_name, focus_name

    def _save_behavior_snapshot(self, camera_id: int, frame: np.ndarray) -> str | None:
        INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"behavior_anomaly_cam{int(camera_id)}_{stamp}.jpg"
        if cv2.imwrite(str(INCIDENTS_DIR / filename), frame):
            return filename
        return None

    def _handle_behavior_anomaly(self, event: BehaviorAnomalyEvent) -> None:
        try:
            camera_id = int(event.camera_id)
        except ValueError:
            camera_id = self._active_camera_id
        camera, source_type, video_filename, video_time = self._alert_source_context(
            camera_id)
        channel = self._multi.get(camera_id)
        people_count = channel.people_count if channel is not None else 0

        snapshot_name = None
        if event.snapshot is not None:
            snapshot_name = self._save_behavior_snapshot(
                camera_id, event.snapshot)

        alert = self._alert_store.create_from_behavior_anomaly(
            camera=camera,
            source_type=source_type,
            camera_id=camera_id,
            anomaly_score=event.score,
            anomaly_threshold=event.threshold,
            focus_snapshot=snapshot_name,
            video_filename=video_filename,
            video_time=video_time,
            wall_now=time.time(),
            people_count=people_count,
        )
        if alert is None:
            return
        logger.info(
            "Behavior anomaly alert %s — %s score=%.5f threshold=%.5f",
            alert.id, camera, event.score, event.threshold,
        )

    def _process_behavior_anomaly(self, channel_id: int, frame: np.ndarray) -> None:
        engine = get_behavior_engine()
        if not engine.available:
            return
        frame_index = self._behavior_frame_indices.get(channel_id, 0) + 1
        self._behavior_frame_indices[channel_id] = frame_index
        event = engine.process_frame(str(channel_id), frame, frame_index)
        if event is not None:
            self._handle_behavior_anomaly(event)

    def _handle_watchlist_match(self, event: WatchlistMatchEvent) -> None:
        camera, source_type, video_filename, video_time = self._alert_source_context(
            event.camera_id)
        with self._lock:
            track_summary = next(
                (t for t in self._active_tracks
                 if int(t.get("track_id", -1)) == event.track_id),
                None,
            )
        channel = self._multi.get(event.camera_id)
        people_count = channel.people_count if channel is not None else 0
        if track_summary is None and channel is not None:
            track_summary = next(
                (s for s in channel.track_summaries
                 if int(s.get("track_id", -1)) == event.track_id),
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
            video_time=video_time,
            wall_now=event.timestamp,
            people_count=people_count,
            track_summary=track_summary,
        )
        if alert is None:
            return

        logger.info(
            "Watchlist alert %s — %s on %s track #%s",
            alert.id, event.watchlist_name, camera, event.track_id,
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

        focus_manager = self._incident_focus_for(event.camera_id)
        self._focus_status = focus_manager.focus_watchlist_match(
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
        camera, source_type, video_filename, video_time = self._alert_source_context(
            channel_id)
        camera_id = channel_id if channel_id is not None else self._active_camera_id
        summaries = track_summaries or []
        for event in zone_events:
            full_snapshot, focus_snapshot = self._evidence_for_event(
                event, evidence_files, camera_id=camera_id)
            track_summary = next(
                (s for s in summaries
                 if int(s.get("track_id", -1)) == int(event.track_id)),
                None,
            )
            self._alert_store.create_from_security_event(
                event,
                camera=camera,
                source_type=source_type,
                camera_id=camera_id,
                video_filename=video_filename,
                video_time=video_time,
                full_snapshot=full_snapshot,
                focus_snapshot=focus_snapshot,
                wall_now=wall_now,
                people_count=people_count,
                track_summary=track_summary,
            )
            if full_snapshot or focus_snapshot:
                self._alert_store.attach_evidence(
                    int(event.track_id),
                    int(event.zone_index),
                    event.event_type,
                    camera_id=camera_id,
                    full_snapshot=full_snapshot,
                    focus_snapshot=focus_snapshot,
                )

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
            track_id = int(track_id)
            for track in self._last_focus_tracks:
                if int(getattr(track, "track_id", -1)) == track_id:
                    seed_bbox = getattr(track, "bbox", None)
                    break
            frame = self._latest_frame.copy() if self._latest_frame is not None else None
            tracks = list(self._last_focus_tracks)
            result = self._incident_focus.focus_incident_person_live(
                track_id, person_bbox=seed_bbox, frame=frame, tracks=tracks,
            )
            self._focus_status = result
        return {"ok": True, **result}

    def focus_from_alert(self, alert_id: str) -> dict:
        alert = self._alert_store.get_alert(alert_id)
        if alert is None:
            raise KeyError(f"Alert not found: {alert_id}")

        camera_id = int(alert.get("camera_id") or self._active_camera_id or 0)
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
                    track_id, person_bbox=seed_bbox, frame=frame, tracks=tracks,
                )
                live = True
            else:
                focus_file = alert.get(
                    "focus_snapshot") or alert.get("full_snapshot")
                if not focus_file:
                    raise ValueError("No saved focus image for this incident")
                path = INCIDENTS_DIR / focus_file
                if not path.is_file():
                    raise ValueError(
                        "Saved incident evidence is missing on disk")
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
                slot_id = result.get("slot_id") or f"alert_{alert_id}"
                self._focus_frames = {slot_id: image}
                self._latest_focus_frame = image

            self._focus_status = result

        return {"ok": True, "live": live, "camera_id": camera_id, **result}

    def lock_focus_auto(
        self, track_id: int, event_type: str, zone_index: int = 0,
        camera_id: int | None = None,
    ) -> dict:
        target_id = int(
            camera_id) if camera_id is not None else self._active_camera_id
        if target_id is None:
            raise RuntimeError("No camera is active.")
        with self._lock:
            self._incident_focus_for(target_id).lock_auto(
                track_id, event_type, zone_index)
            result = self._combined_focus_status()
            self._focus_status = result
        return {"ok": True, "camera_id": target_id, **result}

    def release_focus(self, slot_id: str | None = None) -> dict:
        with self._lock:
            if slot_id:
                manager, local_id = self._focus_manager_for_slot(slot_id)
                manager.release(local_id)
            else:
                for manager in self._incident_focus_by_channel.values():
                    manager.release(None)
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
        return self._encode_jpeg(frame)

    @staticmethod
    def _encode_jpeg(frame: np.ndarray) -> bytes | None:
        from detection import JPEG_QUALITY

        encoded_ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        return encoded.tobytes() if encoded_ok else None

    def get_jpeg(self) -> bytes | None:
        with self._lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
        return None if frame is None else self._encode_jpeg(frame)

    def get_camera_jpeg(self, camera_id: int) -> bytes | None:
        if self._multi.get(camera_id) is None:
            return None

        if camera_id == self._active_camera_id:
            jpeg = self.get_jpeg()
            if jpeg is not None:
                return jpeg

        jpeg, _version = self._multi.get_wall_jpeg(camera_id)
        if jpeg is not None:
            return jpeg

        frame = self._multi.get_display_frame(camera_id)
        if frame is None:
            return None
        return MultiChannelManager._encode_wall_jpeg(frame)

    def get_camera_raw_jpeg(self, camera_id: int) -> bytes | None:
        reader = self._sources.get(camera_id)
        if reader is None:
            return None
        frame, _seq = reader.latest()
        if frame is None:
            return None
        return MultiChannelManager._encode_wall_jpeg(frame, max_width=240, quality=45)

    def get_tracks(self) -> list[dict]:
        with self._lock:
            return list(self._active_tracks)

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

    def _handle_channel_result(self, channel_id: int, result, prev_time: float) -> float:
        now = time.time()
        is_monitor = channel_id == self._active_camera_id
        fps = 1.0 / (now - prev_time) if (now - prev_time) > 0 else DEFAULT_FPS

        focus_tracks = scale_tracks_for_display(
            result.tracks, result.display_scale)
        focus_manager = self._incident_focus_for(channel_id)
        focus_update = focus_manager.update(
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
            track for track in result.tracks
            if getattr(track, "class_name", "person") == "person"
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
            for slot_id, frame in focus_update.frames.items():
                self._focus_frames[prefix + slot_id] = frame
            self._focus_status = self._combined_focus_status()
            active_slot_ids = {
                focus["slot_id"]
                for focus in self._focus_status.get("focuses", [])
                if focus.get("slot_id")
            }
            self._focus_frames = {
                slot_id: frame for slot_id, frame in self._focus_frames.items()
                if slot_id in active_slot_ids
            }
            self._latest_focus_frame = (
                next(iter(self._focus_frames.values()), None)
                if self._focus_frames else None
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
        now: float | None = None,
    ) -> float:
        channel = self._multi.get(channel_id)
        if channel is None:
            return prev_monitor_time
        is_monitor = channel_id == self._active_camera_id

        self._process_behavior_anomaly(channel_id, frame)

        ai_off = not channel.ai_enabled or not self._multi.model_ready
        if channel.wall_jpeg is None or ai_off:
            self._multi.update_display(channel_id, frame)
        if ai_off:
            if is_monitor:
                self._sync_latest_frame(frame)
            return prev_monitor_time

        run_yolo = self._multi.should_run_ai(channel_id, ai_count)
        preview = not is_monitor

        if run_yolo:
            result = self._multi.process_frame(
                channel_id, frame, now=now, lite=not is_monitor, preview=preview,
            )
            if not is_monitor:
                self._multi.note_background_yolo_ran(channel_id)
        else:
            result = self._multi.render_overlay(
                channel_id, frame, now=now, preview=preview)

        if result is None:
            return prev_monitor_time

        prev_channel_time = self._channel_prev_times.get(
            channel_id, time.time())
        new_time = self._handle_channel_result(
            channel_id, result, prev_channel_time)
        self._channel_prev_times[channel_id] = new_time

        return new_time if is_monitor else prev_monitor_time

    def _process_loop(self) -> None:
        prev_monitor_time = time.time()

        while not self._stop_event.is_set():
            ai_count = self._multi.active_ai_channel_count()
            self._multi.begin_pass()

            for camera_id, reader in list(self._sources.items()):
                frame, seq = reader.latest()
                if frame is None or seq == self._source_last_seq.get(camera_id):
                    continue
                self._source_last_seq[camera_id] = seq
                prev_monitor_time = self._process_channel_frame(
                    camera_id,
                    frame,
                    prev_monitor_time,
                    ai_count=ai_count,
                    now=time.time(),
                )

            time.sleep(0.002 if ai_count > 1 else 0.001)


media_service = MediaService()
