#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from detection import load_model
from experiments.multicam.annotator import draw_annotations
from experiments.multicam.camera_tracker import CameraTracker
from experiments.multicam.evaluator import (
    evaluate_cross_camera_pairs,
    parse_mot_gt,
    similarity_analysis_rows,
)
from experiments.multicam.global_identity import GlobalIdentityManager
from experiments.multicam.track_embedding import build_track_embedding
from experiments.multicam.video_output import concat_videos, finalize_mp4, write_annotated_video

OUTPUT_DIR = PROJECT_ROOT / "outputs" / "multicam"
DEFAULT_CAM1 = PROJECT_ROOT / "data" / "multicam" / "raw" / "camera_01" / "video.mp4"
DEFAULT_CAM2 = PROJECT_ROOT / "data" / "multicam" / "raw" / "camera_02" / "video.mp4"
DEFAULT_GT = PROJECT_ROOT / "data" / "multicam" / "metadata" / "capture1_gt.mot.txt"


def _write_video(
    src_path: str,
    annotations: dict,
    out_path: Path,
    *,
    camera_label: str,
    max_frames: int | None,
) -> None:
    write_annotated_video(
        src_path,
        annotations,
        out_path,
        camera_label=camera_label,
        max_frames=max_frames,
    )


def _side_by_side(
    path1: Path,
    path2: Path,
    out_path: Path,
    *,
    label1: str,
    label2: str,
) -> None:
    cap1 = cv2.VideoCapture(str(path1))
    cap2 = cv2.VideoCapture(str(path2))
    fps = float(cap1.get(cv2.CAP_PROP_FPS) or 25.0)
    w1 = int(cap1.get(cv2.CAP_PROP_FRAME_WIDTH))
    h1 = int(cap1.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w2 = int(cap2.get(cv2.CAP_PROP_FRAME_WIDTH))
    h2 = int(cap2.get(cv2.CAP_PROP_FRAME_HEIGHT))
    target_h = min(h1, h2, 720)

    def resize_keep_ar(frame: np.ndarray) -> np.ndarray:
        fh, fw = frame.shape[:2]
        scale = target_h / fh
        nw = int(fw * scale)
        return cv2.resize(frame, (nw, target_h))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    writer = None
    while True:
        r1, f1 = cap1.read()
        r2, f2 = cap2.read()
        if not r1 or not r2:
            break
        f1 = resize_keep_ar(f1)
        f2 = resize_keep_ar(f2)
        cv2.putText(f1, label1, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(f2, label2, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        combined = np.hstack([f1, f2])
        if writer is None:
            writer = cv2.VideoWriter(
                str(out_path),
                cv2.VideoWriter_fourcc(*"mp4v"),
                fps,
                (combined.shape[1], combined.shape[0]),
            )
        writer.write(combined)
    cap1.release()
    cap2.release()
    if writer is not None:
        writer.release()


def _sequential_video(
    path1: Path,
    path2: Path,
    out_path: Path,
    *,
    label2: str = "CAMERA 2",
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    writer: cv2.VideoWriter | None = None
    out_size: tuple[int, int] | None = None
    fps = 25.0

    def append_clip(src: Path, title: str) -> None:
        nonlocal writer, out_size, fps
        cap = cv2.VideoCapture(str(src))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open {src}")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or fps)
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            cv2.putText(
                frame,
                title,
                (12, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            if writer is None:
                out_size = (frame.shape[1], frame.shape[0])
                writer = cv2.VideoWriter(
                    str(out_path),
                    cv2.VideoWriter_fourcc(*"mp4v"),
                    fps,
                    out_size,
                )
            if out_size and (frame.shape[1], frame.shape[0]) != out_size:
                frame = cv2.resize(frame, out_size)
            writer.write(frame)
        cap.release()

    append_clip(path1, "CAMERA 1")
    append_clip(path2, label2)
    if writer is not None:
        writer.release()
        finalize_mp4(out_path)


def tune_threshold(
    manager: GlobalIdentityManager,
    cam1_tracks: dict,
    cam2_tracks: dict,
    reid: OSNetExtractor,
    *,
    min_crops: int,
    max_crops: int,
) -> tuple[float, list[dict]]:
    embeddings: list[tuple[str, int, np.ndarray, int | None]] = []
    for cam_id, tracks in [("camera_01", cam1_tracks), ("camera_02", cam2_tracks)]:
        for tid, st in tracks.items():
            if not st.eligible or st.embedding is None:
                try:
                    emb = build_track_embedding(reid, st.crop_samples, min_crops=min_crops, max_crops=max_crops)
                except ValueError:
                    continue
            else:
                emb = st.embedding
            gid = manager.get_global_id(cam_id, tid)
            embeddings.append((cam_id, tid, emb, gid))

    same, diff = [], []
    for i, (c1, t1, e1, g1) in enumerate(embeddings):
        for j in range(i + 1, len(embeddings)):
            c2, t2, e2, g2 = embeddings[j]
            if c1 == c2:
                continue
            sim = float(np.dot(e1, e2))
            if g1 is not None and g1 == g2:
                same.append(sim)
            else:
                diff.append(sim)

    rows = similarity_analysis_rows(same, diff)
    threshold = 0.78
    if same and diff:
        med_same = float(np.median(same))
        med_diff = float(np.median(diff))
        threshold = round(max(0.40, min(0.75, (med_same + med_diff) / 2)), 2)
    elif diff:
        threshold = round(min(0.75, max(0.40, float(np.median(diff)) + 0.05)), 2)
    return threshold, rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Guardian AI offline multi-camera Re-ID experiment")
    parser.add_argument(
        "--cam1",
        default=str(DEFAULT_CAM1),
        help=f"Camera 1 video (default: {DEFAULT_CAM1.relative_to(PROJECT_ROOT)})",
    )
    parser.add_argument(
        "--cam2",
        default=str(DEFAULT_CAM2),
        help=f"Camera 2 video (default: {DEFAULT_CAM2.relative_to(PROJECT_ROOT)})",
    )
    parser.add_argument(
        "--gt",
        default=str(DEFAULT_GT) if DEFAULT_GT.is_file() else None,
        help="Optional CITIC MOT ground-truth file",
    )
    parser.add_argument("--max-frames", type=int, default=None, help="Limit frames per camera (dev subset)")
    parser.add_argument("--threshold", type=float, default=None, help="Cosine similarity match threshold")
    parser.add_argument("--max-gap", type=float, default=30.0, help="Max cross-camera transition window (seconds)")
    parser.add_argument("--min-crops", type=int, default=3, help="Min crops before track is Re-ID eligible")
    parser.add_argument("--max-crops", type=int, default=10, help="Max crops averaged per track embedding")
    parser.add_argument("--side-by-side", action="store_true", help="Write side-by-side comparison video")
    parser.add_argument(
        "--sequential",
        action="store_true",
        help="Write one video: camera 1 annotated, then camera 2 annotated (back-to-back)",
    )
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Guardian AI — Multi-Camera Re-ID Experiment (offline)")
    print("=" * 60)
    print(f"Camera 1: {args.cam1}")
    print(f"Camera 2: {args.cam2}")
    print("Processing order: Camera 1 first, then Camera 2 (cross-camera Re-ID on cam 2)")

    if not Path(args.cam1).is_file():
        print(f"\nMissing camera 1 video: {args.cam1}")
        print("Run: python scripts/download_multicam_dataset.py")
        return 1
    if not Path(args.cam2).is_file():
        print(f"\nMissing camera 2 video: {args.cam2}")
        print("Run: python scripts/download_multicam_dataset.py")
        return 1

    t_start = time.perf_counter()
    print("\nLoading YOLO …")
    model = load_model()
    print("Loading OSNet Re-ID extractor …")
    reid = OSNetExtractor()
    reid._ensure_model()
    print(f"  Embedding dim: {reid.embedding_dim}")

    global_mgr = GlobalIdentityManager()
    threshold = args.threshold if args.threshold is not None else 0.45

    print("\n--- Processing Camera 1 (local DeepSORT) ---")
    tracker1 = CameraTracker("camera_01", model=model, reid=reid, min_crops=args.min_crops, max_crops=args.max_crops)
    result1 = tracker1.process_video(
        args.cam1,
        global_manager=global_mgr,
        match_threshold=threshold,
        max_gap_seconds=args.max_gap,
        max_frames=args.max_frames,
    )
    print(f"  Frames: {result1.frame_count} | YOLO ~{result1.yolo_fps:.1f} FPS")

    print("\n--- Processing Camera 2 (cross-camera Re-ID) ---")
    tracker2 = CameraTracker("camera_02", model=model, reid=reid, min_crops=args.min_crops, max_crops=args.max_crops)
    result2 = tracker2.process_video(
        args.cam2,
        global_manager=global_mgr,
        match_threshold=threshold,
        max_gap_seconds=args.max_gap,
        max_frames=args.max_frames,
    )
    print(f"  Frames: {result2.frame_count} | YOLO ~{result2.yolo_fps:.1f} FPS")

    tuned_threshold, sim_rows = tune_threshold(
        global_mgr, result1.tracks, result2.tracks, reid,
        min_crops=args.min_crops, max_crops=args.max_crops,
    )
    if args.threshold is None and sim_rows:
        print(f"\nThreshold tuning: suggested cosine threshold = {tuned_threshold}")
    match_threshold_used = args.threshold if args.threshold is not None else threshold

    print("\nWriting annotated videos …")
    ann1 = out_dir / "camera_01_annotated.mp4"
    ann2 = out_dir / "camera_02_annotated.mp4"
    _write_video(args.cam1, result1.annotations_by_frame, ann1, camera_label="CAM 1", max_frames=args.max_frames)
    _write_video(args.cam2, result2.annotations_by_frame, ann2, camera_label="CAM 2", max_frames=args.max_frames)

    if args.side_by_side:
        sbs = out_dir / "side_by_side_annotated.mp4"
        _side_by_side(ann1, ann2, sbs, label1="CAMERA 1", label2="CAMERA 2")
        print(f"  {sbs}")

    if args.sequential:
        seq = out_dir / "sequential_annotated.mp4"
        concat_videos(ann1, ann2, seq)
        print(f"  {seq}  (camera 1, then camera 2)")

    transitions_path = out_dir / "transitions.json"
    transitions_path.write_text(json.dumps(global_mgr.transitions, indent=2) + "\n")

    sim_csv = out_dir / "reid_similarity_analysis.csv"
    if sim_rows:
        pd.DataFrame(sim_rows).to_csv(sim_csv, index=False)

    assign_cam1 = {tid: global_mgr.get_global_id("camera_01", tid) for tid in result1.tracks}
    assign_cam2 = {tid: global_mgr.get_global_id("camera_02", tid) for tid in result2.tracks}
    assign_cam1 = {k: v for k, v in assign_cam1.items() if v is not None}
    assign_cam2 = {k: v for k, v in assign_cam2.items() if v is not None}

    spans1 = {tid: (int(st.start_time * result1.fps), int(st.last_time * result1.fps)) for tid, st in result1.tracks.items()}
    spans2 = {tid: (int(st.start_time * result2.fps), int(st.last_time * result2.fps)) for tid, st in result2.tracks.items()}

    eval_report: dict = {}
    if args.gt and Path(args.gt).is_file():
        gt_spans = parse_mot_gt(args.gt, fps=result1.fps)
        eval_report = evaluate_cross_camera_pairs(
            assign_cam1, assign_cam2, spans1, spans2, gt_spans, fps=result1.fps
        )

    cross_links = len(global_mgr.transitions)
    shared_globals = set(assign_cam1.values()) & set(assign_cam2.values())

    report = {
        "dataset": "CITIC-MTMC capture1 subset (manual/auto)" if args.gt else "user-provided videos",
        "camera_1": str(args.cam1),
        "camera_2": str(args.cam2),
        "reid_model": "OSNet x0.25 (MSMT17)",
        "embedding_dim": reid.embedding_dim,
        "matching_metric": "cosine_similarity",
        "threshold": match_threshold_used,
        "suggested_threshold": tuned_threshold if sim_rows else None,
        "max_cross_camera_gap_seconds": args.max_gap,
        "local_tracks_camera_1": len(result1.tracks),
        "local_tracks_camera_2": len(result2.tracks),
        "global_identities": len(global_mgr.identities),
        "cross_camera_transitions": cross_links,
        "shared_global_ids_across_cameras": len(shared_globals),
        "evaluation": eval_report,
        "performance": {
            "camera_1_yolo_fps": round(result1.yolo_fps, 2),
            "camera_2_yolo_fps": round(result2.yolo_fps, 2),
            "camera_1_reid_ms": round(result1.timings.get("avg_reid_ms", 0), 2),
            "camera_2_reid_ms": round(result2.timings.get("avg_reid_ms", 0), 2),
            "camera_1_match_ms": round(result1.timings.get("avg_match_ms", 0), 2),
            "camera_2_match_ms": round(result2.timings.get("avg_match_ms", 0), 2),
            "total_wall_seconds": round(time.perf_counter() - t_start, 2),
        },
        "outputs": {
            "camera_01_annotated": str(ann1),
            "camera_02_annotated": str(ann2),
            "transitions": str(transitions_path),
            "similarity_analysis": str(sim_csv) if sim_rows else None,
        },
    }
    report_path = out_dir / "experiment_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Re-ID model:      OSNet x0.25 | dim={reid.embedding_dim} | cosine")
    print(f"Threshold:        {match_threshold_used}")
    if sim_rows and args.threshold is None:
        print(f"Suggested (tune): {tuned_threshold}")
    print(f"Local tracks:     cam1={len(result1.tracks)} cam2={len(result2.tracks)}")
    print(f"Global IDs:       {len(global_mgr.identities)}")
    print(f"Cross-camera links: {cross_links} transitions | {len(shared_globals)} shared global IDs")
    if eval_report:
        print(f"GT evaluation:    precision={eval_report.get('pair_precision')} recall={eval_report.get('pair_recall')}")
        print(f"                  ({eval_report.get('note', '')})")
    print(f"\nOutputs -> {out_dir}")
    print(f"  {ann1.name}")
    print(f"  {ann2.name}")
    print(f"  transitions.json")
    print(f"  experiment_report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
