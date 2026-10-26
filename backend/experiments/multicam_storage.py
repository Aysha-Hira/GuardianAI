from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from experiments.multicam_reid import DEFAULT_CAM1, DEFAULT_CAM2

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_ROOT = PROJECT_ROOT / "data" / "multicam" / "raw"

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024

CAMERA_PATHS: dict[int, Path] = {
    1: Path(DEFAULT_CAM1),
    2: Path(DEFAULT_CAM2),
}


def camera_dir(camera_slot: int) -> Path:
    if camera_slot not in CAMERA_PATHS:
        raise ValueError("camera_slot must be 1 or 2")
    return CAMERA_PATHS[camera_slot].parent


def camera_video_path(camera_slot: int) -> Path:
    return CAMERA_PATHS[camera_slot]


def upload_info_path(camera_slot: int) -> Path:
    return camera_dir(camera_slot) / "upload_info.json"


def save_camera_video(camera_slot: int, content: bytes, original_filename: str) -> dict:
    if camera_slot not in CAMERA_PATHS:
        raise ValueError("camera_slot must be 1 or 2")

    ext = Path(original_filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type '{ext or 'unknown'}'. Use MP4, AVI, or MOV.")

    if len(content) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"File too large. Maximum size is {max_mb} MB per camera.")

    if len(content) < 1024:
        raise ValueError("File is too small to be a valid video.")

    dest_dir = camera_dir(camera_slot)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = camera_video_path(camera_slot)
    dest.write_bytes(content)

    info = {
        "original_filename": Path(original_filename).name,
        "size_bytes": len(content),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    upload_info_path(camera_slot).write_text(json.dumps(info, indent=2) + "\n")

    return {
        "ok": True,
        "camera_slot": camera_slot,
        "path": str(dest),
        **info,
    }


def camera_status(camera_slot: int) -> dict:
    path = camera_video_path(camera_slot)
    ready = path.is_file()
    info: dict = {"ready": ready, "path": str(path), "original_filename": None, "size_bytes": None}
    meta_path = upload_info_path(camera_slot)
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text())
            info["original_filename"] = meta.get("original_filename")
            info["size_bytes"] = meta.get("size_bytes")
        except Exception:
            pass
    if ready and info["size_bytes"] is None:
        info["size_bytes"] = path.stat().st_size
        info["original_filename"] = info["original_filename"] or path.name
    return info


def dataset_status() -> dict:
    cam1 = camera_status(1)
    cam2 = camera_status(2)
    return {
        "camera_1": cam1,
        "camera_2": cam2,
        "dataset_ready": cam1["ready"] and cam2["ready"],
    }
