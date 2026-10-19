from __future__ import annotations

import logging
import threading
import time
from typing import Any

import numpy as np
from sqlalchemy import select

from auth.database import SessionLocal
from watchlist import db as wl_db
from watchlist.config import DISTANCE_METRIC
from watchlist.weights import resolve_recognition_model

logger = logging.getLogger("guardian.watchlist")


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-12:
        return 1.0
    return float(1.0 - np.dot(a, b) / denom)


def _emb_to_bytes(embedding: list[float]) -> bytes:
    return np.asarray(embedding, dtype=np.float32).tobytes()


def _bytes_to_emb(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=np.float32).copy()


class WatchlistStore:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: list[dict[str, Any]] = []
        self._embeddings: dict[str, np.ndarray] = {}
        self._loaded = False

    @staticmethod
    def _meta(rec: wl_db.WatchlistRecord) -> dict[str, Any]:
        return {
            "id": rec.id,
            "name": rec.name,
            "category": rec.category,
            "risk_level": rec.risk_level,
            "notes": rec.notes or "",
            "model": rec.model,
            "distance_metric": rec.distance_metric,
            "match_threshold": rec.match_threshold,
            "created_at": rec.created_at,
            "updated_at": rec.updated_at,
        }

    def _load(self) -> None:
        if self._loaded:
            return
        self._entries, self._embeddings = [], {}
        try:
            wl_db.ensure_table()
            with SessionLocal() as db:
                records = db.execute(
                    select(wl_db.WatchlistRecord).order_by(wl_db.WatchlistRecord.id)
                ).scalars().all()
                for rec in records:
                    self._entries.append(self._meta(rec))
                    try:
                        self._embeddings[rec.id] = _bytes_to_emb(wl_db.decrypt(rec.embedding_enc))
                    except RuntimeError as exc:
                        logger.error("Watchlist %s: %s", rec.id, exc)
        except Exception as exc:
            logger.error("Could not load watchlist from database: %s", exc)
        self._loaded = True
        logger.info("Watchlist loaded: %d identities", len(self._entries))

    def _next_id(self) -> str:
        max_num = 0
        for entry in self._entries:
            wid = str(entry.get("id", ""))
            if wid.startswith("WL-"):
                try:
                    max_num = max(max_num, int(wid.split("-", 1)[1]))
                except ValueError:
                    continue
        return f"WL-{max_num + 1:04d}"

    @staticmethod
    def _public_entry(entry: dict[str, Any]) -> dict[str, Any]:
        resolved = resolve_recognition_model()
        default_model = resolved[0] if resolved else "ArcFace"
        default_threshold = resolved[1] if resolved else 0.68
        return {
            "id": entry.get("id"),
            "name": entry.get("name"),
            "category": entry.get("category"),
            "risk_level": entry.get("risk_level"),
            "notes": entry.get("notes", ""),
            "model": entry.get("model", default_model),
            "distance_metric": entry.get("distance_metric", DISTANCE_METRIC),
            "match_threshold": entry.get("match_threshold", default_threshold),
            "image_file": f"{entry.get('id')}.jpg",
            "created_at": entry.get("created_at"),
            "updated_at": entry.get("updated_at"),
        }

    def list_entries(self) -> list[dict[str, Any]]:
        with self._lock:
            self._load()
            return [self._public_entry(e) for e in self._entries]

    def get_entry(self, entry_id: str) -> dict[str, Any] | None:
        with self._lock:
            self._load()
            for entry in self._entries:
                if entry.get("id") == entry_id:
                    return self._public_entry(entry)
        return None

    def has_entries(self) -> bool:
        with self._lock:
            self._load()
            return len(self._entries) > 0

    def image_bytes(self, entry_id: str) -> bytes | None:
        with SessionLocal() as db:
            rec = db.get(wl_db.WatchlistRecord, entry_id)
            if rec is None:
                return None
            return wl_db.decrypt(rec.image_enc)

    def add_entry(
        self,
        *,
        name: str,
        category: str,
        risk_level: str,
        notes: str,
        image_bytes: bytes,
        embedding: list[float],
        model: str | None = None,
        match_threshold: float | None = None,
    ) -> dict[str, Any]:
        resolved = resolve_recognition_model()
        active_model = model or (resolved[0] if resolved else "ArcFace")
        active_threshold = (
            match_threshold
            if match_threshold is not None
            else (resolved[1] if resolved else 0.68)
        )
        with self._lock:
            self._load()
            entry_id = self._next_id()
            now = time.time()
            rec = wl_db.WatchlistRecord(
                id=entry_id,
                name=name,
                category=category,
                risk_level=risk_level,
                notes=notes,
                model=active_model,
                distance_metric=DISTANCE_METRIC,
                match_threshold=float(active_threshold),
                image_enc=wl_db.encrypt(image_bytes),
                embedding_enc=wl_db.encrypt(_emb_to_bytes(embedding)),
                created_at=now,
                updated_at=now,
            )
            with SessionLocal() as db:
                db.add(rec)
                db.commit()
                meta = self._meta(rec)
            self._entries.append(meta)
            self._embeddings[entry_id] = np.asarray(embedding, dtype=np.float32)
            logger.info("Watchlist entry saved: %s (%s)", entry_id, name)
            return self._public_entry(meta)

    def remove_entry(self, entry_id: str) -> bool:
        with self._lock:
            self._load()
            with SessionLocal() as db:
                rec = db.get(wl_db.WatchlistRecord, entry_id)
                if rec is None:
                    return False
                db.delete(rec)
                db.commit()
            self._entries = [e for e in self._entries if e.get("id") != entry_id]
            self._embeddings.pop(entry_id, None)
        logger.info("Watchlist entry removed: %s", entry_id)
        return True

    def replace_image(
        self,
        entry_id: str,
        *,
        image_bytes: bytes,
        embedding: list[float],
    ) -> dict[str, Any] | None:
        with self._lock:
            self._load()
            entry = next((e for e in self._entries if e.get("id") == entry_id), None)
            if entry is None:
                return None
            now = time.time()
            with SessionLocal() as db:
                rec = db.get(wl_db.WatchlistRecord, entry_id)
                if rec is None:
                    return None
                rec.image_enc = wl_db.encrypt(image_bytes)
                rec.embedding_enc = wl_db.encrypt(_emb_to_bytes(embedding))
                rec.updated_at = now
                db.commit()
            entry["updated_at"] = now
            self._embeddings[entry_id] = np.asarray(embedding, dtype=np.float32)
            return self._public_entry(entry)

    def match_embedding(self, embedding: list[float]) -> dict[str, Any]:
        query = np.asarray(embedding, dtype=np.float32)
        resolved = resolve_recognition_model()
        threshold = resolved[1] if resolved else 0.68
        model_name = resolved[0] if resolved else "ArcFace"

        with self._lock:
            self._load()
            if not self._entries:
                return {"matched": False, "distance": None, "threshold": threshold}

            best: dict[str, Any] | None = None
            best_distance = float("inf")
            for entry in self._entries:
                stored = self._embeddings.get(entry["id"])
                if stored is None:
                    continue
                if DISTANCE_METRIC == "cosine":
                    distance = _cosine_distance(query, stored)
                else:
                    distance = float(np.linalg.norm(query - stored))
                if distance < best_distance:
                    best_distance = distance
                    best = entry

            if best is None:
                return {"matched": False, "distance": None, "threshold": threshold}

            matched = best_distance <= threshold
            return {
                "matched": matched,
                "watchlist_id": best.get("id") if matched else None,
                "name": best.get("name") if matched else None,
                "risk_level": best.get("risk_level") if matched else None,
                "category": best.get("category") if matched else None,
                "distance": round(best_distance, 4),
                "threshold": threshold,
                "distance_metric": DISTANCE_METRIC,
                "model": model_name,
            }

    def reload(self) -> None:
        with self._lock:
            self._loaded = False
            self._load()


watchlist_store = WatchlistStore()
