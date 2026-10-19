"""
Copy users + pending registrations from the old SQLite file (data/guardian.db) into PostgreSQL,
and create all tables. Safe to run more than once (existing rows are skipped).

    .venv/bin/python scripts/migrate_to_postgres.py
"""
from __future__ import annotations

import os
import sys
from datetime import timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, inspect, select  # noqa: E402

from auth.config import DATABASE_PATH, IS_SQLITE  # noqa: E402
from auth.database import Base, SessionLocal, init_db  # noqa: E402
from auth.models import PendingRegistration, User  # noqa: E402


def main() -> None:
    if IS_SQLITE:
        sys.exit("GUARDIAN_DATABASE_URL is not set in .env — run scripts/setup_postgres.sh first.")

    print("Creating tables in PostgreSQL ...")
    init_db()
    print("  tables:", ", ".join(sorted(Base.metadata.tables)))

    if not DATABASE_PATH.is_file():
        print(f"No old SQLite file at {DATABASE_PATH} — nothing to copy.")
        return

    old = create_engine(f"sqlite:///{DATABASE_PATH}")
    old_tables = set(inspect(old).get_table_names())
    for model in (User, PendingRegistration):
        table = model.__table__
        if table.name not in old_tables:
            continue
        old_cols = {c["name"] for c in inspect(old).get_columns(table.name)}
        with old.connect() as src:
            rows = [dict(r._mapping) for r in src.execute(select(table))]
        copied = skipped = 0
        with SessionLocal() as db:
            for row in rows:
                if db.get(model, row["id"]) is not None:
                    skipped += 1
                    continue
                # Same email already present (e.g. the test account auto-created by init_db):
                # the original SQLite account wins, so its password/history are kept.
                dup = db.execute(select(model).where(model.email == row["email"])).scalar_one_or_none()
                if dup is not None:
                    db.delete(dup)
                    db.flush()
                data = {k: v for k, v in row.items() if k in old_cols}
                for k, v in data.items():  # SQLite stored UTC without tz info
                    if hasattr(v, "tzinfo") and v.tzinfo is None and hasattr(v, "hour"):
                        data[k] = v.replace(tzinfo=timezone.utc)
                db.add(model(**data))
                copied += 1
            db.commit()
        print(f"  {table.name}: copied {copied}, already there {skipped}")
    print("Done. The old SQLite file was left untouched as a backup.")


if __name__ == "__main__":
    main()
