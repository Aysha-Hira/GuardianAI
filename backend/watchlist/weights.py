from __future__ import annotations

from pathlib import Path

from watchlist.config import DEEPFACE_HOME, DISTANCE_METRIC

WEIGHTS_DIR = DEEPFACE_HOME / ".deepface" / "weights"

SUPPORTED_MODELS: tuple[tuple[str, str, float], ...] = (
    ("arcface_weights.h5", "ArcFace", 0.68),
    ("facenet512_weights.h5", "Facenet512", 0.40),
    ("facenet_weights.h5", "Facenet", 0.45),
)


def weights_dir() -> Path:
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    return WEIGHTS_DIR


def resolve_recognition_model() -> tuple[str, float, Path] | None:
    for filename, model_name, threshold in SUPPORTED_MODELS:
        path = weights_dir() / filename
        if path.is_file() and path.stat().st_size > 1_000_000:
            return model_name, threshold, path
    return None


def weights_status() -> dict:
    resolved = resolve_recognition_model()
    installed = [
        {"file": name, "model": model, "path": str(weights_dir() / name), "present": (weights_dir() / name).is_file()}
        for name, model, _ in SUPPORTED_MODELS
    ]
    if resolved:
        model_name, threshold, path = resolved
        return {
            "ready": True,
            "model": model_name,
            "weights_file": path.name,
            "weights_path": str(path),
            "distance_metric": DISTANCE_METRIC,
            "threshold": threshold,
            "installed": installed,
        }
    return {
        "ready": False,
        "model": None,
        "weights_file": None,
        "weights_path": None,
        "distance_metric": DISTANCE_METRIC,
        "threshold": None,
        "installed": installed,
        "setup_hint": (
            "Model weights are missing. GitHub downloads are blocked on many workplace networks. "
            "Run: python scripts/setup_deepface_weights.py "
            "Or manually copy arcface_weights.h5 or facenet512_weights.h5 into "
            f"{weights_dir()}"
        ),
    }
