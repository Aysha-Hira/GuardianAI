from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]

_lock = threading.Lock()
_yolo: Any | None = None
_yolo_name: str | None = None
_reid: Any | None = None


def offline_yolo_weights() -> str:
    override = os.getenv("MULTICAM_YOLO_MODEL")
    if override:
        return override
    small = PROJECT_ROOT / "yolo11s.pt"
    return str(small) if small.is_file() else "yolo11s.pt"


def get_offline_models():
    global _yolo, _yolo_name, _reid
    with _lock:
        weights = offline_yolo_weights()
        if _yolo is None or _yolo_name != weights:
            from detection import load_model

            try:
                _yolo = load_model(weights)
                _yolo_name = weights
            except Exception as exc:
                print(f"[multicam] Could not load {weights} ({exc}); using live model")
                _yolo = load_model()
                _yolo_name = weights
        if _reid is None:
            from experiments.reid.osnet_extractor import OSNetExtractor

            _reid = OSNetExtractor()
            _reid._ensure_model()
        return _yolo, _reid


def offline_yolo_label() -> str:
    return Path(_yolo_name or offline_yolo_weights()).name
