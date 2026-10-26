from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from experiments.multicam.camera_tracker import CameraRunResult

ROW_H = 128
CROP_W = 64
PER_CAMERA = 6


def write_identity_sheet(results: list[CameraRunResult], out_path: Path) -> Path | None:
    by_gid: dict[int, dict[str, list[np.ndarray]]] = {}
    for res in results:
        for state in sorted(res.tracks.values(), key=lambda s: s.start_time):
            if state.global_id is None:
                continue
            bucket = by_gid.setdefault(state.global_id, {}).setdefault(res.camera_id, [])
            for crop, _ in state.crop_samples[:3]:
                if len(bucket) < PER_CAMERA:
                    bucket.append(crop)
    if not by_gid:
        return None

    cams = [r.camera_id for r in results]
    label_w = 110
    width = label_w + len(cams) * (PER_CAMERA * CROP_W + 16)
    header = 28
    sheet = np.full((header + len(by_gid) * (ROW_H + 8), width, 3), 24, dtype=np.uint8)
    for k, cam in enumerate(cams):
        x0 = label_w + k * (PER_CAMERA * CROP_W + 16)
        cv2.putText(sheet, cam.upper(), (x0, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1, cv2.LINE_AA)
    for row, gid in enumerate(sorted(by_gid)):
        y0 = header + row * (ROW_H + 8)
        cv2.putText(sheet, f"Global #{gid}", (8, y0 + ROW_H // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        for k, cam in enumerate(cams):
            x = label_w + k * (PER_CAMERA * CROP_W + 16)
            for crop in by_gid[gid].get(cam, []):
                tile = cv2.resize(crop, (CROP_W, ROW_H), interpolation=cv2.INTER_AREA)
                sheet[y0 : y0 + ROW_H, x : x + CROP_W] = tile
                x += CROP_W
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return out_path
