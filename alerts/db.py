from __future__ import annotations

import dataclasses
import logging
from typing import Any

from sqlalchemy import JSON, Float, Integer, String, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from auth.database import Base, SessionLocal, engine

logger = logging.getLogger("guardian.alerts.db")

_JSON = JSON().with_variant(JSONB(), "postgresql")


class AlertRecord(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    camera_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    zone_index: Mapped[int] = mapped_column(Integer, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, index=True, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(_JSON, nullable=False)


def ensure_table() -> None:
    Base.metadata.create_all(bind=engine, tables=[AlertRecord.__table__])


def _row_from_alert(alert) -> dict[str, Any]:
    return {
        "id": alert.id,
        "event_type": alert.event_type,
        "camera_id": int(alert.camera_id),
        "track_id": int(alert.track_id),
        "zone_index": int(alert.zone_index),
        "severity": alert.severity,
        "status": alert.status,
        "created_at": float(alert.created_at),
        "updated_at": float(alert.updated_at),
        "data": dataclasses.asdict(alert),
    }


def save_alert(alert) -> None:
    try:
        with SessionLocal() as db:
            db.merge(AlertRecord(**_row_from_alert(alert)))
            db.commit()
    except Exception as exc:
        logger.error("Could not save alert %s: %s", getattr(alert, "id", "?"), exc)


def load_alerts() -> list[dict[str, Any]]:
    try:
        ensure_table()
        with SessionLocal() as db:
            rows = db.execute(select(AlertRecord.data).order_by(AlertRecord.created_at)).scalars().all()
            return [dict(r) for r in rows]
    except Exception as exc:
        logger.error("Could not load alerts from database: %s", exc)
        return []


def delete_all_alerts() -> int:
    from sqlalchemy import delete

    ensure_table()
    with SessionLocal() as db:
        result = db.execute(delete(AlertRecord))
        db.commit()
        return int(result.rowcount or 0)
