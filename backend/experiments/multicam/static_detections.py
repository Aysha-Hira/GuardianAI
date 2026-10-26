from __future__ import annotations

Box = tuple[int, int, int, int]


def box_iou(a: Box, b: Box) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / max(area_a + area_b - inter, 1)


def find_static_hotspots(
    dets_by_frame: dict[int, list[tuple]],
    *,
    fps: float,
    n_frames: int,
    min_iou: float = 0.7,
    min_span_seconds: float = 15.0,
    min_density: float = 0.25,
) -> list[dict]:
    clusters: list[dict] = []
    for frame_idx in sorted(dets_by_frame):
        for det in dets_by_frame[frame_idx]:
            box = tuple(int(v) for v in det[:4])
            best, best_iou = None, min_iou
            for c in clusters:
                iou = box_iou(box, c["box"])
                if iou >= best_iou:
                    best, best_iou = c, iou
            if best is None:
                clusters.append({"sum": list(box), "count": 1, "box": box, "first": frame_idx, "last": frame_idx})
            else:
                best["count"] += 1
                best["sum"] = [s + v for s, v in zip(best["sum"], box)]
                best["box"] = tuple(int(s / best["count"]) for s in best["sum"])
                best["last"] = frame_idx

    min_count = max(int(fps * 6), int(0.04 * max(n_frames, 1)))
    hotspots = []
    for c in clusters:
        span = c["last"] - c["first"] + 1
        if c["count"] < min_count or span < fps * min_span_seconds:
            continue
        if c["count"] / span < min_density:
            continue
        hotspots.append({"box": c["box"], "detections": c["count"], "first_frame": c["first"], "last_frame": c["last"]})
    return hotspots


def drop_static_detections(dets: list[tuple], hotspots: list[dict], *, iou: float = 0.5) -> list[tuple]:
    if not hotspots:
        return dets
    return [d for d in dets if all(box_iou(tuple(int(v) for v in d[:4]), h["box"]) < iou for h in hotspots)]
