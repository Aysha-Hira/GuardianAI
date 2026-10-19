"""
Self-test for the PostgreSQL storage. Uses throw-away test data and removes it afterwards.

    .venv/bin/python scripts/test_postgres_storage.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import delete, text  # noqa: E402

from auth.config import IS_SQLITE  # noqa: E402
from auth.database import SessionLocal, engine, init_db  # noqa: E402

ok = True


def check(label: str, cond: bool, extra: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}{(' — ' + extra) if extra else ''}")


print(f"Database: {'SQLite (fallback!)' if IS_SQLITE else 'PostgreSQL'}")
check("using PostgreSQL", not IS_SQLITE, "set GUARDIAN_DATABASE_URL in .env")
init_db()
with engine.connect() as c:
    tables = set(c.execute(text(
        "select table_name from information_schema.tables where table_schema='public'"
    )).scalars()) if not IS_SQLITE else set()
for t in ("users", "pending_registrations", "alerts", "watchlist_entries"):
    check(f"table {t} exists", IS_SQLITE or t in tables)

# ---------------------------------------------------------------- alerts
print("Alerts:")
from alerts import db as alerts_db  # noqa: E402
from alerts.store import AlertStore  # noqa: E402
from zones.restricted_zone import SecurityEvent  # noqa: E402
import inspect as _inspect  # noqa: E402

store = AlertStore()
before = len(store.list_alerts())
alert = store.create_from_behavior_anomaly(
    camera="CCTV 99 — selftest", source_type="video", camera_id=99,
    anomaly_score=0.5, anomaly_threshold=0.1, wall_now=1_000_000_000.0,
)
check("alert created", alert is not None)
aid = alert.id if alert else None
if aid:
    store.update_status(aid, "acknowledged")
    reloaded = AlertStore()  # simulates a server restart
    got = reloaded.get_alert(aid)
    check("alert survives restart", got is not None)
    check("status change saved", bool(got) and got["status"] == "acknowledged")
    check("all fields restored", bool(got) and got["camera"] == "CCTV 99 — selftest"
          and abs(got["anomaly_score"] - 0.5) < 1e-9)
    nxt = reloaded.create_from_behavior_anomaly(
        camera="CCTV 99 — selftest", source_type="video", camera_id=98,
        anomaly_score=0.5, anomaly_threshold=0.1, wall_now=1_000_000_100.0,
    )
    check("alert ids keep counting after restart", nxt is not None and nxt.id > aid,
          f"{aid} -> {nxt.id if nxt else None}")
    with SessionLocal() as db:
        db.execute(delete(alerts_db.AlertRecord).where(alerts_db.AlertRecord.camera_id.in_([98, 99])))
        db.commit()

# ---------------------------------------------------------------- watchlist
print("Watchlist (encrypted):")
from watchlist import db as wl_db  # noqa: E402
from watchlist.store import WatchlistStore  # noqa: E402

try:
    wl_db.fernet()
    has_key = True
except RuntimeError as exc:
    has_key = False
    check("GUARDIAN_DATA_KEY set", False, str(exc))

if has_key:
    wl = WatchlistStore()
    emb = np.random.default_rng(0).normal(size=512).astype(np.float32).tolist()
    img = b"\xff\xd8\xff\xe0selftest-jpeg-bytes"
    entry = wl.add_entry(name="SELFTEST", category="test", risk_level="low", notes="",
                         image_bytes=img, embedding=emb, model="ArcFace", match_threshold=0.68)
    eid = entry["id"]
    with SessionLocal() as db:
        rec = db.get(wl_db.WatchlistRecord, eid)
        check("photo stored encrypted", rec is not None and img not in bytes(rec.image_enc))
        check("embedding stored encrypted",
              rec is not None and np.asarray(emb, np.float32).tobytes() not in bytes(rec.embedding_enc))
    fresh = WatchlistStore()  # restart
    check("photo decrypts correctly", fresh.image_bytes(eid) == img)
    m = fresh.match_embedding(emb)
    check("face match works after restart", m.get("matched") and m.get("watchlist_id") == eid,
          f"distance {m.get('distance')}")
    check("entry removed", fresh.remove_entry(eid))

print("\nALL TESTS PASSED" if ok else "\nSOME TESTS FAILED — paste this output to Claude")
sys.exit(0 if ok else 1)
