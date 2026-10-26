from __future__ import annotations

import math
import statistics
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from experiments.multicam.crop_selector import crop_person, crop_quality_score
from experiments.multicam.offline_detection import detect_persons_offline
from experiments.multicam.offline_tracker import OfflineTracker
from experiments.multicam.static_detections import drop_static_detections, find_static_hotspots
from experiments.reid.osnet_extractor import OSNetExtractor

CROPS_PER_TRACK = 24
CROP_EVERY_N_FRAMES = 2
MIN_TRACK_SECONDS = 0.6
MIN_PEAK_CONFIDENCE = 0.50
MIN_MEAN_CONFIDENCE = 0.30
STATIC_MIN_SECONDS = 3.0
STATIC_MAX_TRAVEL_RATIO = 0.25
REFLECTION_MAX_MEAN_CONF = 0.62
REFLECTION_HOST_MIN_CONF = 0.70
REFLECTION_MIN_COOCCURRENCE = 0.80


@dataclass
class TrackState:
    local_track_id: int
    crop_samples: list[tuple[np.ndarray, float]] = field(default_factory=list)
    frames_seen: int = 0
    start_time: float = 0.0
    last_time: float = 0.0
    global_id: int | None = None
    embedding: np.ndarray | None = None
    eligible: bool = False
    assigned: bool = False
    confidences: list[float] = field(default_factory=list)
    centers: list[tuple[float, float]] = field(default_factory=list)
    heights: list[int] = field(default_factory=list)
    boxes: list[tuple[int, int, int, int]] = field(default_factory=list)


@dataclass
class FrameAnnotation:
    local_track_id: int
    global_id: int | None
    bbox: tuple[int, int, int, int]
    confidence: float


@dataclass
class CameraRunResult:
    camera_id: str
    fps: float
    frame_count: int
    yolo_fps: float
    tracks: dict[int, TrackState]
    annotations_by_frame: dict[int, list[FrameAnnotation]]
    timings: dict[str, float]
    frame_height: int = 0
    static_hotspots: list[dict] = field(default_factory=list)
    dropped_tracks: dict[str, int] = field(default_factory=dict)
    track_log: list[dict] = field(default_factory=list)


def _add_crop(state: TrackState, crop: np.ndarray, score: float) -> None:
    state.crop_samples.append((crop, score))
    if len(state.crop_samples) > CROPS_PER_TRACK * 2:
        state.crop_samples.sort(key=lambda s: s[1], reverse=True)
        del state.crop_samples[CROPS_PER_TRACK:]


def _drop_reason(state: TrackState, fps: float) -> str | None:
    duration = state.last_time - state.start_time
    if state.frames_seen < max(8, int(fps * MIN_TRACK_SECONDS)):
        return "too_short"
    if state.confidences and (
        max(state.confidences) < MIN_PEAK_CONFIDENCE or statistics.fmean(state.confidences) < MIN_MEAN_CONFIDENCE
    ):
        return "low_confidence"
    if duration >= STATIC_MIN_SECONDS and state.boxes:
        travel = max(max(b[k] for b in state.boxes) - min(b[k] for b in state.boxes) for k in range(4))
        if travel < STATIC_MAX_TRAVEL_RATIO * statistics.median(state.heights):
            return "static"
    return None


def _reflection_ids(tracks: dict[int, TrackState]) -> set[int]:
    out: set[int] = set()
    means = {tid: statistics.fmean(st.confidences) for tid, st in tracks.items() if st.confidences}
    for tid, st in tracks.items():
        if means.get(tid, 1.0) >= REFLECTION_MAX_MEAN_CONF:
            continue
        span = max(st.last_time - st.start_time, 1e-3)
        for oid, other in tracks.items():
            if oid == tid or means.get(oid, 0.0) < REFLECTION_HOST_MIN_CONF:
                continue
            overlap = min(st.last_time, other.last_time) - max(st.start_time, other.start_time)
            if overlap / span >= REFLECTION_MIN_COOCCURRENCE:
                out.add(tid)
                break
    return out


class CameraTracker:
    def __init__(
        self,
        camera_id: str,
        *,
        model,
        reid: OSNetExtractor,
        min_crops: int = 3,
        max_crops: int = 10,
    ) -> None:
        self.camera_id = camera_id
        self.model = model
        self.reid = reid
        self.tracker: OfflineTracker | None = None
        self.min_crops = min_crops
        self.max_crops = max_crops
        self.tracks: dict[int, TrackState] = {}
        self.annotations_by_frame: dict[int, list[FrameAnnotation]] = {}

    def _detect_all(self, video_path, *, max_frames, stride, imgsz, preprocess, on_progress):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        dets_by_frame: dict[int, list[tuple]] = {}
        yolo_times: list[float] = []
        frame_idx = 0
        frame_h = 0
        while True:
            ret, frame = cap.read()
            if not ret or (max_frames is not None and frame_idx >= max_frames):
                break
            frame_h = frame.shape[0]
            if frame_idx % stride == 0:
                t = time.perf_counter()
                dets_by_frame[frame_idx] = detect_persons_offline(
                    self.model, frame, preprocess=preprocess, imgsz=imgsz
                )
                yolo_times.append(time.perf_counter() - t)
            if on_progress and frame_idx > 0 and frame_idx % 25 == 0:
                on_progress(frame_idx, "detecting")
            frame_idx += 1
        cap.release()
        return fps, frame_idx, frame_h, dets_by_frame, yolo_times

    def process_video(
        self,
        video_path: str,
        *,
        global_manager=None,
        match_threshold: float = 0.5,
        max_gap_seconds: float = 30.0,
        max_frames: int | None = None,
        frame_stride: int = 1,
        yolo_imgsz: int = 640,
        yolo_preprocess: bool = False,
        on_frame=None,
        on_progress=None,
    ) -> CameraRunResult:
        t0 = time.perf_counter()
        stride = max(1, int(frame_stride))
        fps, n_frames, frame_h, dets_by_frame, yolo_times = self._detect_all(
            video_path,
            max_frames=max_frames,
            stride=stride,
            imgsz=yolo_imgsz,
            preprocess=yolo_preprocess,
            on_progress=on_progress,
        )
        hotspots = find_static_hotspots(dets_by_frame, fps=fps, n_frames=n_frames)
        if hotspots:
            print(f"[multicam] {self.camera_id}: ignoring {len(hotspots)} static hotspot(s) {[h['box'] for h in hotspots]}")

        self.tracker = OfflineTracker(fps=fps)
        cap = cv2.VideoCapture(video_path)
        frame_idx = 0
        while frame_idx < n_frames:
            ret, frame = cap.read()
            if not ret:
                break
            ts = frame_idx / fps
            dets = drop_static_detections(dets_by_frame.get(frame_idx, []), hotspots)
            tracks = self.tracker.update(dets)

            frame_ann: list[FrameAnnotation] = []
            for tr in tracks:
                tid = int(tr.track_id)
                bbox = tuple(int(v) for v in tr.bbox)
                state = self.tracks.get(tid)
                if state is None:
                    state = TrackState(local_track_id=tid, start_time=ts, last_time=ts)
                    self.tracks[tid] = state
                state.frames_seen += 1
                state.last_time = ts
                state.confidences.append(float(tr.confidence))
                state.centers.append(((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0))
                state.heights.append(bbox[3] - bbox[1])
                state.boxes.append(bbox)

                if state.frames_seen <= 3 or frame_idx % CROP_EVERY_N_FRAMES == 0:
                    crop = crop_person(frame, bbox)
                    if crop is not None and crop.size > 0:
                        score = crop_quality_score(frame, bbox)
                        if score <= 0.0:
                            score = 0.02 + 0.06 * min(1.0, (bbox[3] - bbox[1]) / 64.0)
                        _add_crop(state, crop, score)

                frame_ann.append(
                    FrameAnnotation(local_track_id=tid, global_id=None, bbox=bbox, confidence=float(tr.confidence))
                )

            if frame_ann:
                self.annotations_by_frame[frame_idx] = frame_ann
            if on_frame is not None:
                on_frame(frame_idx, frame, frame_ann)
            if on_progress and frame_idx > 0 and frame_idx % 25 == 0:
                on_progress(frame_idx, "tracking")
            frame_idx += 1
        cap.release()

        dropped: dict[str, int] = {}
        drop_ids: set[int] = set()
        track_log: list[dict] = []
        reflections = _reflection_ids(self.tracks)
        for tid, state in list(self.tracks.items()):
            reason = _drop_reason(state, fps) or ("reflection" if tid in reflections else None)
            track_log.append(
                {
                    "raw_track": tid,
                    "start_s": round(state.start_time, 2),
                    "end_s": round(state.last_time, 2),
                    "frames": state.frames_seen,
                    "mean_conf": round(statistics.fmean(state.confidences), 3) if state.confidences else None,
                    "peak_conf": round(max(state.confidences), 3) if state.confidences else None,
                    "median_h": int(statistics.median(state.heights)) if state.heights else None,
                    "dropped": reason,
                }
            )
            if reason:
                dropped[reason] = dropped.get(reason, 0) + 1
                drop_ids.add(tid)
                del self.tracks[tid]
            else:
                state.crop_samples.sort(key=lambda s: s[1], reverse=True)
                del state.crop_samples[CROPS_PER_TRACK:]
        if drop_ids:
            for idx in list(self.annotations_by_frame):
                kept = [a for a in self.annotations_by_frame[idx] if a.local_track_id not in drop_ids]
                if kept:
                    self.annotations_by_frame[idx] = kept
                else:
                    del self.annotations_by_frame[idx]
        if dropped:
            print(f"[multicam] {self.camera_id}: dropped tracks {dropped}; kept {len(self.tracks)}")

        renumber = {
            old: new
            for new, old in enumerate(sorted(self.tracks, key=lambda t: self.tracks[t].start_time), start=1)
        }
        self.tracks = {renumber[old]: st for old, st in self.tracks.items()}
        for st_new, st in self.tracks.items():
            st.local_track_id = st_new
        for idx, anns in self.annotations_by_frame.items():
            for a in anns:
                a.local_track_id = renumber[a.local_track_id]
        for row in track_log:
            row["local_track"] = renumber.get(row["raw_track"])

        avg_yolo = 1.0 / (sum(yolo_times) / len(yolo_times)) if yolo_times else 0.0
        return CameraRunResult(
            camera_id=self.camera_id,
            fps=fps,
            frame_count=n_frames,
            yolo_fps=avg_yolo,
            tracks=self.tracks,
            annotations_by_frame=self.annotations_by_frame,
            timings={
                "total_seconds": time.perf_counter() - t0,
                "avg_yolo_fps": avg_yolo,
                "avg_reid_ms": 0.0,
                "avg_match_ms": 0.0,
            },
            frame_height=frame_h,
            static_hotspots=hotspots,
            dropped_tracks=dropped,
            track_log=track_log,
        )
