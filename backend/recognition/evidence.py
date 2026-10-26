from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger("guardian.recognition.evidence")
_saved_watchlist_keys: set[str] = set()
_watchlist_lock = __import__("threading").Lock()


def _write_jpg(path: Path, frame: np.ndarray) -> bool:
    if frame is None or frame.size == 0:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    return bool(cv2.imwrite(str(path), frame))


def save_watchlist_evidence(
    incidents_dir: Path,
    *,
    camera_id: int,
    track_id: int,
    watchlist_id: str,
    annotated_frame: np.ndarray,
    person_bbox: tuple[int, int, int, int] | None,
    face_crop: np.ndarray,
) -> tuple[str | None, str | None, str | None]:
    key = f"{int(camera_id)}:{int(track_id)}:{watchlist_id}"
    with _watchlist_lock:
        if key in _saved_watchlist_keys:
            return None, None, None
        _saved_watchlist_keys.add(key)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_id = watchlist_id.replace("/", "_")
    base = f"watchlist_{safe_id}_cam{int(camera_id)}_track{int(track_id)}_{stamp}"
    full_name = f"{base}_full.jpg"
    focus_name = f"{base}_focus.jpg"
    face_name = f"{base}_face.jpg"

    focus_frame = face_crop
    if person_bbox is not None and annotated_frame is not None and annotated_frame.size > 0:
        x1, y1, x2, y2 = person_bbox
        h, w = annotated_frame.shape[:2]
        pad_x = int((x2 - x1) * 0.12)
        pad_y = int((y2 - y1) * 0.12)
        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(w, x2 + pad_x)
        cy2 = min(h, y2 + pad_y)
        person = annotated_frame[cy1:cy2, cx1:cx2]
        if person.size > 0:
            focus_frame = person

    ok_full = _write_jpg(incidents_dir / full_name, annotated_frame)
    ok_focus = _write_jpg(incidents_dir / focus_name, focus_frame)
    ok_face = _write_jpg(incidents_dir / face_name, face_crop)

    return (
        full_name if ok_full else None,
        focus_name if ok_focus else None,
        face_name if ok_face else None,
    )


def clear_watchlist_evidence_keys() -> None:
    with _watchlist_lock:
        _saved_watchlist_keys.clear()
