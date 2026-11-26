from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from auth.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CameraRecord(Base):
    __tablename__ = "camera"
    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    camera_name: Mapped[str] = mapped_column(
        String(36), nullable=False, unique=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    url_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)
