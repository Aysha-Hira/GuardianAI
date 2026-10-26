from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch

from behavior.config import (
    ANOMALY_CONFIRMATION_WINDOWS,
    BASELINE_MARGIN,
    BASELINE_PERCENTILE,
    DEDUP_COOLDOWN_SEC,
    ENABLE_CONVLSTM,
    FRAME_SIZE,
    INFERENCE_EVERY_N_FRAMES,
    MODEL_PATH,
    SCORE_HISTORY_LEN,
    SEQ_LEN,
    SPIKE_MAD_MULTIPLIER,
    STRONG_ANOMALY_FACTOR,
    THRESHOLD_PATH,
    WARMUP_WINDOWS,
)
from behavior.convlstm import ConvLSTMAutoencoder
from behavior.preprocess import clip_from_frames

logger = logging.getLogger(__name__)


@dataclass
class BehaviorAnomalyEvent:
    camera_id: str
    score: float
    threshold: float
    frame_index: int
    snapshot: np.ndarray | None = None


@dataclass
class _ChannelState:
    buffer: deque = field(default_factory=lambda: deque(maxlen=SEQ_LEN))
    warmup_scores: list[float] = field(default_factory=list)
    baseline_scores: deque = field(default_factory=lambda: deque(maxlen=SCORE_HISTORY_LEN))
    frame_counter: int = 0
    consecutive_high: int = 0
    last_alert_ts: float = 0.0
    last_score: float = 0.0
    warmup_done: bool = False
    effective_threshold: float = 0.0


class BehaviorAnomalyEngine:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._channels: dict[str, _ChannelState] = {}
        self._model: ConvLSTMAutoencoder | None = None
        self._device = torch.device("cpu")
        self._global_threshold = 0.05
        self._loaded = False
        self._enabled = ENABLE_CONVLSTM
        self._load_error: str | None = None

        if self._enabled:
            self._try_load()

    def _try_load(self) -> None:
        if not MODEL_PATH.is_file():
            self._load_error = f"model not found: {MODEL_PATH}"
            logger.warning("ConvLSTM disabled: %s", self._load_error)
            return
        try:
            ckpt = torch.load(MODEL_PATH, map_location=self._device, weights_only=False)
            seq_len = int(ckpt.get("seq_len", SEQ_LEN))
            frame_size = int(ckpt.get("frame_size", FRAME_SIZE))
            self._model = ConvLSTMAutoencoder(seq_len=seq_len, img_size=frame_size)
            self._model.load_state_dict(ckpt["state_dict"])
            self._model.to(self._device)
            self._model.eval()
            if THRESHOLD_PATH.is_file():
                meta = json.loads(THRESHOLD_PATH.read_text())
                self._global_threshold = float(meta.get("threshold", self._global_threshold))
            self._loaded = True
            logger.info(
                "ConvLSTM anomaly engine loaded (global threshold=%.6f, warmup=%d windows)",
                self._global_threshold,
                WARMUP_WINDOWS,
            )
        except Exception as exc:
            self._load_error = str(exc)
            logger.exception("ConvLSTM load failed: %s", exc)

    @property
    def available(self) -> bool:
        return self._enabled and self._loaded and self._model is not None

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "loaded": self._loaded,
            "model_path": str(MODEL_PATH),
            "threshold": self._global_threshold,
            "seq_len": SEQ_LEN,
            "frame_size": FRAME_SIZE,
            "infer_every_n_frames": INFERENCE_EVERY_N_FRAMES,
            "confirmation_windows": ANOMALY_CONFIRMATION_WINDOWS,
            "warmup_windows": WARMUP_WINDOWS,
            "spike_mad_multiplier": SPIKE_MAD_MULTIPLIER,
            "dedup_cooldown_sec": DEDUP_COOLDOWN_SEC,
            "error": self._load_error,
        }

    def _state(self, camera_id: str) -> _ChannelState:
        if camera_id not in self._channels:
            st = _ChannelState()
            st.effective_threshold = self._global_threshold
            self._channels[camera_id] = st
        return self._channels[camera_id]

    @staticmethod
    def _mad(values: np.ndarray) -> float:
        if values.size == 0:
            return 0.0
        median = float(np.median(values))
        return float(np.median(np.abs(values - median)))

    def _baseline_array(self, st: _ChannelState) -> np.ndarray:
        return np.array(st.baseline_scores, dtype=np.float64)

    def _update_baseline(self, st: _ChannelState) -> None:
        scores = self._baseline_array(st)
        if scores.size < max(6, WARMUP_WINDOWS // 3):
            st.effective_threshold = self._global_threshold
            return
        baseline = float(np.percentile(scores, BASELINE_PERCENTILE))
        st.effective_threshold = max(
            self._global_threshold,
            baseline * BASELINE_MARGIN,
        )

    def _record_baseline_score(self, st: _ChannelState, score: float) -> None:
        cap = max(st.effective_threshold, self._global_threshold) * 1.3
        if score <= cap:
            st.baseline_scores.append(score)

    def _finish_warmup(self, st: _ChannelState, camera_id: str) -> None:
        arr = np.array(st.warmup_scores, dtype=np.float64)
        cutoff = float(np.percentile(arr, 85))
        for value in st.warmup_scores:
            if value <= cutoff:
                st.baseline_scores.append(value)
        st.warmup_done = True
        self._update_baseline(st)
        logger.info(
            "Behavior baseline calibrated for camera %s (threshold=%.5f, n=%d)",
            camera_id,
            st.effective_threshold,
            len(st.baseline_scores),
        )

    def _strong_score_line(self, st: _ChannelState) -> float:
        return max(
            st.effective_threshold * STRONG_ANOMALY_FACTOR,
            self._global_threshold * 2.5,
        )

    def _is_spike(self, st: _ChannelState, score: float) -> bool:
        if score < st.effective_threshold:
            return False
        if score >= self._strong_score_line(st):
            return True
        scores = self._baseline_array(st)
        if scores.size < 6:
            return True
        median = float(np.median(scores))
        mad = self._mad(scores)
        spread = max(mad, float(scores.std()) * 0.25, st.effective_threshold * 0.02)
        return score >= median + SPIKE_MAD_MULTIPLIER * spread

    def process_frame(
        self,
        camera_id: str,
        frame: np.ndarray,
        frame_index: int,
    ) -> BehaviorAnomalyEvent | None:
        if not self.available or self._model is None:
            return None

        with self._lock:
            st = self._state(camera_id)
            st.buffer.append(frame.copy())
            st.frame_counter += 1

            if len(st.buffer) < SEQ_LEN:
                return None
            if st.frame_counter % INFERENCE_EVERY_N_FRAMES != 0:
                return None

            clip = clip_from_frames(list(st.buffer), FRAME_SIZE)
            tensor = torch.from_numpy(clip).unsqueeze(0).to(self._device)
            score = float(self._model.reconstruction_error(tensor).item())
            st.last_score = score

            if not st.warmup_done:
                st.warmup_scores.append(score)
                if len(st.warmup_scores) < WARMUP_WINDOWS:
                    return None
                self._finish_warmup(st, camera_id)
                return None

            self._record_baseline_score(st, score)
            self._update_baseline(st)

            if not self._is_spike(st, score):
                st.consecutive_high = 0
                return None

            required_windows = ANOMALY_CONFIRMATION_WINDOWS
            if score >= self._strong_score_line(st):
                required_windows = 1

            st.consecutive_high += 1
            if st.consecutive_high < required_windows:
                return None

            now = time.time()
            if now - st.last_alert_ts < DEDUP_COOLDOWN_SEC:
                return None

            st.last_alert_ts = now
            st.consecutive_high = 0
            return BehaviorAnomalyEvent(
                camera_id=camera_id,
                score=score,
                threshold=st.effective_threshold,
                frame_index=frame_index,
                snapshot=frame.copy(),
            )

    def channel_debug(self, camera_id: str) -> dict[str, Any]:
        with self._lock:
            st = self._channels.get(camera_id)
            if st is None:
                return {"buffer_len": 0, "last_score": None}
            return {
                "buffer_len": len(st.buffer),
                "last_score": st.last_score,
                "consecutive_high": st.consecutive_high,
                "warmup_done": st.warmup_done,
                "warmup_progress": len(st.warmup_scores),
                "effective_threshold": st.effective_threshold,
                "baseline_samples": len(st.baseline_scores),
                "cooldown_remaining_sec": max(
                    0.0,
                    DEDUP_COOLDOWN_SEC - (time.time() - st.last_alert_ts),
                )
                if st.last_alert_ts
                else 0.0,
            }


_engine: BehaviorAnomalyEngine | None = None
_engine_lock = threading.Lock()


def get_behavior_engine() -> BehaviorAnomalyEngine:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = BehaviorAnomalyEngine()
        return _engine
