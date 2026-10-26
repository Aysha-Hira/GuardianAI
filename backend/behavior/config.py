from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

ENABLE_CONVLSTM = os.getenv("ENABLE_CONVLSTM", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

SEQ_LEN = int(os.getenv("GUARDIAN_BEHAVIOR_SEQ_LEN", "12"))
FRAME_SIZE = int(os.getenv("GUARDIAN_BEHAVIOR_FRAME_SIZE", "128"))
INFERENCE_EVERY_N_FRAMES = int(os.getenv("GUARDIAN_BEHAVIOR_INFER_EVERY", "24"))
ANOMALY_CONFIRMATION_WINDOWS = int(os.getenv("GUARDIAN_ANOMALY_CONFIRM_WINDOWS", "2"))
DEDUP_COOLDOWN_SEC = float(os.getenv("GUARDIAN_ANOMALY_DEDUP_SEC", "45.0"))
WARMUP_WINDOWS = int(os.getenv("GUARDIAN_BEHAVIOR_WARMUP_WINDOWS", "15"))
SPIKE_MAD_MULTIPLIER = float(os.getenv("GUARDIAN_BEHAVIOR_SPIKE_MAD", "2.75"))
STRONG_ANOMALY_FACTOR = float(os.getenv("GUARDIAN_BEHAVIOR_STRONG_FACTOR", "2.2"))
BASELINE_PERCENTILE = float(os.getenv("GUARDIAN_BEHAVIOR_BASELINE_PCT", "92"))
BASELINE_MARGIN = float(os.getenv("GUARDIAN_BEHAVIOR_BASELINE_MARGIN", "1.12"))
SCORE_HISTORY_LEN = int(os.getenv("GUARDIAN_BEHAVIOR_SCORE_HISTORY", "30"))
THRESHOLD_PERCENTILE = float(os.getenv("GUARDIAN_BEHAVIOR_THRESHOLD_PCT", "99.5"))

MODEL_PATH = Path(
    os.getenv(
        "GUARDIAN_BEHAVIOR_MODEL",
        str(PROJECT_ROOT / "models" / "convlstm_autoencoder.pt"),
    )
)
THRESHOLD_PATH = Path(
    os.getenv(
        "GUARDIAN_BEHAVIOR_THRESHOLD",
        str(PROJECT_ROOT / "models" / "convlstm_threshold.json"),
    )
)

BEHAVIOR_DATA_DIR = PROJECT_ROOT / "data" / "behavior"
