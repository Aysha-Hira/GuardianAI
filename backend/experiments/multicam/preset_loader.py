from __future__ import annotations

import json
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from experiments.multicam.presets import (
    DEFAULT_PRESET_ID,
    META,
    PRESETS,
    RAW,
    ZIP_PATH,
    MulticamPreset,
    active_preset_path,
    preset_cache_dir,
)

ACTIVE_CAM1 = RAW / "camera_01" / "video.mp4"
ACTIVE_CAM2 = RAW / "camera_02" / "video.mp4"


def _resolve_zip_member(zf: zipfile.ZipFile, suffix: str) -> str | None:
    return next((n for n in zf.namelist() if n.endswith(suffix)), None)


def _extract_member(zip_path: Path, member_suffix: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            member = _resolve_zip_member(zf, member_suffix)
            if member is None:
                raise FileNotFoundError(f"{member_suffix} not found in {zip_path.name}")
            dest.write_bytes(zf.read(member))
            return
    except zipfile.BadZipFile:
        pass

    pattern = f"*/{member_suffix}"
    tmp = dest.parent / "_extract_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["unzip", "-j", "-o", str(zip_path), pattern, "-d", str(tmp)],
        check=False,
        capture_output=True,
    )
    stem = Path(member_suffix).name
    extracted = tmp / stem
    if not extracted.is_file():
        shutil.rmtree(tmp, ignore_errors=True)
        raise FileNotFoundError(f"Failed to extract {member_suffix} from archive")
    shutil.move(str(extracted), str(dest))
    shutil.rmtree(tmp, ignore_errors=True)


def ensure_preset_extracted(preset: MulticamPreset, *, zip_path: Path = ZIP_PATH) -> dict[str, Path]:
    if not zip_path.is_file():
        raise FileNotFoundError(
            f"Dataset archive missing: {zip_path}. Run scripts/download_multicam_dataset.py"
        )

    cache = preset_cache_dir(preset.id)
    cam1 = cache / "camera_01" / "video.mp4"
    cam2 = cache / "camera_02" / "video.mp4"
    gt = META / preset.gt_file

    if not cam1.is_file():
        _extract_member(zip_path, preset.cam1_zip_path, cam1)
    if not cam2.is_file():
        _extract_member(zip_path, preset.cam2_zip_path, cam2)
    if not gt.is_file():
        _extract_member(zip_path, preset.gt_zip_path, gt)

    return {"camera_01": cam1, "camera_02": cam2, "gt": gt}


def activate_preset(preset_id: str) -> dict:
    if preset_id not in PRESETS:
        raise ValueError(f"Unknown preset: {preset_id}")

    preset = PRESETS[preset_id]
    paths = ensure_preset_extracted(preset)

    ACTIVE_CAM1.parent.mkdir(parents=True, exist_ok=True)
    ACTIVE_CAM2.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(paths["camera_01"], ACTIVE_CAM1)
    shutil.copy2(paths["camera_02"], ACTIVE_CAM2)

    revision = int(time.time())
    info = {
        "preset_id": preset.id,
        "label": preset.label,
        "description": preset.description,
        "people_hint": preset.people_hint,
        "location": preset.location,
        "gt_path": str(paths["gt"]),
        "revision": revision,
        "camera_1_bytes": ACTIVE_CAM1.stat().st_size,
        "camera_2_bytes": ACTIVE_CAM2.stat().st_size,
    }
    active_preset_path().write_text(json.dumps(info, indent=2) + "\n")
    return info


def get_active_preset() -> dict:
    path = active_preset_path()
    if path.is_file():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    if ACTIVE_CAM1.is_file() and ACTIVE_CAM2.is_file():
        return {
            "preset_id": DEFAULT_PRESET_ID,
            "label": PRESETS[DEFAULT_PRESET_ID].label,
            "description": "Active videos (preset not recorded)",
            "people_hint": PRESETS[DEFAULT_PRESET_ID].people_hint,
            "gt_path": str(META / PRESETS[DEFAULT_PRESET_ID].gt_file),
        }
    return {
        "preset_id": None,
        "label": None,
        "description": None,
        "people_hint": None,
        "gt_path": None,
    }
