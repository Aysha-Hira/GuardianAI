from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from experiments.multicam.annotator import draw_annotations
from experiments.multicam.camera_tracker import FrameAnnotation

PREVIEW_MAX_WIDTH = 960


def _maybe_scale(frame: np.ndarray, max_width: int) -> tuple[np.ndarray, float]:
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame, 1.0
    scale = max_width / w
    return cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA), scale


def _scale_bbox(bbox: tuple[int, int, int, int], scale: float) -> tuple[int, int, int, int]:
    if scale == 1.0:
        return bbox
    return tuple(int(round(v * scale)) for v in bbox)


def write_annotated_video(
    src_path: str,
    annotations: dict[int, list[FrameAnnotation]],
    out_path: Path,
    *,
    camera_label: str,
    max_frames: int | None = None,
    preview_max_width: int = PREVIEW_MAX_WIDTH,
) -> None:
    cap = cv2.VideoCapture(src_path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(".tmp.mp4")

    writer: cv2.VideoWriter | None = None
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if max_frames is not None and idx >= max_frames:
            break
        frame, scale = _maybe_scale(frame, preview_max_width)
        if writer is None:
            h, w = frame.shape[:2]
            writer = cv2.VideoWriter(
                str(tmp_path),
                cv2.VideoWriter_fourcc(*"avc1"),
                fps,
                (w, h),
            )
        raw_anns = annotations.get(idx, [])
        scaled_anns = [
            FrameAnnotation(
                local_track_id=ann.local_track_id,
                global_id=ann.global_id,
                bbox=_scale_bbox(ann.bbox, scale),
                confidence=ann.confidence,
            )
            for ann in raw_anns
        ]
        writer.write(draw_annotations(frame, scaled_anns, camera_label=camera_label))
        idx += 1

    cap.release()
    if writer is not None:
        writer.release()
    else:
        tmp_path.unlink(missing_ok=True)
        return

    _finalize_for_streaming(tmp_path, out_path)


def _finalize_for_streaming(src: Path, dest: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        fast = dest.with_suffix(".fast.mp4")
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-movflags",
            "+faststart",
            "-an",
            str(fast),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and fast.is_file() and fast.stat().st_size > 0:
            fast.replace(dest)
            src.unlink(missing_ok=True)
            return

    src.replace(dest)


def concat_videos(path1: Path, path2: Path, out_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if ffmpeg and path1.is_file() and path2.is_file():
        list_file = out_path.with_suffix(".concat.txt")
        list_file.write_text(
            f"file '{path1.resolve()}'\nfile '{path2.resolve()}'\n",
            encoding="utf-8",
        )
        tmp = out_path.with_suffix(".concat.tmp.mp4")
        cmd = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(tmp),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        list_file.unlink(missing_ok=True)
        if result.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 0:
            _finalize_for_streaming(tmp, out_path)
            return
        tmp.unlink(missing_ok=True)

    import cv2
    import numpy as np

    writer = None
    fps = 25.0
    for src in (path1, path2):
        cap = cv2.VideoCapture(str(src))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or fps)
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if writer is None:
                h, w = frame.shape[:2]
                tmp = out_path.with_suffix(".tmp.mp4")
                writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"avc1"), fps, (w, h))
            writer.write(frame)
        cap.release()
    if writer is not None:
        writer.release()
        _finalize_for_streaming(out_path.with_suffix(".tmp.mp4"), out_path)


def finalize_mp4(path: Path) -> None:
    if not path.is_file():
        return
    tmp = path.with_suffix(".finalize.tmp.mp4")
    shutil.copy2(path, tmp)
    _finalize_for_streaming(tmp, path)


def side_by_side_videos(path1: Path, path2: Path, out_path: Path, *, max_height: int = 540) -> None:
    cap1, cap2 = cv2.VideoCapture(str(path1)), cv2.VideoCapture(str(path2))
    if not cap1.isOpened() or not cap2.isOpened():
        return
    fps = float(cap1.get(cv2.CAP_PROP_FPS) or 25.0)
    h = min(int(cap1.get(cv2.CAP_PROP_FRAME_HEIGHT)), int(cap2.get(cv2.CAP_PROP_FRAME_HEIGHT)), max_height)
    h -= h % 2

    def fit(frame: np.ndarray) -> np.ndarray:
        fh, fw = frame.shape[:2]
        w = int(round(fw * h / fh))
        w -= w % 2
        return cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp.mp4")
    writer: cv2.VideoWriter | None = None
    last1 = last2 = None
    while True:
        r1, f1 = cap1.read()
        r2, f2 = cap2.read()
        if not r1 and not r2:
            break
        f1 = fit(f1) if r1 else (np.zeros_like(last1) if last1 is not None else None)
        f2 = fit(f2) if r2 else (np.zeros_like(last2) if last2 is not None else None)
        if f1 is None or f2 is None:
            continue
        last1, last2 = f1, f2
        gap = np.full((h, 8, 3), 18, dtype=np.uint8)
        combined = np.hstack([f1, gap, f2])
        if writer is None:
            size = (combined.shape[1], combined.shape[0])
            writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"avc1"), fps, size)
            if not writer.isOpened():
                writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
        writer.write(combined)
    cap1.release()
    cap2.release()
    if writer is None:
        return
    writer.release()
    _finalize_for_streaming(tmp, out_path)
