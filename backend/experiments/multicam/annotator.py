from __future__ import annotations

import cv2
import numpy as np

from experiments.multicam.camera_tracker import FrameAnnotation


def draw_annotations(
    frame: np.ndarray,
    annotations: list[FrameAnnotation],
    *,
    camera_label: str,
) -> np.ndarray:
    out = frame.copy()
    cv2.rectangle(out, (8, 6), (220, 36), (0, 0, 0), -1)
    cv2.putText(
        out,
        camera_label,
        (12, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )
    for ann in annotations:
        x1, y1, x2, y2 = ann.bbox
        color = _global_color(ann.global_id)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        local_text = f"Local #{ann.local_track_id}"
        global_text = f"Global #{ann.global_id}" if ann.global_id is not None else "Global: --"
        label_y = max(18, y1 - 22)
        cv2.rectangle(out, (x1, max(0, label_y - 16)), (x1 + 180, label_y + 22), (0, 0, 0), -1)
        cv2.putText(
            out,
            local_text,
            (x1 + 2, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            out,
            global_text,
            (x1 + 2, label_y + 18),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )
    return out


def _global_color(global_id: int | None) -> tuple[int, int, int]:
    if global_id is None:
        return (128, 128, 128)
    rng = np.random.default_rng(global_id * 9973)
    return tuple(int(c) for c in rng.integers(80, 255, size=3))
