from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "test_videos"
CACHE_DIR = OUT_DIR / ".cache"
MANIFEST = OUT_DIR / "catalog.json"
EPFL_BASE = "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video{vol}/www"
MALL_ZIP_URL = "http://personal.ie.cuhk.edu.hk/~ccloy/files/datasets/mall_dataset.zip"
CLIP_SECONDS = 90

PEDESTRIAN_CLIPS: list[dict] = [
    {
        "file": "cctv_pedestrians_epfl_campus_01.mp4",
        "url": f"{EPFL_BASE.format(vol=1)}/campus4-c0.avi",
        "scene": "EPFL campus walkway — up to 4 people walking (outdoor, fixed cam)",
        "trim_start": 0,
        "trim_duration": 0,
    },
    {
        "file": "cctv_pedestrians_epfl_terrace_01.mp4",
        "url": f"{EPFL_BASE.format(vol=3)}/terrace1-c0.avi",
        "scene": "EPFL terrace — up to 7 people walking (outdoor plaza, fixed cam)",
        "trim_start": 30,
        "trim_duration": CLIP_SECONDS,
    },
    {
        "file": "cctv_pedestrians_epfl_passageway_01.mp4",
        "url": f"{EPFL_BASE.format(vol=2)}/passageway1-c0.avi",
        "scene": "Train-station passageway — commuters walking (fixed cam, low light)",
        "trim_start": 60,
        "trim_duration": CLIP_SECONDS,
    },
    {
        "file": "cctv_pedestrians_mall_surveillance_01.mp4",
        "source": "mall_zip",
        "scene": "Shopping mall — public surveillance webcam, crowd walking",
        "frame_start": 400,
        "frame_count": 180,
        "fps": 2,
    },
]

TRAFFIC_CLIPS: list[dict] = [
    {
        "file": "cctv_traffic_bellevue_eastgate_01.mp4",
        "gdrive_id": "1ZVFa8uVnSIhfcX7pMmobko6Eo0nGiYOP",
        "source_name": "Bellevue_150th_Eastgate__2017-09-10_18-08-24.mp4",
        "scene": "Bellevue traffic cam — cars + intersection (optional)",
        "trim_start": 120,
        "trim_duration": CLIP_SECONDS,
    },
]


def _require(cmd: str) -> str:
    path = shutil.which(cmd)
    if not path:
        print(f"Missing: {cmd}", file=sys.stderr)
        sys.exit(1)
    return path


def _download_url(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "GuardianAI-test-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=300) as response:
        data = response.read()
    if len(data) < 100_000:
        raise RuntimeError(f"download too small ({len(data)} bytes): {url}")
    dest.write_bytes(data)


def _avi_to_mp4(source: Path, dest: Path, start: int = 0, duration: int = 0) -> int:
    _require("ffmpeg")
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", str(start)]
    if duration > 0:
        cmd += ["-t", str(duration)]
    cmd += [
        "-i",
        str(source),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(dest),
    ]
    subprocess.run(cmd, check=True)
    return dest.stat().st_size


def _mall_frames_to_mp4(dest: Path, frame_start: int, frame_count: int, fps: int) -> int:
    _require("ffmpeg")
    zip_path = CACHE_DIR / "mall_dataset.zip"
    frames_dir = CACHE_DIR / "mall" / "frames"

    if not zip_path.is_file():
        print("  Downloading Mall surveillance dataset (~88 MB)…")
        _download_url(MALL_ZIP_URL, zip_path)

    if not frames_dir.is_dir() or not any(frames_dir.glob("*.jpg")):
        frames_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            members = [m for m in zf.namelist() if m.endswith(".jpg")]
            if not members:
                raise RuntimeError("no JPG frames in mall_dataset.zip")
            for member in members:
                zf.extract(member, CACHE_DIR / "mall")
            extracted = list((CACHE_DIR / "mall").rglob("*.jpg"))
            if extracted and extracted[0].parent != frames_dir:
                for jpg in sorted(extracted):
                    target = frames_dir / jpg.name
                    if not target.exists():
                        shutil.copy2(jpg, target)

    jpgs = sorted(frames_dir.glob("*.jpg"))
    if len(jpgs) < frame_start + frame_count:
        raise RuntimeError(f"mall frames insufficient: have {len(jpgs)}")

    list_file = CACHE_DIR / "mall_list.txt"
    subset = jpgs[frame_start : frame_start + frame_count]
    lines = []
    for jpg in subset:
        lines.append(f"file '{jpg.resolve()}'")
        lines.append(f"duration {1.0 / fps}")
    lines.append(f"file '{subset[-1].resolve()}'")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(fps),
        str(dest),
    ]
    subprocess.run(cmd, check=True)
    return dest.stat().st_size


def _bellevue_trim(gdrive_id: str, source_name: str, dest: Path, start: int, duration: int) -> int:
    try:
        import gdown
    except ImportError:
        raise RuntimeError("pip install gdown for Bellevue traffic clips") from None

    cache = CACHE_DIR / "bellevue" / f"{gdrive_id}_{source_name}"
    legacy = OUT_DIR / "_bellevue_probe.mp4"
    if not cache.is_file():
        if gdrive_id == "1ZVFa8uVnSIhfcX7pMmobko6Eo0nGiYOP" and legacy.is_file():
            cache.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy, cache)
        else:
            cache.parent.mkdir(parents=True, exist_ok=True)
            gdown.download(
                f"https://drive.google.com/uc?id={gdrive_id}",
                str(cache),
                quiet=False,
            )
    tmp = dest.with_suffix(".part.mp4")
    _require("ffmpeg")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(cache),
            "-c",
            "copy",
            str(tmp),
        ],
        check=True,
    )
    tmp.replace(dest)
    return dest.stat().st_size


def _remove_stale() -> None:
    for pattern in ("cctv_street_*.mp4", "cctv_bellevue_*.mp4"):
        for path in OUT_DIR.glob(pattern):
            path.unlink(missing_ok=True)
            print(f"Removed old clip: {path.name}")


def _process_pedestrian(clip: dict) -> tuple[Path, int]:
    out = OUT_DIR / str(clip["file"])
    if clip.get("source") == "mall_zip":
        size = _mall_frames_to_mp4(
            out,
            int(clip["frame_start"]),
            int(clip["frame_count"]),
            int(clip["fps"]),
        )
        return out, size

    url = str(clip["url"])
    cache_name = url.rsplit("/", 1)[-1]
    cached = CACHE_DIR / "epfl" / cache_name
    if not cached.is_file():
        print(f"  Downloading {cache_name}…")
        _download_url(url, cached)

    start = int(clip.get("trim_start") or 0)
    duration = int(clip.get("trim_duration") or 0)
    size = _avi_to_mp4(cached, out, start=start, duration=duration)
    return out, size


def _process_traffic(clip: dict) -> tuple[Path, int]:
    out = OUT_DIR / str(clip["file"])
    size = _bellevue_trim(
        str(clip["gdrive_id"]),
        str(clip["source_name"]),
        out,
        int(clip["trim_start"]),
        int(clip["trim_duration"]),
    )
    return out, size


def main() -> int:
    parser = argparse.ArgumentParser(description="Download pedestrian CCTV test clips")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--traffic", action="store_true", help="Also fetch car traffic cams")
    parser.add_argument("--only", metavar="FILE")
    args = parser.parse_args()

    clips = list(PEDESTRIAN_CLIPS)
    if args.traffic:
        clips += TRAFFIC_CLIPS
    if args.only:
        clips = [c for c in clips if c["file"] == args.only]
        if not clips:
            print(f"Unknown: {args.only}", file=sys.stderr)
            return 1

    if args.list:
        for clip in clips:
            print(f"{clip['file']}\n  {clip['scene']}\n")
        return 0

    _remove_stale()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    failed = 0

    for clip in clips:
        print(f"→ {clip['file']}")
        print(f"  {clip['scene']}")
        try:
            if clip.get("gdrive_id"):
                _, size = _process_traffic(clip)
                camera_type = "pole traffic camera"
            else:
                _, size = _process_pedestrian(clip)
                camera_type = "fixed pedestrian surveillance"
            print(f"  Saved {size:,} bytes")
            manifest.append(
                {
                    **clip,
                    "bytes": size,
                    "camera_type": camera_type,
                    "status": "ok",
                }
            )
        except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            manifest.append({**clip, "status": "failed", "error": str(exc)})
            failed += 1

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nCatalog: {MANIFEST}")
    print("Upload via CCTV 02 → Load Recording.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
