from __future__ import annotations

import math
import os

POSTER_MAX_SPAN_PX = 8
POSTER_MIN_VISIBLE_SEC = 1.5

VEHICLE_PHANTOM_MIN_CONF = float(os.getenv("GUARDIAN_VEHICLE_PHANTOM_MIN_CONF", "0.38"))
VEHICLE_STATIONARY_KEEP_CONF = float(os.getenv("GUARDIAN_VEHICLE_STATIONARY_KEEP_CONF", "0.46"))


def _trail_span(trail: list) -> float:
    if len(trail) < 2:
        return 0.0
    xs = [p[0] for p in trail]
    ys = [p[1] for p in trail]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def _vehicle_bbox(track) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = track.bbox
    return int(x1), int(y1), int(x2), int(y2)


def _vehicle_area(track) -> int:
    x1, y1, x2, y2 = _vehicle_bbox(track)
    return max(0, x2 - x1) * max(0, y2 - y1)


def _vehicle_shape(track, frame_h: int) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = _vehicle_bbox(track)
    w = max(1, x2 - x1)
    h = max(1, y2 - y1)
    height_ratio = h / max(frame_h, 1)
    aspect = w / h
    bottom_y_ratio = y2 / max(frame_h, 1)
    return height_ratio, aspect, bottom_y_ratio, (w * h) / max(frame_h * frame_h, 1)


def _looks_like_floor_patch(track, frame_w: int, frame_h: int) -> bool:
    conf = float(getattr(track, "confidence", 0.0) or 0.0)
    height_ratio, aspect, bottom_y_ratio, area_ratio = _vehicle_shape(track, frame_h)

    if conf >= 0.58 and height_ratio >= 0.038:
        return False
    if height_ratio >= 0.055:
        return False

    if height_ratio < 0.038 and aspect > 2.5:
        return True
    if bottom_y_ratio > 0.86 and height_ratio < 0.048 and aspect > 2.2 and conf < 0.52:
        return True
    if area_ratio > 0.11 and height_ratio < 0.065 and conf < 0.48:
        return True
    return False


def filter_static_tracks(tracks: list, frame_w: int, frame_h: int) -> list:
    if len(tracks) <= 1:
        return tracks

    spans = [(track, _trail_span(getattr(track, "trail", None) or [])) for track in tracks]
    max_span = max(span for _, span in spans)

    if max_span < 28:
        return tracks

    kept: list = []
    for track, span in spans:
        if getattr(track, "class_name", "person") != "person":
            kept.append(track)
            continue
        duration = float(getattr(track, "visible_duration", 0.0) or 0.0)
        trail = getattr(track, "trail", None) or []
        if duration < POSTER_MIN_VISIBLE_SEC or len(trail) < 5:
            kept.append(track)
            continue
        if span <= POSTER_MAX_SPAN_PX:
            continue
        kept.append(track)

    return kept if kept else tracks


def filter_phantom_vehicle_tracks(tracks: list, frame_w: int, frame_h: int) -> list:
    if not tracks:
        return tracks

    persons = [t for t in tracks if getattr(t, "class_name", "person") == "person"]
    vehicles = [t for t in tracks if getattr(t, "class_name", "person") != "person"]
    if not vehicles:
        return tracks

    kept_vehicles: list = []
    for track in vehicles:
        conf = float(getattr(track, "confidence", 0.0) or 0.0)
        duration = float(getattr(track, "visible_duration", 0.0) or 0.0)
        span = _trail_span(getattr(track, "trail", None) or [])

        if duration < 0.25:
            kept_vehicles.append(track)
            continue

        if _looks_like_floor_patch(track, frame_w, frame_h):
            if duration >= 0.65 and span <= 6 and conf < VEHICLE_STATIONARY_KEEP_CONF:
                continue

        if conf >= VEHICLE_STATIONARY_KEEP_CONF:
            kept_vehicles.append(track)
            continue

        if conf >= VEHICLE_PHANTOM_MIN_CONF:
            kept_vehicles.append(track)
            continue

        if span >= 8:
            kept_vehicles.append(track)

    return persons + kept_vehicles


def filter_static_vehicle_tracks(tracks: list, frame_w: int, frame_h: int) -> list:
    return tracks


def merge_duplicate_vehicle_tracks(tracks: list, frame_w: int, frame_h: int) -> list:
    if len(tracks) <= 1:
        return tracks

    from detection import vehicle_boxes_duplicate

    persons = [t for t in tracks if getattr(t, "class_name", "person") == "person"]
    vehicles = [t for t in tracks if getattr(t, "class_name", "person") != "person"]
    if len(vehicles) <= 1:
        return tracks

    vehicles.sort(
        key=lambda t: (_vehicle_area(t), float(getattr(t, "confidence", 0.0) or 0.0)),
        reverse=True,
    )
    kept: list = []
    for track in vehicles:
        box = _vehicle_bbox(track)
        if any(vehicle_boxes_duplicate(box, _vehicle_bbox(other)) for other in kept):
            continue
        kept.append(track)
    return persons + kept


def compact_display_ids(tracks: list) -> list:
    if not tracks:
        return tracks
    ordered = sorted(tracks, key=lambda t: int(t.track_id))
    for index, track in enumerate(ordered, start=1):
        track.track_id = index
    return ordered
