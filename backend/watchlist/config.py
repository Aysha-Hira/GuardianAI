from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEEPFACE_HOME = PROJECT_ROOT / "data" / "deepface"
WATCHLIST_DIR = PROJECT_ROOT / "data" / "watchlist"
ENTRIES_JSON = WATCHLIST_DIR / "entries.json"
IMAGES_DIR = WATCHLIST_DIR / "images"
EMBEDDINGS_DIR = WATCHLIST_DIR / "embeddings"

FACE_RECOGNITION_MODEL = os.getenv("GUARDIAN_FACE_MODEL", "ArcFace")
DISTANCE_METRIC = os.getenv("GUARDIAN_FACE_DISTANCE_METRIC", "cosine")
FACE_DETECTOR_BACKEND = os.getenv("GUARDIAN_FACE_DETECTOR", "opencv")

MATCH_THRESHOLD = float(os.getenv("GUARDIAN_FACE_MATCH_THRESHOLD", "0.68"))

ENABLE_FACE_RECOGNITION = os.getenv("ENABLE_FACE_RECOGNITION", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

FACE_RECOGNITION_INTERVAL_SECONDS = float(
    os.getenv("FACE_RECOGNITION_INTERVAL_SECONDS", "2.0")
)
MIN_FACE_WIDTH_PX = int(os.getenv("GUARDIAN_MIN_FACE_WIDTH_PX", "48"))

_deepface_python_default = (
    PROJECT_ROOT / ".venv-deepface" / "Scripts" / "python.exe"
    if os.name == "nt"
    else PROJECT_ROOT / ".venv-deepface" / "bin" / "python"
)
DEEPFACE_VENV_PYTHON = Path(
    os.getenv("GUARDIAN_DEEPFACE_PYTHON", str(_deepface_python_default))
)
DEEPFACE_WORKER_SCRIPT = PROJECT_ROOT / "scripts" / "deepface_worker.py"

DEEPFACE_WORKER_TIMEOUT_SEC = float(os.getenv("GUARDIAN_DEEPFACE_TIMEOUT_SEC", "90"))
