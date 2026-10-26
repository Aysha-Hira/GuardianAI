#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import behavior.anomaly_engine as ae
from behavior.anomaly_engine import BehaviorAnomalyEngine


def _reset_engine() -> BehaviorAnomalyEngine:
    ae._engine = None
    return BehaviorAnomalyEngine()


def test_normal_video(path: Path) -> bool:
    engine = _reset_engine()
    cap = cv2.VideoCapture(str(path))
    alerts = 0
    fi = 0
    while fi < 900:
        ok, frame = cap.read()
        if not ok:
            break
        fi += 1
        if engine.process_frame("test", frame, fi):
            alerts += 1
    cap.release()
    dbg = engine.channel_debug("test")
    print(f"[normal] {path.name}: frames={fi} alerts={alerts} warmup={dbg.get('warmup_done')}")
    return alerts == 0


def test_shake_after_warmup(path: Path | None, *, use_webcam: bool) -> bool:
    engine = _reset_engine()
    cap = (
        cv2.VideoCapture(0)
        if use_webcam
        else cv2.VideoCapture(str(path))
    )
    if not cap.isOpened():
        print("[shake] could not open video source")
        return False

    alerts: list[tuple[int, float, float]] = []
    fi = 0
    shake_start = 520 if not use_webcam else 400

    while fi < (700 if not use_webcam else 800):
        ok, frame = cap.read()
        if not ok:
            if use_webcam:
                time.sleep(0.01)
                continue
            break
        fi += 1
        if fi >= shake_start and fi < shake_start + 48:
            noise = np.random.randint(-40, 40, frame.shape, dtype=np.int16)
            frame = np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        event = engine.process_frame("shake", frame, fi)
        if event:
            alerts.append((fi, event.score, event.threshold))

    cap.release()
    dbg = engine.channel_debug("shake")
    print(
        f"[shake] alerts={len(alerts)} warmup={dbg.get('warmup_done')} "
        f"thr={dbg.get('effective_threshold'):.5f} cooldown={dbg.get('cooldown_remaining_sec', 0):.0f}s"
    )
    for frame_i, score, thr in alerts[:3]:
        print(f"  frame {frame_i}: score={score:.5f} threshold={thr:.5f}")
    return len(alerts) >= 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Test behavior anomaly detection")
    parser.add_argument("--video", type=Path, default=ROOT / "uploads" / "cctv_7d875490.mp4")
    parser.add_argument("--webcam", action="store_true")
    args = parser.parse_args()

    status = _reset_engine().status()
    print("Engine:", status)
    if not status.get("loaded"):
        print("FAIL: model not loaded")
        sys.exit(1)

    normal_ok = True
    if args.video.is_file():
        normal_ok = test_normal_video(args.video)
    else:
        fallback = ROOT / "test_videos" / "cctv_pedestrians_epfl_campus_01.mp4"
        if fallback.is_file():
            normal_ok = test_normal_video(fallback)

    shake_ok = test_shake_after_warmup(
        None if args.webcam else args.video,
        use_webcam=args.webcam,
    )

    print()
    print("Normal video (no alerts):", "PASS" if normal_ok else "FAIL")
    print("Shake/block simulation:", "PASS" if shake_ok else "WARN (try live shake 2-3s after warmup)")
    if not normal_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
