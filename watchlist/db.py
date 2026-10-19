"""Watchlist table. Face photo + embedding are stored ENCRYPTED (Fernet, key from .env)."""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Float, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from auth.database import Base, engine

# Generate with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
_KEY_ENV = "GUARDIAN_DATA_KEY"


class WatchlistRecord(Base):
    __tablename__ = "watchlist_entries"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    model: Mapped[str] = mapped_column(String(40), nullable=False)
    distance_metric: Mapped[str] = mapped_column(String(20), nullable=False)
    match_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    image_enc: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    embedding_enc: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


def ensure_table() -> None:
    Base.metadata.create_all(bind=engine, tables=[WatchlistRecord.__table__])


_fernet: Fernet | None = None


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.getenv(_KEY_ENV, "").strip()
        if not key:
            raise RuntimeError(
                f"{_KEY_ENV} is not set in .env — run scripts/setup_postgres.sh "
                "(or generate a key) before using the face watchlist."
            )
        _fernet = Fernet(key.encode())
    return _fernet


def encrypt(data: bytes) -> bytes:
    return fernet().encrypt(data)


def decrypt(token: bytes) -> bytes:
    try:
        return fernet().decrypt(bytes(token))
    except InvalidToken as exc:
        raise RuntimeError(f"Watchlist data could not be decrypted — wrong {_KEY_ENV}?") from exc
