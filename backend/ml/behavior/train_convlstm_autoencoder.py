from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from behavior.config import (
    BEHAVIOR_DATA_DIR,
    FRAME_SIZE,
    SEQ_LEN,
    THRESHOLD_PERCENTILE,
)
from behavior.convlstm import ConvLSTMAutoencoder
from behavior.preprocess import frame_to_gray_tensor

MODEL_OUT = ROOT / "models" / "convlstm_autoencoder.pt"
THRESHOLD_OUT = ROOT / "models" / "convlstm_threshold.json"
METRICS_OUT = ROOT / "models" / "convlstm_metrics.json"


def _video_paths() -> list[Path]:
    paths: list[Path] = []
    seen_sizes: set[int] = set()
    for folder in (ROOT / "test_videos", BEHAVIOR_DATA_DIR / "clips", ROOT / "uploads"):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.mp4")):
            name = path.name.lower()
            if name.startswith("_") or "bellevue" in name or "traffic" in name:
                continue
            size = path.stat().st_size
            if size < 200_000:
                continue
            if size in seen_sizes and folder.name == "uploads":
                continue
            seen_sizes.add(size)
            paths.append(path)
    return paths


def _read_clip(path: Path, seq_len: int, size: int, stride: int) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return []
    frames: list[np.ndarray] = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % stride == 0:
            frames.append(frame_to_gray_tensor(frame, size))
        idx += 1
    cap.release()
    if len(frames) < seq_len:
        return []
    clips: list[np.ndarray] = []
    for start in range(0, len(frames) - seq_len + 1, seq_len // 2):
        clip = np.stack(frames[start : start + seq_len], axis=0)
        clips.append(clip)
    return clips


def _synthetic_clip(seq_len: int, size: int, rng: random.Random) -> np.ndarray:
    clip = np.zeros((seq_len, 1, size, size), dtype=np.float32)
    cx = rng.uniform(0.2, 0.8) * size
    cy = rng.uniform(0.2, 0.8) * size
    vx = rng.uniform(-1.5, 1.5)
    vy = rng.uniform(-1.5, 1.5)
    radius = rng.uniform(size * 0.08, size * 0.15)
    yy, xx = np.mgrid[0:size, 0:size]
    for t in range(seq_len):
        blob = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * radius**2))
        clip[t, 0] = np.clip(blob + rng.uniform(0, 0.05), 0, 1)
        cx = np.clip(cx + vx, radius, size - radius)
        cy = np.clip(cy + vy, radius, size - radius)
    return clip


class ClipDataset(Dataset):
    def __init__(self, clips: list[np.ndarray]) -> None:
        self.clips = clips

    def __len__(self) -> int:
        return len(self.clips)

    def __getitem__(self, idx: int) -> torch.Tensor:
        return torch.from_numpy(self.clips[idx])


def build_dataset(max_clips: int, seq_len: int, size: int) -> list[np.ndarray]:
    clips: list[np.ndarray] = []
    for path in _video_paths():
        clips.extend(_read_clip(path, seq_len, size, stride=2))

    if not clips:
        rng = random.Random(42)
        while len(clips) < max(24, max_clips // 2):
            clips.append(_synthetic_clip(seq_len, size, rng))
            if len(clips) >= max_clips:
                break
    else:
        print(f"Loaded {len(clips)} clips from {len(_video_paths())} pedestrian videos")

    rng = random.Random(42)
    rng.shuffle(clips)
    return clips[:max_clips]


def inject_anomaly_clip(seq_len: int, size: int) -> np.ndarray:
    base = _synthetic_clip(seq_len, size, random.Random(99))
    base[seq_len // 2 :, 0] = np.clip(base[seq_len // 2 :, 0] + 0.85, 0, 1)
    return base


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ConvLSTM behavior autoencoder")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--max-clips", type=int, default=256)
    parser.add_argument("--seq-len", type=int, default=SEQ_LEN)
    parser.add_argument("--frame-size", type=int, default=FRAME_SIZE)
    args = parser.parse_args()

    clips = build_dataset(args.max_clips, args.seq_len, args.frame_size)
    if not clips:
        print("No training clips available.")
        sys.exit(1)

    split = max(1, int(len(clips) * 0.85))
    train_clips = clips[:split]
    val_clips = clips[split:] or clips[-4:]

    train_loader = DataLoader(
        ClipDataset(train_clips),
        batch_size=args.batch_size,
        shuffle=True,
    )
    val_loader = DataLoader(ClipDataset(val_clips), batch_size=args.batch_size)

    model = ConvLSTMAutoencoder(seq_len=args.seq_len, img_size=args.frame_size)
    optim = torch.optim.Adam(model.parameters(), lr=args.lr)
    criterion = nn.MSELoss()

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        n_batches = 0
        for batch in train_loader:
            optim.zero_grad()
            pred = model(batch)
            loss = criterion(pred, batch)
            loss.backward()
            optim.step()
            train_loss += float(loss.item())
            n_batches += 1
        train_loss /= max(n_batches, 1)

        model.eval()
        val_errors: list[float] = []
        with torch.no_grad():
            for batch in val_loader:
                err = model.reconstruction_error(batch)
                val_errors.extend(err.tolist())

        print(
            f"epoch {epoch}/{args.epochs}  train_mse={train_loss:.6f}  "
            f"val_mean_mse={np.mean(val_errors):.6f}"
        )

    val_errors_arr = np.array(val_errors, dtype=np.float64)
    threshold = float(np.percentile(val_errors_arr, THRESHOLD_PERCENTILE))
    normal_mean = float(np.mean(val_errors_arr))
    normal_std = float(np.std(val_errors_arr))

    anomaly_tensor = torch.from_numpy(
        inject_anomaly_clip(args.seq_len, args.frame_size)
    ).unsqueeze(0)
    with torch.no_grad():
        anomaly_score = float(model.reconstruction_error(anomaly_tensor).item())

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "seq_len": args.seq_len,
            "frame_size": args.frame_size,
        },
        MODEL_OUT,
    )
    threshold_meta = {
        "threshold": threshold,
        "percentile": THRESHOLD_PERCENTILE,
        "val_mean_mse": normal_mean,
        "val_std_mse": normal_std,
        "synthetic_anomaly_score": anomaly_score,
        "train_clips": len(train_clips),
        "val_clips": len(val_clips),
        "video_sources": [str(p) for p in _video_paths()],
    }
    THRESHOLD_OUT.write_text(json.dumps(threshold_meta, indent=2))
    METRICS_OUT.write_text(
        json.dumps(
            {
                "final_train_mse": train_loss,
                "val_mean_mse": normal_mean,
                "val_std_mse": normal_std,
                "threshold": threshold,
                "synthetic_anomaly_score": anomaly_score,
            },
            indent=2,
        )
    )
    print(f"Saved model -> {MODEL_OUT}")
    print(f"Threshold (p{THRESHOLD_PERCENTILE:g} val MSE) -> {threshold:.6f}")
    print(f"Synthetic anomaly score -> {anomaly_score:.6f}")


if __name__ == "__main__":
    main()
