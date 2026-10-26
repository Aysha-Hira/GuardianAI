from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from experiments.multicam_service import multicam_service
from experiments.multicam.evaluator import gt_frame_span
from experiments.multicam.preset_loader import activate_preset, get_active_preset
from experiments.multicam.presets import list_presets
from experiments.multicam_storage import save_camera_video

router = APIRouter(prefix="/experiments/multicam", tags=["multicam-reid"])

_STREAM_HEADERS = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
}


class MulticamRunPayload(BaseModel):
    max_frames: int | None = Field(default=None, ge=50, le=50000)
    threshold: float | None = Field(default=0.5, ge=0.2, le=0.95)
    sequential: bool = True
    side_by_side: bool = False
    fast_mode: bool = True


@router.get("/presets")
async def multicam_presets():
    return {"presets": list_presets(), "active": get_active_preset()}


@router.post("/preset/{preset_id}")
async def multicam_activate_preset(preset_id: str):
    if multicam_service.is_running():
        raise HTTPException(status_code=409, detail="Cannot switch preset while experiment is running")
    try:
        info = await asyncio.to_thread(activate_preset, preset_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, **info}


@router.get("/status")
async def multicam_status():
    status = multicam_service.get_status()
    status["presets"] = list_presets()
    active = get_active_preset()
    status["active_preset"] = active
    gt_path = active.get("gt_path")
    if gt_path:
        span = gt_frame_span(gt_path)
        if span:
            active["gt_frame_span"] = span
    return status


@router.post("/upload/{camera_slot}")
async def multicam_upload(camera_slot: int, file: UploadFile = File(...)):
    if camera_slot not in (1, 2):
        raise HTTPException(status_code=400, detail="camera_slot must be 1 or 2")
    if multicam_service.is_running():
        raise HTTPException(status_code=409, detail="Cannot upload while experiment is running")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    try:
        result = await asyncio.to_thread(
            save_camera_video, camera_slot, content, file.filename
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result


def _stream_video(path: Path, request: Request) -> FileResponse:
    stat = os.stat(path)
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
        stat_result=stat,
        headers=_STREAM_HEADERS,
    )


@router.get("/source/{camera_slot}")
async def multicam_source_video(camera_slot: int, request: Request):
    path = multicam_service.source_video_path(camera_slot)
    if path is None:
        raise HTTPException(status_code=404, detail="Source video not found")
    return _stream_video(path, request)


@router.post("/run")
async def multicam_run(payload: MulticamRunPayload):
    try:
        return multicam_service.start(
            max_frames=payload.max_frames,
            threshold=payload.threshold,
            sequential=payload.sequential,
            side_by_side=payload.side_by_side,
            fast_mode=payload.fast_mode,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/video/{filename}")
async def multicam_video(filename: str, request: Request):
    path = multicam_service.video_path(filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return _stream_video(path, request)
