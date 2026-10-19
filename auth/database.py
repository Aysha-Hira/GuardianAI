"""Database engine and session factory (PostgreSQL, or SQLite fallback)."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from auth.config import DATA_DIR, DATABASE_URL, IS_SQLITE

DATA_DIR.mkdir(parents=True, exist_ok=True)

if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        future=True,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        future=True,
    )

print(f"[Guardian DB] Using {'SQLite (fallback)' if IS_SQLITE else 'PostgreSQL'}")

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def _migrate_users_table() -> None:
    """Add security columns to databases created before they existed."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("users")}
    additions = {
        "token_version": "INTEGER NOT NULL DEFAULT 1",
        "failed_login_attempts": "INTEGER NOT NULL DEFAULT 0",
        "login_locked_until": "TIMESTAMP WITH TIME ZONE" if not IS_SQLITE else "DATETIME",
        "failed_verify_attempts": "INTEGER NOT NULL DEFAULT 0",
        "verify_locked_until": "TIMESTAMP WITH TIME ZONE" if not IS_SQLITE else "DATETIME",
        "mfa_enabled": "BOOLEAN NOT NULL DEFAULT FALSE" if not IS_SQLITE else "BOOLEAN NOT NULL DEFAULT 0",
        "mfa_code_hash": "VARCHAR(64)",
        "mfa_ticket_hash": "VARCHAR(64)",
        "mfa_purpose": "VARCHAR(10)",
        "mfa_expires": "TIMESTAMP WITH TIME ZONE" if not IS_SQLITE else "DATETIME",
        "mfa_attempts": "INTEGER NOT NULL DEFAULT 0",
        "mfa_sent_at": "TIMESTAMP WITH TIME ZONE" if not IS_SQLITE else "DATETIME",
    }
    with engine.begin() as conn:
        for column, ddl in additions.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {column} {ddl}"))


def init_db() -> None:
    from auth import models  # noqa: F401
    from alerts import db as _alerts_db  # noqa: F401  (alerts table)
    from watchlist import db as _watchlist_db  # noqa: F401  (watchlist table)
    from subscriptions import db as _subscriptions_db  # noqa: F401  (subscriptions table)
    from auth.seed import seed_test_user
    from auth.service import cleanup_pending_registrations, migrate_unverified_users_to_pending

    Base.metadata.create_all(bind=engine)
    _migrate_users_table()
    db = SessionLocal()
    try:
        moved = migrate_unverified_users_to_pending(db)
        if moved:
            print(f"[Guardian Auth] Moved {moved} unverified user(s) to pending registrations.")
        removed = cleanup_pending_registrations(db)
        if removed:
            print(f"[Guardian Auth] Removed {removed} expired pending registration(s).")
        seed_test_user(db)
        db.commit()
    finally:
        db.close()


@contextmanager
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def db_session() -> Generator[Session, None, None]:
    """FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
