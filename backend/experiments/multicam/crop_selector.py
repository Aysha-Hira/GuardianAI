from __future__ import annotations

import cv2
import numpy as np

MIN_HEIGHT_PX = 64
MIN_WIDTH_PX = 28
MIN_AREA_PX = 1800
EDGE_MARGIN_RATIO = 0.02
MAX_EDGE_TRUNCATION = 0.18


def crop_person(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray | None:
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2].copy()


def crop_quality_score(
    frame: np.ndarray,
    bbox: tuple[int, int, int, int],
) -> float:
    fh, fw = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    bw, bh = x2 - x1, y2 - y1
    if bh < MIN_HEIGHT_PX or bw < MIN_WIDTH_PX or bw * bh < MIN_AREA_PX:
        return 0.0

    margin_x = fw * EDGE_MARGIN_RATIO
    margin_y = fh * EDGE_MARGIN_RATIO
    trunc = 0.0
    if x1 <= margin_x or y1 <= margin_y:
        trunc += 0.25
    if x2 >= fw - margin_x or y2 >= fh - margin_y:
        trunc += 0.25
    if trunc > MAX_EDGE_TRUNCATION:
        return 0.0

    crop = crop_person(frame, bbox)
    if crop is None or crop.size == 0:
        return 0.0

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    blur_penalty = 0.0 if lap_var >= 35.0 else min(0.4, (35.0 - lap_var) / 100.0)

    size_score = min(1.0, (bh / max(fh * 0.45, 1.0)))
    aspect = bh / max(bw, 1)
    aspect_penalty = 0.0 if 1.2 <= aspect <= 4.5 else 0.2

    return max(0.0, size_score - trunc - blur_penalty - aspect_penalty)


def select_track_crops(
    samples: list[tuple[np.ndarray, float]],
    *,
    min_crops: int = 5,
    max_crops: int = 10,
) -> list[np.ndarray]:
    ranked = sorted(samples, key=lambda s: s[1], reverse=True)
    good = [crop for crop, score in ranked if score > 0.15]
    if len(good) < min_crops:
        good = [crop for crop, _ in ranked[:max(min_crops, len(ranked))]]
    return good[:max_crops]
