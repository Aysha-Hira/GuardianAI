from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RAW = PROJECT_ROOT / "data" / "multicam" / "raw"
META = PROJECT_ROOT / "data" / "multicam" / "metadata"
ZIP_PATH = PROJECT_ROOT / "data" / "multicam" / "citic-mtmc-dev.zip"


@dataclass(frozen=True)
class MulticamPreset:
    id: str
    label: str
    description: str
    location: str
    capture: int
    cam1_file: str
    cam2_file: str
    gt_file: str
    people_hint: str

    @property
    def cam1_zip_path(self) -> str:
        return f"capture{self.capture}/{self.cam1_file}"

    @property
    def cam2_zip_path(self) -> str:
        return f"capture{self.capture}/{self.cam2_file}"

    @property
    def gt_zip_path(self) -> str:
        return f"capture{self.capture}_gt.mot.txt"


PRESETS: dict[str, MulticamPreset] = {
    "capture2_hall": MulticamPreset(
        id="capture2_hall",
        label="Hall wide + segmented",
        description="Same entrance hall room · capture 2 session · 2 people walking overlapping routes.",
        location="hall",
        capture=2,
        cam1_file="HallWide.mp4",
        cam2_file="HallSeg.mp4",
        gt_file="capture2_gt.mot.txt",
        people_hint="2 people",
    ),
    "capture2_passage": MulticamPreset(
        id="capture2_passage",
        label="Passage PF + PC",
        description="Different area — two passageway cameras (not the hall).",
        location="passage",
        capture=2,
        cam1_file="PF.mp4",
        cam2_file="PC.mp4",
        gt_file="capture2_gt.mot.txt",
        people_hint="2 people",
    ),
    "capture2_showroom": MulticamPreset(
        id="capture2_showroom",
        label="Showroom + hall wide",
        description="Showroom camera paired with hall wide — different rooms in the same building.",
        location="mixed",
        capture=2,
        cam1_file="Showroom.mp4",
        cam2_file="HallWide.mp4",
        gt_file="capture2_gt.mot.txt",
        people_hint="2 people",
    ),
}

DEFAULT_PRESET_ID = "capture2_hall"


def list_presets() -> list[dict]:
    return [
        {
            "id": p.id,
            "label": p.label,
            "description": p.description,
            "people_hint": p.people_hint,
            "location": p.location,
            "capture": p.capture,
        }
        for p in PRESETS.values()
    ]


def preset_cache_dir(preset_id: str) -> Path:
    return RAW / "presets" / preset_id


def active_preset_path() -> Path:
    return RAW / "active_preset.json"
