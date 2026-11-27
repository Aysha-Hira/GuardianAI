from __future__ import annotations
from urllib.parse import quote

import dataclasses
import logging
import os
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np
from ultralytics import YOLO

from inference_device import resolve_inference_device

logger = logging.getLogger("guardian.detection")

BACKEND_DIR = "/backend"
PROJECT_ROOT = "../../GuardianAI"

DEFAULT_WEIGHTS = "yolo11n.pt"
JPEG_QUALITY = 82

# Class ids. In COCO and in the CrowdHuman fine-tune (0 = person, 1 = head) person is 0.
PERSON_CLASS_ID = 0

YOLO_CONF = float(os.getenv("GUARDIAN_YOLO_CONF", "0.35"))
YOLO_IMGSZ = int(os.getenv("GUARDIAN_YOLO_IMGSZ", "640"))
USE_CLAHE = os.getenv("GUARDIAN_USE_CLAHE", "0") == "1"
HEAD_CLASS_ID = int(os.getenv("GUARDIAN_HEAD_CLASS", "1"))
BODY_CLASS_ID = int(os.getenv("GUARDIAN_BODY_CLASS", "0"))
DETECT_VEHICLES = 0
is_plausible_vehicle_box = 0
vehicle_boxes_duplicate = 0

Detection = tuple[int, int, int, int, float, str]


# --------------------------------------------------------------------------- model


def yolo_inference_device() -> str:
    """Device string for Ultralytics predict(device=...)."""
    device = resolve_inference_device()
    return "cuda:0" if device == "cuda" else device


def load_model() -> YOLO:
    """Load YOLO once and move it to the best available device."""
    return YOLO("models/yolo11m_crowdhuman.pt")


def preprocess_for_detection(frame: np.ndarray) -> np.ndarray:
    """CLAHE contrast boost on the lightness channel; helps dark or washed-out footage."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(
        cv2.merge((clahe.apply(l_chan), a_chan, b_chan)), cv2.COLOR_LAB2BGR
    )


def detect_objects(model, frame, *, conf=None, imgsz=None):
    source = preprocess_for_detection(frame) if USE_CLAHE else frame
    results = model(
        source,
        classes=[HEAD_CLASS_ID, BODY_CLASS_ID],
        conf=YOLO_CONF if conf is None else conf,
        imgsz=YOLO_IMGSZ if imgsz is None else imgsz,
        device=yolo_inference_device(),
        verbose=False,
    )
    bodies, heads = [], []
    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
            cls_id = int(box.cls[0])
            det = (x1, y1, x2, y2, float(box.conf[0]), "person")
            (bodies if cls_id == BODY_CLASS_ID else heads).append(det)

    # ---- everything below runs once, after all boxes are collected ----
    h_, w_ = frame.shape[:2]
    orphan_heads = [
        estimate_body_bbox_from_head(h, w_, h_)
        for h in heads
        if not any(is_head_associated_with_body(h, b) for b in bodies)
    ]
    return bodies + orphan_heads


def estimate_body_bbox_from_head(h, frame_w, frame_h):
    x1, y1, x2, y2, conf, label = h
    hw, hh = x2 - x1, y2 - y1
    cx = (x1 + x2) // 2
    bw = int(hw * 2.2)
    return (
        max(0, cx - bw // 2),
        max(0, y1),
        min(frame_w - 1, cx + bw // 2),
        min(frame_h - 1, y1 + int(hh * 7)),
        conf * 0.8,  # lower confidence since the body is estimated
        label,
    )


def is_head_associated_with_body(h, b):
    cx, cy = (h[0] + h[2]) / 2, (h[1] + h[3]) / 2
    bh = b[3] - b[1]
    hh = h[3] - h[1]
    in_x = b[0] <= cx <= b[2]
    in_top = b[1] - 0.1 * bh <= cy <= b[1] + 0.35 * bh  # top third of body
    # head much smaller than body
    size_ok = hh <= 0.4 * bh
    return in_x and in_top and size_ok


def open_webcam(
    index: int = 0, width: int = 1280, height: int = 720
) -> cv2.VideoCapture:
    """Open camera `index` and confirm it returns a frame. Raises RuntimeError on failure.

    camera_service.py tries several indices and treats an exception as "this index is
    unavailable", so failing loudly here is intentional.
    """
    if os.name == "nt":
        backends: Sequence[int] = (cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY)
    else:
        backends = (cv2.CAP_ANY,)
    for backend in backends:
        cap = cv2.VideoCapture(index, backend)
        if not cap.isOpened():
            cap.release()
            continue
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, _ = cap.read()
        if ok:
            return cap
        cap.release()
    raise RuntimeError(f"Could not open camera index {index}")


os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"


def open_rtsp_camera(
    ip: str,
    code: str,
    stream: str = "h264/ch1/sub/av_stream",
    timeout_ms: int = 5000,
) -> cv2.VideoCapture:
    """Open an EZVIZ RTSP camera and confirm it returns a frame."""
    url = f"rtsp://admin:{quote(code, safe='')}@{ip}:554/{stream}"

    cap = cv2.VideoCapture(
        url,
        cv2.CAP_FFMPEG,
        [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms,
        ],
    )

    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f"Could not connect to RTSP camera: {ip}")

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    ok, _ = cap.read()
    if not ok:
        cap.release()
        raise RuntimeError(
            f"RTSP camera connected but returned no frames: {ip}")

    return cap
# --------------------------------------------------------------------------- boxes


def bbox_iou(a: Sequence[float], b: Sequence[float]) -> float:
    """Intersection-over-union of two (x1, y1, x2, y2) boxes."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def is_plausible_person_box(
    x1: int, y1: int, x2: int, y2: int, frame_w: int, frame_h: int, conf: float = 1.0
) -> bool:
    """Reject boxes that are too small, too thin/wide or too low-confidence to be a person."""
    w, h = x2 - x1, y2 - y1
    if w <= 0 or h <= 0 or frame_w <= 0 or frame_h <= 0:
        return False
    if conf < 0.2:
        return False
    if h / frame_h < 0.04 or (w * h) / (frame_w * frame_h) < 0.0008:
        return False
    if h < 24 or w < 10:
        return False
    aspect = h / max(w, 1)
    if (
        aspect < 0.7 or aspect > 6.5
    ):  # people sitting can be wider than tall; keep a margin
        return False
    return True


def scale_tracks_for_display(tracks: Sequence[Any], scale: float) -> list[Any]:
    """Return copies of tracks with boxes/centres/trails multiplied by `scale`."""
    if not tracks or abs(scale - 1.0) < 1e-6:
        return list(tracks)

    def pt(p: tuple[int, int]) -> tuple[int, int]:
        return int(p[0] * scale), int(p[1] * scale)

    scaled = []
    for t in tracks:
        x1, y1, x2, y2 = t.bbox
        scaled.append(
            dataclasses.replace(
                t,
                bbox=(
                    int(x1 * scale),
                    int(y1 * scale),
                    int(x2 * scale),
                    int(y2 * scale),
                ),
                center=pt(t.center),
                bottom_center=pt(t.bottom_center),
                trail=[pt(p) for p in t.trail],
            )
        )
    return scaled
