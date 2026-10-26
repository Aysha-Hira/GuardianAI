#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = PROJECT_ROOT / "data" / "severity_training.csv"
MODEL_PATH = PROJECT_ROOT / "models" / "severity_random_forest.joblib"
METRICS_PATH = PROJECT_ROOT / "models" / "severity_metrics.json"

FEATURE_COLUMNS = [
    "event_type",
    "zone_duration_seconds",
    "watchlist_match",
    "watchlist_risk_level",
    "face_match_distance",
    "people_count",
    "hour_of_day",
    "detection_confidence",
    "track_duration_seconds",
    "source_type",
    "restricted_entry",
    "loitering_detected",
]
LABEL_COLUMN = "severity"
CATEGORICAL = ["event_type", "watchlist_risk_level", "source_type"]
NUMERIC = [c for c in FEATURE_COLUMNS if c not in CATEGORICAL]


def load_dataset(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Dataset not found: {path}")
    df = pd.read_csv(path)
    missing = [c for c in FEATURE_COLUMNS + [LABEL_COLUMN] if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing columns: {missing}")
    return df


def build_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
            ("num", "passthrough", NUMERIC),
        ]
    )
    classifier = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    return Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("classifier", classifier),
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Train Random Forest severity model")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--test-size", type=float, default=0.25)
    args = parser.parse_args()

    df = load_dataset(args.dataset)
    X = df[FEATURE_COLUMNS]
    y = df[LABEL_COLUMN].astype(str).str.lower()

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=args.test_size,
        random_state=42,
        stratify=y,
    )

    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)

    metrics = {
        "dataset": str(args.dataset),
        "samples_total": int(len(df)),
        "samples_train": int(len(X_train)),
        "samples_test": int(len(X_test)),
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision_macro": round(float(precision_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "recall_macro": round(float(recall_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "f1_macro": round(float(f1_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "confusion_matrix": confusion_matrix(y_test, y_pred, labels=sorted(y.unique())).tolist(),
        "labels": sorted(y.unique().tolist()),
        "classification_report": classification_report(y_test, y_pred, zero_division=0),
        "note": "Prototype validation on expert-labeled scenario dataset — not production KPIs.",
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(pipeline, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(f"Saved model -> {MODEL_PATH}")
    print(f"Saved metrics -> {METRICS_PATH}")
    print(f"Accuracy: {metrics['accuracy']}")
    print(f"F1 (macro): {metrics['f1_macro']}")
    print("\nClassification report:\n")
    print(metrics["classification_report"])
    print("\nConfusion matrix (rows=true, cols=pred):")
    print(metrics["confusion_matrix"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
