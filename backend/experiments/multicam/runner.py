from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pandas as pd

from experiments.multicam.camera_tracker import CameraTracker
from experiments.multicam.evaluator import evaluate_cross_camera_pairs, parse_mot_gt
from experiments.multicam.diagnostics import write_identity_sheet
from experiments.multicam.global_identity import GlobalIdentityManager
from experiments.multicam.identity_clustering import assign_global_identities
from experiments.multicam.model_cache import get_offline_models, offline_yolo_label
from experiments.multicam.video_output import concat_videos, side_by_side_videos, write_annotated_video
from experiments.multicam_reid import (
    DEFAULT_CAM1,
    DEFAULT_CAM2,
    DEFAULT_GT,
    OUTPUT_DIR,
    _side_by_side,
    tune_threshold,
)

ProgressFn = Callable[[str, str], None]


@dataclass
class MulticamRunConfig:
    cam1: str = str(DEFAULT_CAM1)
    cam2: str = str(DEFAULT_CAM2)
    gt: str | None = str(DEFAULT_GT) if DEFAULT_GT.is_file() else None
    max_frames: int | None = None
    threshold: float | None = 0.5
    max_gap: float = 30.0
    min_crops: int = 3
    max_crops: int = 10
    sequential: bool = True
    side_by_side: bool = False
    frame_stride: int = 1
    yolo_imgsz: int = 640
    yolo_preprocess: bool = False
    output_dir: str = str(OUTPUT_DIR)


def run_multicam_experiment(
    config: MulticamRunConfig,
    *,
    on_progress: ProgressFn | None = None,
) -> dict:
    def progress(phase: str, message: str) -> None:
        if on_progress:
            on_progress(phase, message)

    cam1_path = Path(config.cam1)
    cam2_path = Path(config.cam2)
    if not cam1_path.is_file():
        raise FileNotFoundError(f"Camera 1 video missing: {cam1_path}")
    if not cam2_path.is_file():
        raise FileNotFoundError(f"Camera 2 video missing: {cam2_path}")

    out_dir = Path(config.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t_start = time.perf_counter()
    progress("loading", "Loading models (cached after first run)…")
    model, reid = get_offline_models()

    global_mgr = GlobalIdentityManager()
    threshold = config.threshold if config.threshold is not None else 0.5

    def cam_progress(label: str, frame_idx: int, total: int | None, stage: str = "") -> None:
        if frame_idx > 0 and frame_idx % 25 == 0:
            phase = "camera_1" if "1" in label else "camera_2"
            step = f" ({stage})" if stage else ""
            progress(phase, f"{label}{step}: frame {frame_idx}/{total or '?'}")

    import cv2

    def _frame_total(path: Path) -> int | None:
        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            return None
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        if config.max_frames is not None:
            return min(total, config.max_frames)
        return total if total > 0 else None

    total1 = _frame_total(cam1_path)
    progress("camera_1", f"Processing Camera 1 — 0/{total1 or '?'} frames")
    tracker1 = CameraTracker(
        "camera_01", model=model, reid=reid, min_crops=config.min_crops, max_crops=config.max_crops
    )
    result1 = tracker1.process_video(
        str(cam1_path),
        max_frames=config.max_frames,
        frame_stride=config.frame_stride,
        yolo_imgsz=config.yolo_imgsz,
        yolo_preprocess=config.yolo_preprocess,
        on_progress=lambda i, stage="": cam_progress("Camera 1", i, total1, stage),
    )

    total2 = _frame_total(cam2_path)
    progress("camera_2", f"Processing Camera 2 — 0/{total2 or '?'} frames")
    tracker2 = CameraTracker(
        "camera_02", model=model, reid=reid, min_crops=config.min_crops, max_crops=config.max_crops
    )
    result2 = tracker2.process_video(
        str(cam2_path),
        max_frames=config.max_frames,
        frame_stride=config.frame_stride,
        yolo_imgsz=config.yolo_imgsz,
        yolo_preprocess=config.yolo_preprocess,
        on_progress=lambda i, stage="": cam_progress("Camera 2", i, total2, stage),
    )

    progress("camera_2", "Matching identities across cameras…")
    clustering = assign_global_identities(
        [result1, result2], global_mgr, reid, threshold=threshold, max_crops=config.max_crops
    )
    write_identity_sheet([result1, result2], out_dir / "identities.jpg")
    diag_dir = out_dir / "_diag"
    diag_dir.mkdir(parents=True, exist_ok=True)
    emb_dump = clustering.pop("_embeddings", None)
    if emb_dump is not None:
        import numpy as _np
        from experiments.multicam.preset_loader import get_active_preset

        try:
            preset = (get_active_preset() or {}).get("preset_id") or "custom"
        except Exception:
            preset = "custom"
        _np.savez_compressed(diag_dir / f"embeddings_{preset}.npz", **emb_dump)
    (diag_dir / "tracks.json").write_text(
        json.dumps(
            {
                "camera_01": {"hotspots": result1.static_hotspots, "tracks": result1.track_log},
                "camera_02": {"hotspots": result2.static_hotspots, "tracks": result2.track_log},
                "clustering": clustering.pop("per_track", []),
                "similarity_matrix": clustering.pop("similarity_matrix", None),
            },
            indent=1,
            default=str,
        )
        + "\n"
    )

    tuned_threshold, sim_rows = tune_threshold(
        global_mgr,
        result1.tracks,
        result2.tracks,
        reid,
        min_crops=config.min_crops,
        max_crops=config.max_crops,
    )
    match_threshold_used = config.threshold if config.threshold is not None else threshold

    progress("writing", "Writing annotated videos and logs…")
    ann1 = out_dir / "camera_01_annotated.mp4"
    ann2 = out_dir / "camera_02_annotated.mp4"
    write_annotated_video(
        str(cam1_path), result1.annotations_by_frame, ann1,
        camera_label="CAM 1", max_frames=config.max_frames,
    )
    write_annotated_video(
        str(cam2_path), result2.annotations_by_frame, ann2,
        camera_label="CAM 2", max_frames=config.max_frames,
    )

    seq_path = None
    if config.sequential:
        seq_path = out_dir / "sequential_annotated.mp4"
        concat_videos(ann1, ann2, seq_path)

    sbs_path = out_dir / "side_by_side_annotated.mp4"
    sbs_path.unlink(missing_ok=True)
    progress("writing", "Writing side-by-side video…")
    side_by_side_videos(ann1, ann2, sbs_path)

    transitions_path = out_dir / "transitions.json"
    transitions_path.write_text(json.dumps(global_mgr.transitions, indent=2) + "\n")

    sim_csv = out_dir / "reid_similarity_analysis.csv"
    if sim_rows:
        pd.DataFrame(sim_rows).to_csv(sim_csv, index=False)

    assign_cam1 = {
        tid: global_mgr.get_global_id("camera_01", tid)
        for tid in result1.tracks
        if global_mgr.get_global_id("camera_01", tid) is not None
    }
    assign_cam2 = {
        tid: global_mgr.get_global_id("camera_02", tid)
        for tid in result2.tracks
        if global_mgr.get_global_id("camera_02", tid) is not None
    }
    spans1 = {
        tid: (int(st.start_time * result1.fps), int(st.last_time * result1.fps))
        for tid, st in result1.tracks.items()
    }
    spans2 = {
        tid: (int(st.start_time * result2.fps), int(st.last_time * result2.fps))
        for tid, st in result2.tracks.items()
    }

    eval_report: dict = {}
    if config.gt and Path(config.gt).is_file():
        gt_spans = parse_mot_gt(config.gt, fps=result1.fps)
        eval_report = evaluate_cross_camera_pairs(
            assign_cam1, assign_cam2, spans1, spans2, gt_spans, fps=result1.fps
        )
        eval_report["gt_people"] = len(gt_spans)
        eval_report["predicted_identities"] = len(global_mgr.identities)

    shared_globals = set(assign_cam1.values()) & set(assign_cam2.values())
    report = {
        "dataset": "CITIC-MTMC capture1 hall subset",
        "camera_1": str(cam1_path),
        "camera_2": str(cam2_path),
        "reid_model": f"{reid.model_name} (MSMT17, flip TTA)",
        "detector": offline_yolo_label(),
        "identity_matching": clustering,
        "static_hotspots": {
            "camera_1": len(result1.static_hotspots),
            "camera_2": len(result2.static_hotspots),
        },
        "dropped_tracks": {"camera_1": result1.dropped_tracks, "camera_2": result2.dropped_tracks},
        "embedding_dim": reid.embedding_dim,
        "matching_metric": "cosine_similarity",
        "threshold": clustering.get("threshold_used", match_threshold_used),
        "suggested_threshold": tuned_threshold if sim_rows else None,
        "max_cross_camera_gap_seconds": config.max_gap,
        "local_tracks_camera_1": len(result1.tracks),
        "local_tracks_camera_2": len(result2.tracks),
        "global_identities": len(global_mgr.identities),
        "cross_camera_transitions": len(global_mgr.transitions),
        "shared_global_ids_across_cameras": len(shared_globals),
        "transitions": global_mgr.transitions,
        "evaluation": eval_report,
        "performance": {
            "camera_1_yolo_fps": round(result1.yolo_fps, 2),
            "camera_2_yolo_fps": round(result2.yolo_fps, 2),
            "camera_1_reid_ms": round(result1.timings.get("avg_reid_ms", 0), 2),
            "camera_2_reid_ms": round(result2.timings.get("avg_reid_ms", 0), 2),
            "total_wall_seconds": round(time.perf_counter() - t_start, 2),
            "max_frames": config.max_frames,
            "frame_stride": config.frame_stride,
            "yolo_imgsz": config.yolo_imgsz,
        },
        "videos": {
            "camera_01": "camera_01_annotated.mp4",
            "camera_02": "camera_02_annotated.mp4",
            "sequential": "sequential_annotated.mp4" if seq_path and seq_path.is_file() else None,
            "side_by_side": "side_by_side_annotated.mp4" if sbs_path and sbs_path.is_file() else None,
        },
    }
    report_path = out_dir / "experiment_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    progress("completed", "Experiment finished.")
    return report
