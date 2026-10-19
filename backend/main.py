from contextlib import asynccontextmanager
from pathlib import Path

from datetime import datetime

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from camera_service import (
    INCIDENTS_DIR,
    PLAYBACK_COMPLETE,
    RECORDINGS_DIR,
    SNAPSHOTS_DIR,
    UPLOADS_DIR,
    camera_service,
)
from auth import init_db
from auth.config import IS_PRODUCTION, validate_security_config
from auth.middleware import AuthMiddleware
from auth.routes import router as auth_router

validate_security_config()
from watchlist.routes import router as watchlist_router
from subscriptions.routes import router as subscription_router, user_plan
from auth.database import db_session
from auth.dependencies import get_current_user
from auth.models import User
from sqlalchemy.orm import Session
from experiments.routes import router as multicam_router

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))

_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import logging
    import os

    if os.getenv("GUARDIAN_DEBUG_TRACKING", "0") == "1":
        logging.basicConfig(level=logging.INFO)
        logging.getLogger("guardian.tracking").setLevel(logging.INFO)

    from recognition.deepface_client import deepface_client
    from watchlist.store import watchlist_store
    from alerts.severity_service import severity_scorer

    init_db()
    from auth.config import SMTP_ENABLED, SMTP_USER

    if SMTP_ENABLED:
        print(f"[Guardian Auth] Email enabled — sending as {SMTP_USER}")
    watchlist_store.list_entries()
    deepface_client.probe()
    severity_scorer.load()

    camera_service.start()
    try:
        yield
    finally:
        camera_service.stop()


class TrailsSetting(BaseModel):
    enabled: bool


class ZoneRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class ZonesPayload(BaseModel):
    zones: list[ZoneRect]
    reset_states: bool = True


class ZoneEditingPayload(BaseModel):
    active: bool


class LoiteringThresholdPayload(BaseModel):
    loitering_threshold_seconds: float


class FollowTrackPayload(BaseModel):
    track_id: int


class AutoFocusPayload(BaseModel):
    track_id: int
    event_type: str
    zone_index: int = 0
    camera_id: int | None = None


class FocusFromAlertPayload(BaseModel):
    alert_id: str


class AlertStatusPayload(BaseModel):
    status: str


app = FastAPI(
    title="Guardian AI",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:4200",
        "http://localhost:4200",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(watchlist_router)
app.include_router(subscription_router)
app.include_router(multicam_router)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return TEMPLATES.TemplateResponse(request, "index.html")


@app.get("/legacy/monitor", response_class=HTMLResponse)
async def legacy_monitor(request: Request):
    return TEMPLATES.TemplateResponse(request, "monitor_embed.html")


@app.get("/status")
async def status():
    return JSONResponse(camera_service.get_status())


@app.get("/tracks")
async def tracks():
    return JSONResponse(camera_service.get_tracks())


@app.post("/settings/trails")
async def set_trails(setting: TrailsSetting):
    camera_service.set_show_trails(setting.enabled)
    return JSONResponse({"ok": True, "show_trails": setting.enabled})


@app.get("/settings")
async def get_settings():
    return JSONResponse(camera_service.get_settings())


@app.post("/settings/loitering")
async def set_loitering_threshold(payload: LoiteringThresholdPayload):
    try:
        return JSONResponse(
            camera_service.set_loitering_threshold(payload.loitering_threshold_seconds)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/zone")
async def get_zone():
    zones = camera_service.get_zones()
    return JSONResponse(
        {
            "restricted_zones": zones,
            "restricted_zone": zones[0] if zones else None,
            "restricted_zone_active": len(zones) > 0,
            "restricted_zone_label": f"Active ({len(zones)})" if zones else "Not Set",
            "zone_source": camera_service.get_status().get("zone_source"),
        }
    )


@app.post("/zone")
async def set_zone(payload: ZonesPayload):
    try:
        zone_dicts = [z.model_dump() for z in payload.zones]
        return JSONResponse(
            camera_service.set_zones(zone_dicts, reset_states=payload.reset_states)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/zone/editing")
async def set_zone_editing(payload: ZoneEditingPayload):
    return JSONResponse(camera_service.set_zones_editing(payload.active))


@app.delete("/zone")
async def clear_zone():
    return JSONResponse(camera_service.clear_zones())


@app.get("/zone/events")
async def zone_events():
    return JSONResponse(camera_service.get_zone_events())


@app.get("/focus/status")
async def focus_status():
    return JSONResponse(camera_service.get_focus_status())


@app.get("/focus/frame")
async def focus_frame(slot: str | None = None):
    jpeg = camera_service.get_focus_jpeg(slot)
    if jpeg is None:
        return Response(status_code=204)
    return Response(content=jpeg, media_type="image/jpeg", headers=_NO_CACHE_HEADERS)


@app.post("/focus/follow")
async def focus_follow(payload: FollowTrackPayload):
    return JSONResponse(camera_service.follow_track(payload.track_id))


@app.post("/focus/auto-lock")
async def focus_auto_lock(payload: AutoFocusPayload):
    return JSONResponse(
        camera_service.lock_focus_auto(
            payload.track_id, payload.event_type, payload.zone_index, payload.camera_id
        )
    )


@app.post("/focus/release")
async def focus_release(slot: str | None = None):
    return JSONResponse(camera_service.release_focus(slot))


@app.post("/focus/from-alert")
async def focus_from_alert(payload: FocusFromAlertPayload):
    try:
        return JSONResponse(camera_service.focus_from_alert(payload.alert_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/behavior/status")
async def behavior_status():
    from behavior.anomaly_engine import get_behavior_engine

    return JSONResponse(get_behavior_engine().status())


@app.get("/severity/status")
async def severity_status():
    from alerts.severity_service import severity_scorer

    return JSONResponse(severity_scorer.status())


@app.get("/alerts")
async def list_alerts(
    filter: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    event_type: str | None = None,
):
    return JSONResponse(
        camera_service.get_alerts(
            filter_preset=filter,
            status=status,
            severity=severity,
            event_type=event_type,
        )
    )


@app.delete("/alerts")
async def delete_all_alerts():
    return JSONResponse(camera_service.clear_alerts())


@app.get("/alerts/evidence/{filename}")
async def alert_evidence(filename: str):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = INCIDENTS_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Evidence not found")
    data = path.read_bytes()
    return Response(content=data, media_type="image/jpeg", headers=_NO_CACHE_HEADERS)


@app.get("/recordings/{filename}")
async def get_recording(filename: str):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = RECORDINGS_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    data = path.read_bytes()
    return Response(content=data, media_type="video/mp4", headers=_NO_CACHE_HEADERS)


@app.post("/record/start")
async def record_start(user: User = Depends(get_current_user), db: Session = Depends(db_session)):
    if not user_plan(db, user.id)["recording"]:
        raise HTTPException(
            status_code=402,
            detail="Recording is available on the Professional and Enterprise plans. Upgrade to start recording.",
        )
    return JSONResponse(camera_service.start_recording())


@app.post("/record/stop")
async def record_stop():
    result = camera_service.stop_recording()
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Not recording"))
    return JSONResponse(result)


@app.get("/alerts/{alert_id}")
async def get_alert(alert_id: str):
    alert = camera_service.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return JSONResponse(alert)


@app.patch("/alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, payload: AlertStatusPayload):
    try:
        return JSONResponse(camera_service.update_alert_status(alert_id, payload.status))
    except KeyError:
        raise HTTPException(status_code=404, detail="Alert not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/upload/video")
async def upload_video(
    file: UploadFile = File(...),
    camera_id: int = 2,
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    try:
        import asyncio

        result = await asyncio.to_thread(
            camera_service.save_upload, content, file.filename, camera_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse(result)


@app.post("/source/camera/{camera_id}")
async def source_camera(camera_id: int):
    try:
        return JSONResponse(camera_service.switch_to_camera(camera_id))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/cameras")
async def cameras():
    return JSONResponse({"cameras": camera_service.get_cameras()})


@app.get("/cameras/{camera_id}/frame")
async def camera_frame(camera_id: int, raw: bool = False):
    if raw:
        jpeg = camera_service.get_camera_raw_jpeg(camera_id)
    else:
        jpeg = camera_service.get_camera_jpeg(camera_id)
    if jpeg is None:
        return Response(status_code=204)
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers=_NO_CACHE_HEADERS,
    )


@app.delete("/cameras/{camera_id}")
async def delete_camera(camera_id: int):
    try:
        return JSONResponse(camera_service.delete_camera_slot(camera_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class CameraSettingsPayload(BaseModel):
    ai_enabled: bool | None = None
    show_boxes: bool | None = None


@app.post("/cameras/{camera_id}/settings")
async def camera_settings(camera_id: int, payload: CameraSettingsPayload):
    try:
        result: dict = {"ok": True, "camera_id": camera_id}
        if payload.ai_enabled is not None:
            result.update(camera_service.set_camera_ai(camera_id, payload.ai_enabled))
        if payload.show_boxes is not None:
            result.update(camera_service.set_camera_boxes(camera_id, payload.show_boxes))
        return JSONResponse(result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/source/webcam")
async def source_webcam():
    try:
        return JSONResponse(camera_service.switch_to_webcam())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/source/camera2")
async def source_camera2():
    try:
        return JSONResponse(camera_service.switch_to_camera2())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/source/video/start")
async def source_video_start():
    try:
        return JSONResponse(camera_service.switch_to_camera2())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/source/camera2")
async def delete_camera2():
    try:
        return JSONResponse(camera_service.delete_camera2())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/source/video/pause")
async def source_video_pause():
    try:
        return JSONResponse(camera_service.pause_video())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/source/video/resume")
async def source_video_resume():
    try:
        return JSONResponse(camera_service.resume_video())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/source/video/restart")
async def source_video_restart():
    try:
        return JSONResponse(camera_service.restart_video())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/source/video/stop")
async def source_video_stop():
    try:
        return JSONResponse(camera_service.stop_video())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/frame")
async def latest_frame():
    jpeg = camera_service.get_jpeg()
    if jpeg is None:
        jpeg = _offline_jpeg()
    if jpeg is None:
        raise HTTPException(status_code=503, detail="No frame available")
    return Response(content=jpeg, media_type="image/jpeg", headers=_NO_CACHE_HEADERS)


@app.get("/video-feed")
async def video_feed():
    def generate():
        import time

        while not camera_service.is_stopped():
            jpeg = camera_service.get_jpeg()
            payload = jpeg if jpeg is not None else _offline_jpeg()
            if not payload:
                time.sleep(0.05)
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n"
                + payload
                + b"\r\n"
            )
            time.sleep(0.05)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_NO_CACHE_HEADERS,
    )


@app.post("/snapshot")
async def snapshot(viewport: UploadFile | None = File(None)):
    status_data = camera_service.get_status()
    active = status_data.get("camera_active")
    playback = status_data.get("playback_state")
    if not active and playback != PLAYBACK_COMPLETE:
        raise HTTPException(status_code=503, detail="No video source active")

    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"snapshot_{stamp}.jpg"
    path = SNAPSHOTS_DIR / filename

    if viewport is not None:
        content = await viewport.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty snapshot data")
        path.write_bytes(content)
        return JSONResponse({"ok": True, "filename": filename, "path": str(path), "source": "viewport"})

    try:
        result = camera_service.save_snapshot()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return JSONResponse({"ok": True, **result, "source": "full"})


def _offline_jpeg() -> bytes | None:
    import cv2
    import numpy as np

    canvas = np.zeros((480, 854, 3), dtype=np.uint8)
    canvas[:] = (24, 24, 28)
    text = "CAMERA OFFLINE"
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale, thickness = 1.2, 2
    (tw, th), _ = cv2.getTextSize(text, font, scale, thickness)
    x = (canvas.shape[1] - tw) // 2
    y = (canvas.shape[0] + th) // 2
    cv2.putText(canvas, text, (x, y), font, scale, (80, 80, 220), thickness)
    ok, encoded = cv2.imencode(".jpg", canvas)
    return encoded.tobytes() if ok else None


if __name__ == "__main__":
    import logging

    import uvicorn

    class _QuietPollingFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            return "/frame" not in msg and "GET /status" not in msg

    logging.getLogger("uvicorn.access").addFilter(_QuietPollingFilter())

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    config = uvicorn.Config(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        loop="asyncio",
        timeout_graceful_shutdown=1,
    )
    server = uvicorn.Server(config)

    _uvicorn_handle_exit = server.handle_exit

    def handle_exit(sig, frame):
        camera_service.request_stop()
        _uvicorn_handle_exit(sig, frame)

    server.handle_exit = handle_exit

    try:
        server.run()
    except KeyboardInterrupt:
        pass
