#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
os.environ.setdefault("DEEPFACE_HOME", str(PROJECT_ROOT / "data" / "deepface"))

from watchlist.weights import resolve_recognition_model, weights_status

DISTANCE_METRIC = "cosine"
YUNET_PATH = PROJECT_ROOT / "models" / "face_detection_yunet_2023mar.onnx"
_yunet: cv2.FaceDetectorYN | None = None


def _respond(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def _classify_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "downloading" in msg or "weights" in msg or "weight" in msg:
        return "weights_missing"
    if "face could not be detected" in msg or "no face" in msg:
        return "no_face"
    return "processing_error"


def _yunet_detector() -> cv2.FaceDetectorYN | None:
    global _yunet
    if _yunet is not None:
        return _yunet
    if not YUNET_PATH.is_file():
        return None
    try:
        _yunet = cv2.FaceDetectorYN.create(str(YUNET_PATH), "", (320, 320), 0.45, 0.35, 5000)
    except cv2.error:
        return None
    return _yunet


def _detect_faces_yunet(img: np.ndarray, *, max_width: int = 960) -> list[tuple[int, int, int, int, float]]:
    detector = _yunet_detector()
    if detector is None:
        return []

    work = img
    scale = 1.0
    h, w = img.shape[:2]
    if w > max_width:
        scale = max_width / float(w)
        work = cv2.resize(img, (max_width, max(1, int(round(h * scale)))), interpolation=cv2.INTER_AREA)

    rh, rw = work.shape[:2]
    detector.setInputSize((rw, rh))
    _, faces = detector.detect(work)
    if faces is None or len(faces) == 0:
        return []

    inv = 1.0 / scale
    hits: list[tuple[int, int, int, int, float]] = []
    for row in faces:
        fx, fy, fw, fh, score = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[-1])
        if score < 0.45:
            continue
        hits.append(
            (
                int(round(fx * inv)),
                int(round(fy * inv)),
                int(round(fw * inv)),
                int(round(fh * inv)),
                score,
            )
        )
    return hits


def _detect_face_crop(image_path: Path) -> tuple[np.ndarray, dict] | None:
    img = cv2.imread(str(image_path))
    if img is None or img.size == 0:
        return None

    faces = _detect_faces_yunet(img)
    if not faces:
        return None

    x, y, w, h, _score = max(faces, key=lambda f: f[2] * f[3])
    pad = int(0.18 * max(w, h))
    h_img, w_img = img.shape[:2]
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(w_img, x + w + pad)
    y2 = min(h_img, y + h + pad)
    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return None

    return crop, {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)}


def cmd_probe() -> None:
    status = weights_status()
    if not status["ready"]:
        _respond(
            {
                "ok": False,
                "code": "weights_missing",
                "error": status["setup_hint"],
                **status,
            }
        )
        return

    try:
        from deepface import DeepFace

        _respond({"ok": True, **status, "detector": "yunet+crop"})
    except Exception as exc:
        _respond({"ok": False, "error": str(exc), "code": _classify_error(exc), **status})


def cmd_represent(image_path: str) -> None:
    path = Path(image_path)
    if not path.is_file():
        _respond({"ok": False, "error": f"Image not found: {image_path}", "code": "not_found"})
        return

    status = weights_status()
    resolved = resolve_recognition_model()
    if resolved is None:
        _respond(
            {
                "ok": False,
                "code": "weights_missing",
                "error": status["setup_hint"],
                **status,
            }
        )
        return

    model_name, threshold, _weights_path = resolved

    crop_result = _detect_face_crop(path)
    if crop_result is None:
        _respond(
            {
                "ok": False,
                "code": "no_face",
                "error": "No usable face detected in image (YuNet pre-scan).",
                "model": model_name,
            }
        )
        return

    crop, facial_area = crop_result
    tmp_path: Path | None = None

    try:
        from deepface import DeepFace

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        if not cv2.imwrite(str(tmp_path), crop):
            _respond({"ok": False, "error": "Failed to write face crop", "code": "processing_error"})
            return

        results = DeepFace.represent(
            img_path=str(tmp_path),
            model_name=model_name,
            detector_backend="skip",
            enforce_detection=False,
            align=True,
        )
        if not results:
            _respond({"ok": False, "error": "DeepFace returned no embedding", "code": "processing_error"})
            return

        embedding = results[0].get("embedding")
        if not embedding:
            _respond({"ok": False, "error": "DeepFace returned empty embedding", "code": "processing_error"})
            return

        _respond(
            {
                "ok": True,
                "model": model_name,
                "detector": "yunet+crop",
                "distance_metric": DISTANCE_METRIC,
                "threshold": threshold,
                "embedding": embedding,
                "facial_area": facial_area,
            }
        )
    except Exception as exc:
        code = _classify_error(exc)
        _respond({"ok": False, "error": str(exc), "code": code, "model": model_name})
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def main() -> None:
    if len(sys.argv) < 2:
        _respond({"ok": False, "error": "Usage: deepface_worker.py <probe|represent> [path]"})
        sys.exit(1)

    command = sys.argv[1]
    if command == "probe":
        cmd_probe()
        return
    if command == "represent":
        if len(sys.argv) < 3:
            _respond({"ok": False, "error": "represent requires image path"})
            sys.exit(1)
        cmd_represent(sys.argv[2])
        return

    _respond({"ok": False, "error": f"Unknown command: {command}"})
    sys.exit(1)


if __name__ == "__main__":
    main()
