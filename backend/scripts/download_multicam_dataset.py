#!/usr/bin/env python3

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from experiments.multicam.preset_loader import activate_preset
from experiments.multicam.presets import PRESETS

RAW = PROJECT_ROOT / "data" / "multicam" / "raw"
META = PROJECT_ROOT / "data" / "multicam" / "metadata"
ZENODO_URL = (
    "https://zenodo.org/api/records/17512043/files/"
    "GTEC-UDC/citic-mtmc-dataset-v2025-11-03_lfs.zip/content"
)
ZIP_NAME = "citic-mtmc-dev.zip"

FILES_TO_EXTRACT = {
    "capture1/HallWide.mp4": RAW / "camera_01" / "video.mp4",
    "capture1/HallSeg.mp4": RAW / "camera_02" / "video.mp4",
    "capture1_gt.mot.txt": META / "capture1_gt.mot.txt",
    "timesyncs.csv": META / "timesyncs.csv",
    "paths.csv": META / "paths.csv",
}


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}\n  -> {dest}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "GuardianAI/1.0"})
    with urllib.request.urlopen(req, timeout=900) as resp, dest.open("wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"  {done * 100 // total}% ({done // (1024 * 1024)} MB)", end="\r")
    print(f"\nSaved {dest.name} ({dest.stat().st_size // (1024 * 1024)} MB)")


def extract_subset(zip_path: Path) -> None:
    print("Extracting development subset …", flush=True)
    for src, dest in FILES_TO_EXTRACT.items():
        dest.parent.mkdir(parents=True, exist_ok=True)
        pattern = f"*/{src}"
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                match = next((n for n in zf.namelist() if n.endswith(src)), None)
                if match is None:
                    print(f"  WARNING: {src} not found in archive")
                    continue
                dest.write_bytes(zf.read(match))
                print(f"  {dest.relative_to(PROJECT_ROOT)}")
                continue
        except zipfile.BadZipFile:
            pass

        stem = Path(src).name
        tmp_dir = dest.parent / "_extract_tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["unzip", "-j", "-o", str(zip_path), pattern, "-d", str(tmp_dir)],
            check=False,
            capture_output=True,
        )
        extracted = tmp_dir / stem
        if extracted.is_file():
            shutil.move(str(extracted), str(dest))
            print(f"  {dest.relative_to(PROJECT_ROOT)} (via unzip)")
        else:
            print(f"  WARNING: failed to extract {src}")
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download CITIC-MTMC 2-camera dev subset")
    parser.add_argument("--force", action="store_true", help="Re-download even if videos exist")
    parser.add_argument(
        "--preset",
        choices=list(PRESETS.keys()),
        default="capture2_hall",
        help="Which CITIC capture to install into camera_01/02 slots",
    )
    args = parser.parse_args()

    cam1 = RAW / "camera_01" / "video.mp4"
    cam2 = RAW / "camera_02" / "video.mp4"
    if cam1.is_file() and cam2.is_file() and not args.force and args.preset == "capture1_hall":
        print("Development subset already present.")
        print(f"  {cam1}")
        print(f"  {cam2}")
        print(f"\nTo load multi-person hall videos:")
        print("  python scripts/download_multicam_dataset.py --preset capture2_hall")
        return 0

    cache = PROJECT_ROOT / "data" / "multicam" / ZIP_NAME
    if not cache.is_file() or args.force:
        try:
            download(ZENODO_URL, cache)
        except Exception as exc:
            print(f"Download failed: {exc}")
            print("Manual instructions: see data/multicam/README.md")
            return 1

    extract_subset(cache)
    try:
        info = activate_preset(args.preset)
        print(f"\nActivated preset: {info['label']} ({info['people_hint']})")
    except Exception as exc:
        print(f"Preset activation skipped: {exc}")
    print("\nDone. Run:")
    print("  python experiments/multicam_reid.py \\")
    print("    --cam1 data/multicam/raw/camera_01/video.mp4 \\")
    print("    --cam2 data/multicam/raw/camera_02/video.mp4 \\")
    print("    --gt data/multicam/metadata/capture1_gt.mot.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
