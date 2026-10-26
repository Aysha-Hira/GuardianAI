from __future__ import annotations

import cv2
import numpy as np


def frame_to_gray_tensor(frame: np.ndarray, size: int) -> np.ndarray:
    if frame is None or frame.size == 0:
        raise ValueError("empty frame")
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (size, size), interpolation=cv2.INTER_AREA)
    return (resized.astype(np.float32) / 255.0)[None, ...]


def clip_from_frames(frames: list[np.ndarray], size: int) -> np.ndarray:
    return np.stack([frame_to_gray_tensor(f, size) for f in frames], axis=0)
