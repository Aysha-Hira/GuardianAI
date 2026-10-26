from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from alerts.features import FEATURE_COLUMNS, SeverityContext
from alerts.models import EventType, Severity
from alerts.severity import severity_for_event, severity_for_watchlist_risk

logger = logging.getLogger("guardian.alerts.severity")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_PATH = PROJECT_ROOT / "models" / "severity_random_forest.joblib"
DEFAULT_METRICS_PATH = PROJECT_ROOT / "models" / "severity_metrics.json"

ENABLE_RF_SEVERITY = os.getenv("ENABLE_RF_SEVERITY", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


@dataclass(frozen=True)
class SeverityPrediction:
    severity: str
    source: str
    rule_severity: str
    probabilities: dict[str, float] | None = None

    def to_metadata(self) -> dict[str, Any]:
        return {
            "severity_source": self.source,
            "rule_severity": self.rule_severity,
            "severity_probs": self.probabilities,
        }


class SeverityScorer:

    def __init__(
        self,
        model_path: Path | None = None,
        metrics_path: Path | None = None,
    ) -> None:
        self._model_path = model_path or DEFAULT_MODEL_PATH
        self._metrics_path = metrics_path or DEFAULT_METRICS_PATH
        self._lock = threading.Lock()
        self._pipeline = None
        self._classes: list[str] = []
        self._metrics: dict[str, Any] = {}
        self._load_error: str | None = None

    @property
    def ready(self) -> bool:
        return self._pipeline is not None

    @property
    def metrics(self) -> dict[str, Any]:
        return dict(self._metrics)

    def load(self, *, force: bool = False) -> bool:
        with self._lock:
            if self._pipeline is not None and not force:
                return True
            if not ENABLE_RF_SEVERITY:
                self._load_error = "Random Forest severity disabled (ENABLE_RF_SEVERITY=0)"
                return False
            if not self._model_path.is_file():
                self._load_error = f"Severity model not found: {self._model_path}"
                logger.warning(self._load_error)
                return False
            try:
                import joblib

                self._pipeline = joblib.load(self._model_path)
                self._classes = list(getattr(self._pipeline, "classes_", []))
                if self._metrics_path.is_file():
                    self._metrics = json.loads(self._metrics_path.read_text(encoding="utf-8"))
                self._load_error = None
                logger.info("Random Forest severity model loaded from %s", self._model_path)
                return True
            except Exception as exc:
                self._pipeline = None
                self._load_error = str(exc)
                logger.warning("Failed to load severity model: %s", exc)
                return False

    @staticmethod
    def _rule_severity(context: SeverityContext) -> str:
        if context.event_type == EventType.WATCHLIST_MATCH:
            return severity_for_watchlist_risk(context.watchlist_risk_level)
        return severity_for_event(context.event_type)

    def predict(self, context: SeverityContext) -> SeverityPrediction:
        rule = self._rule_severity(context)
        if context.event_type == EventType.BEHAVIOR_ANOMALY:
            return SeverityPrediction(severity=rule, source="rules", rule_severity=rule)
        if not ENABLE_RF_SEVERITY:
            return SeverityPrediction(severity=rule, source="rules", rule_severity=rule)

        if self._pipeline is None and not self.load():
            return SeverityPrediction(
                severity=rule,
                source="rules",
                rule_severity=rule,
            )

        try:
            import pandas as pd

            row = context.to_feature_row()
            frame = pd.DataFrame([{col: row[col] for col in FEATURE_COLUMNS}])
            predicted = self._pipeline.predict(frame)[0]
            severity = str(predicted).lower()
            if severity not in Severity.ALL:
                severity = rule

            probs: dict[str, float] | None = None
            if hasattr(self._pipeline, "predict_proba"):
                raw = self._pipeline.predict_proba(frame)[0]
                classes = list(getattr(self._pipeline, "classes_", []))
                probs = {
                    str(cls).lower(): round(float(p), 4)
                    for cls, p in zip(classes, raw, strict=False)
                }

            return SeverityPrediction(
                severity=severity,
                source="random_forest",
                rule_severity=rule,
                probabilities=probs,
            )
        except Exception as exc:
            logger.warning("RF severity prediction failed, using rules: %s", exc)
            return SeverityPrediction(severity=rule, source="rules", rule_severity=rule)

    def status(self) -> dict[str, Any]:
        self.load()
        return {
            "enabled": ENABLE_RF_SEVERITY,
            "ready": self.ready,
            "model_path": str(self._model_path),
            "metrics": self._metrics,
            "error": self._load_error,
        }


severity_scorer = SeverityScorer()
