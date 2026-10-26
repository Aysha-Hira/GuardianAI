from __future__ import annotations

import json
import logging
import subprocess
import threading
from pathlib import Path

from watchlist.config import (
    DEEPFACE_VENV_PYTHON,
    DEEPFACE_WORKER_SCRIPT,
    DEEPFACE_WORKER_TIMEOUT_SEC,
    ENABLE_FACE_RECOGNITION,
)
from watchlist.weights import weights_status

logger = logging.getLogger("guardian.recognition.deepface")


class DeepFaceClient:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._probe_cache: bool | None = None
        self._probe_detail: dict | None = None

    def _python(self) -> Path:
        return Path(DEEPFACE_VENV_PYTHON)

    def _worker(self) -> Path:
        return Path(DEEPFACE_WORKER_SCRIPT)

    def is_configured(self) -> bool:
        return self._python().is_file() and self._worker().is_file()

    def probe(self, *, force: bool = False) -> dict:
        with self._lock:
            if self._probe_detail is not None and not force:
                return dict(self._probe_detail)

        if not self.is_configured():
            detail = {
                "ok": False,
                "error": "DeepFace worker not configured (.venv-deepface or script missing)",
            }
            with self._lock:
                self._probe_cache = False
                self._probe_detail = detail
            return detail

        try:
            proc = subprocess.run(
                [str(self._python()), str(self._worker()), "probe"],
                capture_output=True,
                text=True,
                timeout=DEEPFACE_WORKER_TIMEOUT_SEC,
                check=False,
            )
            detail = json.loads(proc.stdout or "{}")
        except subprocess.TimeoutExpired:
            detail = {"ok": False, "error": "DeepFace probe timed out"}
        except json.JSONDecodeError as exc:
            detail = {"ok": False, "error": f"Invalid probe response: {exc}"}
        except Exception as exc:
            detail = {"ok": False, "error": str(exc)}

        with self._lock:
            self._probe_cache = bool(detail.get("ok"))
            self._probe_detail = detail
        if detail.get("ok"):
            logger.info(
                "DeepFace ready — model=%s threshold=%s",
                detail.get("model"),
                detail.get("threshold"),
            )
        else:
            logger.warning("DeepFace unavailable: %s", detail.get("error"))
        return detail

    def live_matching_enabled(self) -> bool:
        if not ENABLE_FACE_RECOGNITION:
            return False
        wstatus = weights_status()
        if not wstatus.get("ready"):
            return False
        if self._probe_cache is None or not self._probe_cache:
            self.probe(force=bool(self._probe_cache is False))
        return bool(self._probe_cache)

    def represent(self, image_path: Path) -> dict:
        if not self.is_configured():
            return {"ok": False, "error": "DeepFace worker not configured"}

        try:
            proc = subprocess.run(
                [str(self._python()), str(self._worker()), "represent", str(image_path)],
                capture_output=True,
                text=True,
                timeout=DEEPFACE_WORKER_TIMEOUT_SEC,
                check=False,
            )
            if proc.stderr:
                logger.debug("DeepFace worker stderr: %s", proc.stderr.strip()[:500])
            return json.loads(proc.stdout or "{}")
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "DeepFace represent timed out"}
        except json.JSONDecodeError as exc:
            return {"ok": False, "error": f"Invalid represent response: {exc}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


deepface_client = DeepFaceClient()
