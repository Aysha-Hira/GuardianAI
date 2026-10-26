from __future__ import annotations

from detection import YOLO, PERSON_CLASS_ID

OFFLINE_YOLO_CONF = 0.12


def is_plausible_offline_person_box(
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    frame_w: int,
    frame_h: int,
    confidence: float = 1.0,
) -> bool:
    w = x2 - x1
    h = y2 - y1
    if w <= 0 or h <= 0 or frame_w <= 0 or frame_h <= 0:
        return False

    height_ratio = h / frame_h
    width_ratio = w / frame_w
    area_ratio = (w * h) / (frame_w * frame_h)
    aspect = h / max(w, 1)

    if height_ratio < 0.025:
        return False
    if width_ratio < 0.012 and height_ratio < 0.05:
        return False
    if area_ratio < 0.0005:
        return False
    if aspect < 0.9 or aspect > 6.0:
        return False
    if h < 20 or w < 8:
        return False
    return True


def filter_offline_person_detections(
    detections: list[tuple[int, int, int, int, float]],
    frame_w: int,
    frame_h: int,
) -> list[tuple[int, int, int, int, float]]:
    filtered = []
    for det in detections:
        x1, y1, x2, y2, conf = det[:5]
        if not is_plausible_offline_person_box(x1, y1, x2, y2, frame_w, frame_h, conf):
            continue
        filtered.append(det)
    return suppress_splinter_detections(filtered)


def suppress_splinter_detections(
    detections: list[tuple[int, int, int, int, float]],
) -> list[tuple[int, int, int, int, float]]:
    if len(detections) <= 1:
        return detections
    ordered = sorted(detections, key=lambda d: (d[2] - d[0]) * (d[3] - d[1]), reverse=True)
    kept: list[tuple[int, int, int, int, float]] = []
    for det in ordered:
        x1, y1, x2, y2 = det[:4]
        area = max(1, (x2 - x1) * (y2 - y1))
        h = y2 - y1
        nested = False
        for k in kept:
            ix = max(0, min(x2, k[2]) - max(x1, k[0]))
            iy = max(0, min(y2, k[3]) - max(y1, k[1]))
            if (ix * iy) / area > 0.85 and h < 0.55 * (k[3] - k[1]):
                nested = True
                break
        if not nested:
            kept.append(det)
    return kept


def detect_persons_offline(
    model: YOLO,
    frame,
    *,
    preprocess: bool = False,
    imgsz: int = 640,
    conf: float = OFFLINE_YOLO_CONF,
):
    from detection import USE_CLAHE, preprocess_for_detection, yolo_inference_device

    input_frame = preprocess_for_detection(frame) if (preprocess and USE_CLAHE) else frame
    results = model(
        input_frame,
        classes=[PERSON_CLASS_ID],
        conf=conf,
        verbose=False,
        imgsz=imgsz,
        device=yolo_inference_device(),
    )

    detections: list[tuple[int, int, int, int, float]] = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            detections.append((x1, y1, x2, y2, float(box.conf[0])))

    frame_h, frame_w = frame.shape[:2]
    return filter_offline_person_detections(detections, frame_w, frame_h)
