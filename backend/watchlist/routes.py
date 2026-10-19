from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from recognition.deepface_client import deepface_client
from watchlist.config import IMAGES_DIR, WATCHLIST_DIR
from watchlist.weights import weights_status
from watchlist.store import watchlist_store

logger = logging.getLogger("guardian.watchlist.api")

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

MAX_ENROLL_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_SUFFIX = {".jpg", ".jpeg", ".png", ".webp"}


@router.get("/status")
async def watchlist_status():
    probe = deepface_client.probe(force=True)
    entries = watchlist_store.list_entries()
    wstatus = weights_status()
    enabled = bool(wstatus.get("ready")) and bool(probe.get("ok"))
    return JSONResponse(
        {
            "enabled": enabled,
            "engine": probe,
            "weights": wstatus,
            "watchlist_count": len(entries),
            "match_threshold": wstatus.get("threshold"),
        }
    )


@router.get("")
async def list_watchlist():
    return JSONResponse({"entries": watchlist_store.list_entries()})


@router.get("/images/{filename}")
async def watchlist_image(filename: str):
    safe = Path(filename).name
    if safe != filename or ".." in filename or not safe.endswith(".jpg"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    data = watchlist_store.image_bytes(safe[: -len(".jpg")])
    if data is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/{entry_id}")
async def get_watchlist_entry(entry_id: str):
    if entry_id == "status":
        raise HTTPException(status_code=404, detail="Not found")
    entry = watchlist_store.get_entry(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Watchlist entry not found")
    return JSONResponse(entry)


@router.delete("/{entry_id}")
async def delete_watchlist_entry(entry_id: str):
    import asyncio

    removed = await asyncio.to_thread(watchlist_store.remove_entry, entry_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Watchlist entry not found")
    return JSONResponse({"ok": True, "id": entry_id})


@router.post("/enroll")
async def enroll_watchlist(
    image: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form("general"),
    risk_level: str = Form("medium"),
    notes: str = Form(""),
):
    if not deepface_client.is_configured():
        raise HTTPException(
            status_code=503,
            detail="DeepFace engine not configured. Install .venv-deepface and run scripts/deepface_worker.py probe.",
        )

    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(content) > MAX_ENROLL_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 5 MB limit")

    suffix = Path(image.filename or "face.jpg").suffix.lower() or ".jpg"
    if suffix not in ALLOWED_IMAGE_SUFFIX:
        raise HTTPException(status_code=400, detail="Use JPG, PNG, or WebP images")

    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)

        resp = deepface_client.represent(tmp_path)
        if not resp.get("ok"):
            code = resp.get("code", "processing_error")
            detail = resp.get("error", "Face processing failed")
            if code == "weights_missing":
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "DeepFace model weights are not installed. "
                        "Run: python scripts/setup_deepface_weights.py "
                        "(use Facenet512 mirror when GitHub is blocked)."
                    ),
                )
            if code == "no_face" or "Face could not be detected" in detail:
                raise HTTPException(status_code=400, detail="No usable face detected in image")
            raise HTTPException(status_code=503, detail=detail)

        entry = watchlist_store.add_entry(
            name=name,
            category=category.strip() or "general",
            risk_level=risk_level.strip() or "medium",
            notes=notes.strip(),
            image_bytes=content,
            embedding=resp["embedding"],
            model=str(resp.get("model", "ArcFace")),
            match_threshold=float(resp["threshold"]) if resp.get("threshold") is not None else None,
        )
        return JSONResponse(
            {
                "ok": True,
                "entry": entry,
                "processing": {
                    "face_detected": True,
                    "embedding_created": True,
                    "model": resp.get("model"),
                    "distance_metric": resp.get("distance_metric"),
                    "threshold": resp.get("threshold"),
                },
            }
        )
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


@router.put("/{entry_id}/image")
async def replace_watchlist_image(entry_id: str, image: UploadFile = File(...)):
    existing = watchlist_store.get_entry(entry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Watchlist entry not found")

    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(content) > MAX_ENROLL_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 5 MB limit")

    suffix = Path(image.filename or "face.jpg").suffix.lower() or ".jpg"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)

        resp = deepface_client.represent(tmp_path)
        if not resp.get("ok"):
            detail = resp.get("error", "Face processing failed")
            raise HTTPException(status_code=400, detail=detail)

        updated = watchlist_store.replace_image(
            entry_id,
            image_bytes=content,
            embedding=resp["embedding"],
        )
        return JSONResponse({"ok": True, "entry": updated})
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
