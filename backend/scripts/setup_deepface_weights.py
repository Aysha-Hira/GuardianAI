#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEIGHTS_DIR = PROJECT_ROOT / "data" / "deepface" / ".deepface" / "weights"

MIRRORS = {
    "facenet512": {
        "filename": "facenet512_weights.h5",
        "model": "Facenet512",
        "urls": [
            "https://huggingface.co/WePrompt/deepface-weights/resolve/main/facenet512_weights.h5",
        ],
    },
    "arcface": {
        "filename": "arcface_weights.h5",
        "model": "ArcFace",
        "urls": [
            "https://github.com/serengil/deepface_models/releases/download/v1.0/arcface_weights.h5",
        ],
    },
    "retinaface": {
        "filename": "retinaface.h5",
        "model": "RetinaFace detector",
        "urls": [
            "https://huggingface.co/Hodfa71/deepface-weights/resolve/main/retinaface.h5",
        ],
    },
}


def download(url: str, dest: Path) -> None:
    print(f"Downloading\n  {url}\n  -> {dest}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "GuardianAI/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp, dest.open("wb") as out:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Install DeepFace weights for offline use")
    parser.add_argument(
        "--model",
        choices=["facenet512", "arcface", "retinaface", "all"],
        default="facenet512",
        help="facenet512 recommended when GitHub is blocked (default)",
    )
    parser.add_argument("--manual", action="store_true", help="Print manual install paths only")
    args = parser.parse_args()

    if args.manual:
        print(f"Place weight files in:\n  {WEIGHTS_DIR}\n")
        for key, meta in MIRRORS.items():
            print(f"- {meta['filename']} ({meta['model']})")
            for url in meta["urls"]:
                print(f"    {url}")
        return 0

    targets = list(MIRRORS.keys()) if args.model == "all" else [args.model]
    for key in targets:
        meta = MIRRORS[key]
        dest = WEIGHTS_DIR / meta["filename"]
        if dest.is_file() and dest.stat().st_size > 1_000_000:
            print(f"Already present: {dest}")
            continue
        last_err: Exception | None = None
        for url in meta["urls"]:
            try:
                download(url, dest)
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                print(f"Failed: {exc}")
        if last_err is not None:
            print(
                f"\nCould not download {meta['filename']}. "
                f"Try from a network without GitHub blocks, then copy to:\n  {dest}\n"
                f"Or run: python scripts/setup_deepface_weights.py --manual"
            )
            return 1

    print("\nDone. Restart the FastAPI server and retry enrollment.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
