from __future__ import annotations

from detection import bbox_iou
from focus.face_finder import FaceFinder

_face_finder: FaceFinder | None = None
FACE_GATE_MIN_SCORE = 0.40
SPLINTER_IOU_THRESHOLD = 0.40


def _finder() -> FaceFinder:
    global _face_finder
    if _face_finder is None:
        _face_finder = FaceFinder()
    return _face_finder


def _box_area(bbox: tuple[int, int, int, int]) -> int:
    x1, y1, x2, y2 = bbox
    return max(0, x2 - x1) * max(0, y2 - y1)


def _normalize_solo_id(tracks: list) -> list:
    if len(tracks) == 1:
        tracks[0].track_id = 1
    return tracks


def _track_has_face(finder: FaceFinder, track, faces: list) -> bool:
    return any(finder.face_matches_track(face, track.bbox) for face in faces)


def _is_splinter(inner, outer) -> bool:
    iou = bbox_iou(inner.bbox, outer.bbox)
    if iou < SPLINTER_IOU_THRESHOLD:
        return False
    return _box_area(inner.bbox) <= _box_area(outer.bbox) * 0.55


def suppress_contained_tracks(tracks: list) -> list:
    if len(tracks) <= 1:
        return tracks

    ordered = sorted(tracks, key=lambda t: _box_area(t.bbox), reverse=True)
    kept: list = []
    for track in ordered:
        if any(_is_splinter(track, larger) for larger in kept):
            continue
        kept.append(track)
    return kept


def _drop_faceless_splinters(tracks: list, face_indices: set[int]) -> list:
    kept: list = []
    for i, track in enumerate(tracks):
        if i in face_indices:
            kept.append(track)
            continue
        if any(
            i != j and _is_splinter(track, tracks[j])
            for j in face_indices
        ):
            continue
        kept.append(track)
    return kept


def filter_tracks_with_faces(frame, tracks: list) -> list:
    if not tracks:
        return tracks

    tracks = suppress_contained_tracks(tracks)
    if len(tracks) == 1:
        return tracks

    faces = [
        f
        for f in _finder().scan_faces(frame)
        if f.confidence >= FACE_GATE_MIN_SCORE
    ]
    if not faces:
        return tracks

    finder = _finder()
    face_indices = {
        i for i, track in enumerate(tracks) if _track_has_face(finder, track, faces)
    }
    if not face_indices:
        return tracks

    return _drop_faceless_splinters(tracks, face_indices)
