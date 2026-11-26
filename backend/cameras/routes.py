from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from auth.dependencies import get_current_user
from auth.models import User
from cameras import camera_service
from cameras.schemas import CameraCreate, CameraResponse, CameraUpdate
from media_service import media_service

logger = logging.getLogger("guardian.cameras")

router = APIRouter(prefix="/camera", tags=["camera"])


def _sync_stream(camera_id: int, is_active: bool) -> None:
    try:
        if is_active:
            media_service.restart_camera(camera_id)
        else:
            media_service.stop_camera(camera_id)
    except Exception:
        logger.exception("Could not sync stream for camera %s", camera_id)


@router.get("", response_model=list[CameraResponse])
def list_cameras(user: User = Depends(get_current_user)):
    return camera_service.list_cameras()


@router.get("/status/{camera_id}")
def camera_status(camera_id: int, user: User = Depends(get_current_user)):
    camera = camera_service.get_camera(camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    return {"id": camera.id, "is_active": camera.is_active}


@router.get("/{camera_id}", response_model=CameraResponse)
def get_camera(camera_id: int, user: User = Depends(get_current_user)):
    camera = camera_service.get_camera(camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
def add_camera(payload: CameraCreate, user: User = Depends(get_current_user)):
    try:
        camera = camera_service.add_camera(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    _sync_stream(camera.id, camera.is_active)
    return camera


@router.patch("/{camera_id}", response_model=CameraResponse)
def update_camera(camera_id: int, payload: CameraUpdate, user: User = Depends(get_current_user)):
    try:
        camera = camera_service.update_camera(camera_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    _sync_stream(camera.id, camera.is_active)
    return camera


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(camera_id: int, user: User = Depends(get_current_user)):
    if not camera_service.delete_camera(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")
    media_service.stop_camera(camera_id)
