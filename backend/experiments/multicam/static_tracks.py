from __future__ import annotations

import math

from experiments.multicam.camera_tracker import FrameAnnotation, TrackState

MIN_FLOOR_BOTTOM_RATIO = 0.60


def _track_bboxes(
    track_id: int,
    annotations_by_frame: dict[int, list[FrameAnnotation]],
) -> list[tuple[int, int, int, int]]:
    boxes: list[tuple[int, int, int, int]] = []
    for frame_anns in annotations_by_frame.values():
        for ann in frame_anns:
            if ann.local_track_id == track_id:
                boxes.append(ann.bbox)
    return boxes


def _track_centers(boxes: list[tuple[int, int, int, int]]) -> list[tuple[float, float]]:
    return [((x1 + x2) / 2.0, (y1 + y2) / 2.0) for x1, y1, x2, y2 in boxes]


def _path_length(centers: list[tuple[float, float]]) -> float:
    if len(centers) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(centers)):
        dx = centers[i][0] - centers[i - 1][0]
        dy = centers[i][1] - centers[i - 1][1]
        total += math.hypot(dx, dy)
    return total


def is_wall_mounted_track(
    boxes: list[tuple[int, int, int, int]],
    *,
    frame_h: int,
) -> bool:
    if not boxes or frame_h <= 0:
        return False
    max_bottom = max(y2 for _, _, _, y2 in boxes)
    return (max_bottom / frame_h) < MIN_FLOOR_BOTTOM_RATIO


def is_static_false_positive_track(
    state: TrackState,
    annotations_by_frame: dict[int, list[FrameAnnotation]],
    *,
    frame_h: int,
    min_frames: int = 8,
) -> bool:
    boxes = _track_bboxes(state.local_track_id, annotations_by_frame)
    if len(boxes) < min_frames and state.frames_seen < min_frames:
        return False

    if is_wall_mounted_track(boxes, frame_h=frame_h):
        return True

    centers = _track_centers(boxes)
    if len(centers) < 2:
        return state.frames_seen >= min_frames

    path = _path_length(centers)
    min_travel = max(24.0, frame_h * 0.03)

    xs = [c[0] for c in centers]
    ys = [c[1] for c in centers]
    span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))

    return path < min_travel and span < min_travel * 1.1


def mean_crop_quality(state: TrackState) -> float:
    if not state.crop_samples:
        return 0.0
    return sum(score for _, score in state.crop_samples) / len(state.crop_samples)


def is_eligible_for_global_id(
    state: TrackState,
    annotations_by_frame: dict[int, list[FrameAnnotation]],
    *,
    frame_h: int,
    min_crops: int = 3,
    min_mean_crop_score: float = 0.12,
) -> bool:
    if len(state.crop_samples) < min_crops:
        return False
    if mean_crop_quality(state) < min_mean_crop_score:
        return False
    if is_static_false_positive_track(state, annotations_by_frame, frame_h=frame_h):
        return False
    return True


def remove_static_tracks(
    tracks: dict[int, TrackState],
    annotations_by_frame: dict[int, list[FrameAnnotation]],
    *,
    frame_h: int,
) -> set[int]:
    dropped: set[int] = set()
    for tid, state in list(tracks.items()):
        if is_static_false_positive_track(state, annotations_by_frame, frame_h=frame_h):
            dropped.add(tid)
            del tracks[tid]

    if not dropped:
        return dropped

    for frame_idx, anns in list(annotations_by_frame.items()):
        filtered = [a for a in anns if a.local_track_id not in dropped]
        if filtered:
            annotations_by_frame[frame_idx] = filtered
        else:
            annotations_by_frame.pop(frame_idx, None)

    return dropped
