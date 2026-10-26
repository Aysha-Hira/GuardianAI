from __future__ import annotations

import logging
import os
import threading
import time

import numpy as np

logger = logging.getLogger("guardian.tracking.reid")

ENABLED = os.getenv("GUARDIAN_LIVE_REID", "1").strip().lower() not in {"0", "false", "off", "no"}
MODEL_NAME = os.getenv("GUARDIAN_LIVE_REID_MODEL", "osnet_ibn_x1_0")
MIN_CROP_H = 24

_lock = threading.Lock()
_extractor = None
_failed = False
_timing = {"calls": 0, "ms": 0.0}


def available() -> bool:
    return ENABLED and not _failed


def _get():
    global _extractor, _failed
    if _extractor is None and not _failed:
        try:
            from experiments.reid.osnet_extractor import OSNetExtractor

            ext = OSNetExtractor(model_name=MODEL_NAME, flip=False)
            ext._ensure_model()
            _extractor = ext
            logger.info("Live tracker Re-ID: %s on %s", ext.model_name, ext.device)
        except Exception as exc:
            _failed = True
            logger.warning("Live Re-ID unavailable (%s); using colour histograms", exc)
    return _extractor


def embed_boxes(frame: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray | None:
    global _failed
    if not available() or not boxes:
        return None if not available() else np.zeros((0, 512), dtype=np.float32)
    h, w = frame.shape[:2]
    crops = []
    for x1, y1, x2, y2 in boxes:
        x1, y1, x2, y2 = max(0, int(x1)), max(0, int(y1)), min(w, int(x2)), min(h, int(y2))
        if x2 - x1 < 4 or y2 - y1 < 8:
            crops.append(np.zeros((MIN_CROP_H, 12, 3), dtype=np.uint8))
        else:
            crops.append(frame[y1:y2, x1:x2])
    with _lock:
        ext = _get()
        if ext is None:
            return None
        try:
            t0 = time.perf_counter()
            out = ext.embed_batch(crops)
            _timing["calls"] += 1
            _timing["ms"] += (time.perf_counter() - t0) * 1000
            if _timing["calls"] % 500 == 0:
                logger.info("Live Re-ID avg %.1f ms per frame", _timing["ms"] / _timing["calls"])
            return out
        except Exception as exc:
            _failed = True
            logger.warning("Live Re-ID failed (%s); falling back to colour histograms", exc)
            return None


def stats() -> dict:
    calls = _timing["calls"]
    return {
        "enabled": available(),
        "model": getattr(_extractor, "model_name", MODEL_NAME),
        "avg_ms": round(_timing["ms"] / calls, 2) if calls else None,
    }
