from __future__ import annotations

import importlib
import os
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

from experiments.multicam.runner import MulticamRunConfig, run_multicam_experiment
from experiments.multicam_storage import camera_video_path, dataset_status
from experiments.multicam_reid import DEFAULT_CAM1, DEFAULT_CAM2, OUTPUT_DIR

PROJECT_ROOT = Path(__file__).resolve().parent.parent

_RELOAD_ORDER = [
    "experiments.multicam.crop_selector",
    "experiments.multicam.offline_detection",
    "experiments.multicam.static_detections",
    "experiments.multicam.offline_tracker",
    "experiments.multicam.camera_tracker",
    "experiments.multicam.track_embedding",
    "experiments.multicam.global_identity",
    "experiments.multicam.global_assign",
    "experiments.multicam.identity_clustering",
    "experiments.multicam.diagnostics",
    "experiments.multicam.annotator",
    "experiments.multicam.video_output",
    "experiments.multicam.evaluator",
    "experiments.multicam_reid",
    "experiments.multicam.runner",
]


def _fresh_runner():
    if os.getenv("MULTICAM_HOT_RELOAD", "1").strip().lower() in {"0", "false", "no", "off"}:
        return MulticamRunConfig, run_multicam_experiment
    for name in _RELOAD_ORDER:
        module = sys.modules.get(name)
        try:
            importlib.reload(module) if module is not None else importlib.import_module(name)
        except Exception:
            traceback.print_exc()
            return MulticamRunConfig, run_multicam_experiment
    runner = sys.modules["experiments.multicam.runner"]
    return runner.MulticamRunConfig, runner.run_multicam_experiment


class MulticamExperimentService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._phase = "idle"
        self._message = "Ready"
        self._error: str | None = None
        self._report: dict[str, Any] | None = None

    def _set_progress(self, phase: str, message: str) -> None:
        with self._lock:
            self._phase = phase
            self._message = message

    def _load_saved_report(self) -> dict[str, Any] | None:
        path = OUTPUT_DIR / "experiment_report.json"
        if not path.is_file():
            return None
        import json

        try:
            return json.loads(path.read_text())
        except Exception:
            return None

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            running = self._thread is not None and self._thread.is_alive()
            report = self._report or self._load_saved_report()
            ds = dataset_status()
            videos = report.get("videos", {}) if report else {}
            return {
                "running": running,
                "phase": self._phase if running else ("completed" if report else "idle"),
                "message": self._message,
                "error": self._error,
                "dataset_ready": ds["dataset_ready"],
                "camera_1": ds["camera_1"],
                "camera_2": ds["camera_2"],
                "camera_1_path": str(DEFAULT_CAM1),
                "camera_2_path": str(DEFAULT_CAM2),
                "report": report,
                "videos": videos,
            }

    def is_running(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def source_video_path(self, camera_slot: int) -> Path | None:
        if camera_slot not in (1, 2):
            return None
        path = camera_video_path(camera_slot)
        return path if path.is_file() else None

    def start(
        self,
        *,
        max_frames: int | None = None,
        threshold: float | None = 0.5,
        sequential: bool = True,
        side_by_side: bool = False,
        fast_mode: bool = True,
    ) -> dict[str, Any]:
        with self._lock:
            if self._thread and self._thread.is_alive():
                raise RuntimeError("Experiment already running")
            self._error = None
            self._report = None
            self._phase = "starting"
            self._message = "Starting experiment…"

        config_cls, run_fn = _fresh_runner()
        config = config_cls(
            max_frames=max_frames,
            threshold=threshold,
            sequential=sequential,
            side_by_side=side_by_side,
            frame_stride=1,
            yolo_imgsz=640 if fast_mode else 832,
            yolo_preprocess=False,
        )

        def worker() -> None:
            try:
                report = run_fn(config, on_progress=self._set_progress)
                with self._lock:
                    self._report = report
                    self._phase = "completed"
                    self._message = "Experiment completed."
            except Exception as exc:
                with self._lock:
                    self._error = str(exc)
                    self._phase = "error"
                    self._message = str(exc)
                    traceback.print_exc()

        self._thread = threading.Thread(target=worker, daemon=True)
        self._thread.start()
        return {"ok": True, "message": "Experiment started"}

    def video_path(self, filename: str) -> Path | None:
        allowed = {
            "camera_01_annotated.mp4",
            "camera_02_annotated.mp4",
            "sequential_annotated.mp4",
            "side_by_side_annotated.mp4",
        }
        if filename not in allowed:
            return None
        path = OUTPUT_DIR / filename
        return path if path.is_file() else None


multicam_service = MulticamExperimentService()
