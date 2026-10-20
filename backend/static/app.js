const ZOOM_LEVELS = [1.0, 1.25, 1.5, 2.0];
const PAN_STEP = 36;
const LOITERING_MIN = 5;
const LOITERING_MAX = 300;

const SOURCE_WEBCAM = "webcam";
const SOURCE_VIDEO = "video";

const els = {
  liveDot: document.getElementById("live-dot"),
  liveText: document.getElementById("live-text"),
  liveBadge: document.getElementById("live-badge"),
  camClock: document.getElementById("cam-clock"),
  camName: document.getElementById("cam-name"),
  camPrev: document.getElementById("btn-cam-prev"),
  camNext: document.getElementById("btn-cam-next"),
  infoPanelTitle: document.getElementById("info-panel-title"),
  overlayDot: document.getElementById("overlay-dot"),
  overlayOnline: document.getElementById("overlay-online"),
  overlayResolution: document.getElementById("overlay-resolution"),
  overlayFps: document.getElementById("overlay-fps"),
  fpsLabel: document.getElementById("fps-label"),
  overlayPeople: document.getElementById("overlay-people"),
  overlayTracks: document.getElementById("overlay-tracks"),
  overlaySync: document.getElementById("overlay-sync"),
  trackingActiveCount: document.getElementById("tracking-active-count"),
  trackingList: document.getElementById("tracking-list"),
  toggleTrails: document.getElementById("toggle-trails"),
  loopBtn: document.getElementById("btn-loop"),
  snapshotBtn: document.getElementById("btn-snapshot"),
  fullscreenBtn: document.getElementById("btn-fullscreen"),
  resetViewBtn: document.getElementById("btn-reset-view"),
  snapshotMsg: document.getElementById("snapshot-msg"),
  cameraFrame: document.getElementById("camera-frame"),
  videoStage: document.getElementById("video-stage"),
  videoViewport: document.getElementById("video-viewport"),
  videoStream: document.getElementById("video-stream"),
  zoomInBtn: document.getElementById("btn-zoom-in"),
  zoomOutBtn: document.getElementById("btn-zoom-out"),
  zoomLabel: document.getElementById("zoom-label"),
  panUp: document.getElementById("btn-pan-up"),
  panDown: document.getElementById("btn-pan-down"),
  panLeft: document.getElementById("btn-pan-left"),
  panRight: document.getElementById("btn-pan-right"),
  cam2Setup: document.getElementById("cam2-setup"),
  closeCam2SetupBtn: document.getElementById("btn-close-cam2-setup"),
  cam2Admin: document.getElementById("cam2-admin"),
  cam2AdminLabel: document.getElementById("cam2-admin-label"),
  videoFile: document.getElementById("video-file"),
  uploadName: document.getElementById("upload-name"),
  deleteCamera2Btn: document.getElementById("btn-delete-camera2"),
  editZoneBtn: document.getElementById("btn-edit-zone"),
  zoneEditCanvas: document.getElementById("zone-edit-canvas"),
  zoneEditBar: document.getElementById("zone-edit-bar"),
  zoneSaveBtn: document.getElementById("btn-zone-save"),
  zoneCancelBtn: document.getElementById("btn-zone-cancel"),
  clearZoneBtn: document.getElementById("btn-clear-zone"),
  zoneStatusLabel: document.getElementById("zone-status-label"),
  zoneEventBanner: document.getElementById("zone-event-banner"),
  zoneEventTitle: document.getElementById("zone-event-title"),
  zoneEventTrack: document.getElementById("zone-event-track"),
  zoneEventDetail: document.getElementById("zone-event-detail"),
  zoneEventTime: document.getElementById("zone-event-time"),
  loiteringInput: document.getElementById("loitering-threshold-input"),
  loiteringApplyBtn: document.getElementById("btn-loitering-apply"),
  loiteringThresholdMsg: document.getElementById("loitering-threshold-msg"),
  eventFeed: document.getElementById("event-feed"),
  monitorLayout: document.getElementById("monitor-layout"),
  incidentFocusShell: document.getElementById("incident-focus-shell"),
  incidentFocusGrid: document.getElementById("incident-focus-grid"),
  focusIdleGlobal: document.getElementById("focus-idle-global"),
  zoneSourceNote: document.getElementById("zone-source-note"),
  alertsList: document.getElementById("alerts-list"),
  alertsEmpty: document.getElementById("alerts-empty"),
  alertsNewCount: document.getElementById("alerts-new-count"),
  alertsPanel: document.getElementById("alerts-panel"),
  alertModal: document.getElementById("alert-modal"),
  alertModalBackdrop: document.getElementById("alert-modal-backdrop"),
  alertModalClose: document.getElementById("alert-modal-close"),
  alertModalBody: document.getElementById("alert-modal-body"),
  alertModalActions: document.getElementById("alert-modal-actions"),
  evidenceLightbox: document.getElementById("evidence-lightbox"),
  evidenceLightboxImg: document.getElementById("evidence-lightbox-img"),
  evidenceLightboxClose: document.getElementById("evidence-lightbox-close"),
};

let previousObjectUrl = null;
let frameInFlight = false;
let wasOnline = false;
let currentSource = SOURCE_WEBCAM;
let activeCameraId = 1;
let viewCameraId = 1;
let camera2Ready = false;
let switchingSource = false;
let playbackPaused = false;

let zoomIndex = 0;
let panX = 0;
let panY = 0;
let panDragActive = false;
let panDragPointerId = null;
let panDragStartX = 0;
let panDragStartY = 0;
let panDragOriginX = 0;
let panDragOriginY = 0;

const MAX_ZONES = 5;
const ZONE_HANDLE = 10;

let zoneEditMode = false;
let editZones = [];
let zoneDragMode = null;
let zoneDragIndex = -1;
let zoneDragStartNorm = null;
let zoneDragOrigin = null;
let zoneDraftRect = null;
let editZonesSnapshot = null;
let zoneSyncTimer = null;
let lastShownEventId = 0;
let zoneBannerTimer = null;
let loiteringThresholdSeconds = 15;
let focusActive = false;
const focusFrameInflight = new Set();
const focusObjectUrls = new Map();

let alertsFilter = "all";
let alertsCache = [];
let alertsNewCount = 0;
let knownAlertIds = new Set();
let selectedAlertId = null;
let activeTrackIds = new Set();

const ALERT_ACTIONS = {
  new: [
    { status: "acknowledged", label: "Acknowledge", primary: true },
    { status: "under_review", label: "Under Review" },
    { status: "false_alarm", label: "False Alarm" },
    { status: "resolved", label: "Resolve" },
  ],
  acknowledged: [
    { status: "under_review", label: "Under Review", primary: true },
    { status: "escalated", label: "Escalate" },
    { status: "false_alarm", label: "False Alarm" },
    { status: "resolved", label: "Resolve" },
  ],
  under_review: [
    { status: "escalated", label: "Escalate", primary: true },
    { status: "false_alarm", label: "False Alarm" },
    { status: "resolved", label: "Resolve" },
  ],
  escalated: [
    { status: "resolved", label: "Resolve", primary: true },
    { status: "false_alarm", label: "False Alarm" },
    { status: "under_review", label: "Under Review" },
  ],
  false_alarm: [],
  resolved: [],
};

function currentZoom() {
  return ZOOM_LEVELS[zoomIndex];
}

function cameraLabel(id, cameras, fallbackName) {
  const cam = cameras?.find((c) => c.id === id);
  if (cam?.label) return cam.label;
  if (id === 2) return fallbackName ? `CCTV 02 — ${fallbackName}` : "CCTV 02 — No Recording";
  return "CCTV 01 — Laptop Camera";
}

function isCam2SetupView() {
  return viewCameraId === 2 && !camera2Ready;
}

function closeCam2Setup() {
  viewCameraId = 1;
  applyViewCameraUi(null);
}

function applyViewCameraUi(data) {
  const isVideo = activeCameraId === 2 && currentSource === SOURCE_VIDEO;
  const showCam2Setup = isCam2SetupView();

  const label = showCam2Setup
    ? cameraLabel(2, data?.cameras, null)
    : (data?.camera_label || cameraLabel(viewCameraId, data?.cameras, data?.video_filename));
  if (els.camName) els.camName.textContent = label;

  els.cam2Setup?.classList.toggle("hidden", !showCam2Setup);

  if (els.loopBtn) {
    els.loopBtn.classList.toggle("hidden", !isVideo || showCam2Setup);
    els.loopBtn.classList.toggle("active", isVideo && !playbackPaused);
    els.loopBtn.title = playbackPaused ? "Resume loop" : "Pause loop";
    els.loopBtn.setAttribute("aria-label", playbackPaused ? "Resume loop playback" : "Pause loop playback");
  }

  const showCam2Admin = camera2Ready && viewCameraId === 2 && !showCam2Setup;
  if (els.cam2Admin) {
    els.cam2Admin.classList.toggle("hidden", !showCam2Admin);
  }
  if (els.cam2AdminLabel && showCam2Admin) {
    const fname = data?.video_filename || data?.cameras?.find((c) => c.id === 2)?.filename;
    els.cam2AdminLabel.textContent = fname ? `CCTV 02 — ${fname}` : "CCTV 02 — Recording loaded";
  }

  if (els.infoPanelTitle) {
    const infoCam2 = isVideo || showCam2Setup;
    els.infoPanelTitle.textContent = infoCam2 ? "Camera 2 Info" : "Live Camera Info";
  }
}

function updateCameraChrome(data) {
  const isVideo = data.source_type === SOURCE_VIDEO;
  currentSource = data.source_type || SOURCE_WEBCAM;
  activeCameraId = data.camera_id ?? (isVideo ? 2 : 1);
  camera2Ready = Boolean(data.camera2_available);

  if (!isCam2SetupView()) {
    viewCameraId = activeCameraId;
  }

  applyViewCameraUi(data);
}

function setLiveBadge(active, isCamera2 = false) {
  const cls = active ? "online" : "offline";
  const anti = active ? "offline" : "online";

  els.liveDot.classList.add(cls);
  els.liveDot.classList.remove(anti);
  els.overlayDot.classList.add(cls);
  els.overlayDot.classList.remove(anti);
  const statusWrap = els.overlayDot.closest(".info-icon-wrap");
  if (statusWrap) {
    statusWrap.classList.add(cls);
    statusWrap.classList.remove(anti);
  }
  els.liveBadge.classList.add(cls);
  els.liveBadge.classList.remove(anti);

  els.liveText.textContent = active ? "LIVE" : "OFFLINE";
  els.overlayOnline.textContent = active ? "Online" : "Offline";
  els.overlayOnline.classList.toggle("offline-text", !active);
  if (els.overlaySync) {
    els.overlaySync.textContent = active
      ? (isCamera2 ? "Loop feed" : "Live feed")
      : "No signal";
  }
}

function updateClockFromStatus(data) {
  if (data.source_type === SOURCE_VIDEO) {
    const pos = data.playback_time || "00:00";
    const total = data.total_time || "00:00";
    els.camClock.textContent = `${pos} / ${total}`;
    els.camClock.removeAttribute("datetime");
    return;
  }

  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  els.camClock.textContent = `${h}:${m}:${s}`;
  els.camClock.dateTime = now.toISOString();
}

function clampPan() {
  const zoom = currentZoom();
  if (zoom <= 1) {
    panX = 0;
    panY = 0;
    return;
  }
  const vp = els.videoViewport.getBoundingClientRect();
  const maxX = (vp.width * (zoom - 1)) / 2;
  const maxY = (vp.height * (zoom - 1)) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function applyViewTransform() {
  clampPan();
  const zoom = currentZoom();
  els.videoStage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  els.zoomLabel.textContent = `${zoom.toFixed(zoom % 1 === 0 ? 1 : 2)}×`;
  const panEnabled = zoom > 1;
  els.panUp.disabled = !panEnabled;
  els.panDown.disabled = !panEnabled;
  els.panLeft.disabled = !panEnabled;
  els.panRight.disabled = !panEnabled;
  els.zoomOutBtn.disabled = zoomIndex === 0;
  els.zoomInBtn.disabled = zoomIndex === ZOOM_LEVELS.length - 1;
  els.videoViewport?.classList.toggle("pan-enabled", panEnabled && !zoneEditMode);
  els.videoViewport?.classList.toggle("pan-dragging", panDragActive);
  if (zoneEditMode) drawZoneEditCanvas();
}

function canDragPan() {
  return currentZoom() > 1 && !zoneEditMode;
}

function endViewPanDrag(event) {
  if (!panDragActive) return;
  if (event && event.pointerId !== panDragPointerId) return;
  panDragActive = false;
  if (event && els.videoViewport?.hasPointerCapture(event.pointerId)) {
    els.videoViewport.releasePointerCapture(event.pointerId);
  }
  panDragPointerId = null;
  applyViewTransform();
}

function onViewPanPointerDown(event) {
  if (!canDragPan()) return;
  if (event.button !== undefined && event.button !== 0) return;
  panDragActive = true;
  panDragPointerId = event.pointerId;
  panDragStartX = event.clientX;
  panDragStartY = event.clientY;
  panDragOriginX = panX;
  panDragOriginY = panY;
  els.videoViewport?.classList.add("pan-dragging");
  els.videoViewport?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onViewPanPointerMove(event) {
  if (!panDragActive || event.pointerId !== panDragPointerId) return;
  panX = panDragOriginX + (event.clientX - panDragStartX);
  panY = panDragOriginY + (event.clientY - panDragStartY);
  applyViewTransform();
  event.preventDefault();
}

function resetView() {
  zoomIndex = 0;
  panX = 0;
  panY = 0;
  applyViewTransform();
}

function zoomIn() {
  if (zoomIndex < ZOOM_LEVELS.length - 1) {
    zoomIndex += 1;
    applyViewTransform();
  }
}

function zoomOut() {
  if (zoomIndex > 0) {
    zoomIndex -= 1;
    if (zoomIndex === 0) {
      panX = 0;
      panY = 0;
    }
    applyViewTransform();
  }
}

function pan(dx, dy) {
  if (currentZoom() <= 1) return;
  panX += dx;
  panY += dy;
  applyViewTransform();
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatMmSs(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function renderProgressBar(current, threshold, loitering) {
  const pct = threshold > 0 ? Math.min(100, (current / threshold) * 100) : 0;
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const label = loitering
    ? `${bar} ${Math.round(current)} / ${Math.round(threshold)} sec — LOITERING`
    : `${bar} ${Math.round(current)} / ${Math.round(threshold)} sec`;
  return `<div class="track-progress">${label}</div>
    <div class="track-progress-bar"><div class="track-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

function renderTrackingPanel(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  const count = list.length;
  activeTrackIds = new Set(list.map((t) => Number(t.track_id)).filter((id) => id > 0));
  if (els.trackingActiveCount) els.trackingActiveCount.textContent = String(count);
  if (els.overlayTracks) els.overlayTracks.textContent = String(count);
  if (!els.trackingList) return;
  if (count === 0) {
    els.trackingList.innerHTML = '<li class="tracking-empty">No active tracks</li>';
    return;
  }
  els.trackingList.innerHTML = list
    .map((t) => {
      const inZone = Boolean(t.in_zone);
      const loitering = Boolean(t.loitering_detected);
      const threshold = Number(t.loitering_threshold_seconds) || loiteringThresholdSeconds;
      const inside = Number(t.inside_zone_duration) || 0;
      let rowCls = "tracking-row";
      if (loitering) rowCls += " loitering";
      else if (inZone) rowCls += " in-zone";

      let status;
      if (loitering) {
        status = `Loitering (${formatDuration(inside)})`;
      } else if (inZone) {
        status = `Inside ${formatMmSs(inside)} / ${formatMmSs(threshold)}`;
      } else {
        status = t.status || "Visible";
      }

      const progress = inZone
        ? renderProgressBar(inside, threshold, loitering)
        : "";

      return `<li class="${rowCls}">
          <span class="track-id">#${t.track_id}</span>
          <span class="track-status">${status}</span>
          <span class="track-duration">${formatDuration(t.visible_duration)}</span>
          <button type="button" class="track-follow-btn" data-track-id="${t.track_id}" title="Follow track">Follow</button>
          ${progress}
        </li>`;
    })
    .join("");

  els.trackingList.querySelectorAll(".track-follow-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tid = Number(btn.dataset.trackId);
      if (tid) followTrack(tid);
    });
  });
}

async function refreshTracks() {
  try {
    const res = await fetch("/tracks", { cache: "no-store" });
    if (!res.ok) throw new Error("tracks request failed");
    renderTrackingPanel(await res.json());
  } catch (_err) {
    renderTrackingPanel([]);
  }
}

async function setTrailsEnabled(enabled) {
  try {
    await fetch("/settings/trails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch (_err) {
  }
}

function showLoiteringThresholdMsg(text, ok = false) {
  if (!els.loiteringThresholdMsg) return;
  els.loiteringThresholdMsg.textContent = text;
  els.loiteringThresholdMsg.classList.toggle("hidden", !text);
  els.loiteringThresholdMsg.classList.toggle("ok", ok);
}

function validateLoiteringInput(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: `Threshold must be between ${LOITERING_MIN} and ${LOITERING_MAX} seconds.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: `Threshold must be between ${LOITERING_MIN} and ${LOITERING_MAX} seconds.` };
  }
  if (value < LOITERING_MIN || value > LOITERING_MAX) {
    return { ok: false, message: `Threshold must be between ${LOITERING_MIN} and ${LOITERING_MAX} seconds.` };
  }
  return { ok: true, value };
}

async function loadSettings() {
  try {
    const res = await fetch("/settings", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.loitering_threshold_seconds != null) {
      loiteringThresholdSeconds = Number(data.loitering_threshold_seconds);
      if (els.loiteringInput) {
        els.loiteringInput.value = String(Math.round(loiteringThresholdSeconds));
      }
    }
  } catch (_err) {
  }
}

async function applyLoiteringThreshold() {
  const check = validateLoiteringInput(els.loiteringInput?.value);
  if (!check.ok) {
    showLoiteringThresholdMsg(check.message, false);
    return;
  }
  try {
    const res = await fetch("/settings/loitering", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loitering_threshold_seconds: check.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not apply threshold");
    loiteringThresholdSeconds = Number(data.loitering_threshold_seconds) || check.value;
    if (els.loiteringInput) els.loiteringInput.value = String(Math.round(loiteringThresholdSeconds));
    showLoiteringThresholdMsg(`Threshold set to ${Math.round(loiteringThresholdSeconds)} seconds`, true);
    setTimeout(() => showLoiteringThresholdMsg(""), 2500);
    await refreshTracks();
  } catch (err) {
    showLoiteringThresholdMsg(err.message || "Apply failed", false);
  }
}

async function refreshStatus() {
  try {
    const res = await fetch("/status", { cache: "no-store" });
    if (!res.ok) throw new Error("status request failed");
    const data = await res.json();

    const online = Boolean(data.camera_active);
    const isVideo = data.source_type === SOURCE_VIDEO;
    playbackPaused = data.playback_state === "paused";

    if (online && !wasOnline) refreshFrame();
    wasOnline = online;

    updateCameraChrome(data);

    if (isVideo) {
      setLiveBadge(online, true);
      if (els.fpsLabel) {
        const srcFps = data.source_fps ? ` · src ${Number(data.source_fps).toFixed(1)} fps` : "";
        els.fpsLabel.textContent = `proc fps${srcFps}`;
      }
    } else {
      setLiveBadge(online, false);
      if (els.fpsLabel) els.fpsLabel.textContent = "fps";
    }

    updateClockFromStatus(data);

    els.overlayPeople.textContent = String(data.people_count ?? 0);
    if (els.overlayTracks) els.overlayTracks.textContent = String(data.active_tracks ?? 0);
    if (els.trackingActiveCount) els.trackingActiveCount.textContent = String(data.active_tracks ?? 0);
    els.overlayFps.textContent = Number(data.fps ?? 0).toFixed(1);
    els.overlayResolution.textContent = data.resolution || "—";

    if (els.zoneStatusLabel) {
      const zones = data.restricted_zones || (data.restricted_zone ? [data.restricted_zone] : []);
      els.zoneStatusLabel.textContent = data.restricted_zone_label
        || (zones.length ? `Active (${zones.length})` : "Not Set");
      if (els.zoneSourceNote) {
        const src = data.zone_source || data.source_type;
        const label = src === SOURCE_VIDEO ? "CCTV 02 recording" : "CCTV 01 webcam";
        const hasZones = Boolean(data.restricted_zone_active)
          || (Array.isArray(zones) && zones.length > 0);
        els.zoneSourceNote.textContent = hasZones
          ? `Zones saved for ${label}`
          : `No zones for ${label}`;
      }
    }
    if (els.clearZoneBtn) {
      const hasZones = Boolean(data.restricted_zone_active)
        || (Array.isArray(data.restricted_zones) && data.restricted_zones.length > 0);
      els.clearZoneBtn.classList.toggle("hidden", !hasZones);
    }
    if (data.loitering_threshold_seconds != null) {
      loiteringThresholdSeconds = Number(data.loitering_threshold_seconds);
      if (els.loiteringInput && document.activeElement !== els.loiteringInput) {
        els.loiteringInput.value = String(Math.round(loiteringThresholdSeconds));
      }
    }
    if (data.incident_focus) {
      updateFocusHud(data.incident_focus);
    }
  } catch (_err) {
    wasOnline = false;
    setLiveBadge(false);
  }
}

async function refreshFrame() {
  if (frameInFlight || document.hidden) return;
  frameInFlight = true;
  try {
    const res = await fetch(`/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob || blob.size < 100) return;
    const url = URL.createObjectURL(blob);
    els.videoStream.src = url;
    if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
    previousObjectUrl = url;
  } catch (_err) {
  } finally {
    frameInFlight = false;
  }
}

function isViewAdjusted() {
  return currentZoom() > 1 || panX !== 0 || panY !== 0;
}

function captureViewportSnapshot() {
  return new Promise((resolve, reject) => {
    const img = els.videoStream;
    if (!img.src || !img.complete || !img.naturalWidth) {
      reject(new Error("No frame available"));
      return;
    }
    const vpW = els.videoViewport.clientWidth;
    const vpH = els.videoViewport.clientHeight;
    const zoom = currentZoom();
    const canvas = document.createElement("canvas");
    canvas.width = vpW;
    canvas.height = vpH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, vpW, vpH);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const imgRatio = nw / nh;
    const vpRatio = vpW / vpH;
    let dw, dh, dx, dy;
    if (imgRatio > vpRatio) {
      dw = vpW;
      dh = vpW / imgRatio;
      dx = 0;
      dy = (vpH - dh) / 2;
    } else {
      dh = vpH;
      dw = vpH * imgRatio;
      dx = (vpW - dw) / 2;
      dy = 0;
    }
    ctx.save();
    ctx.translate(vpW / 2 + panX, vpH / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-vpW / 2, -vpH / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))),
      "image/jpeg",
      0.92,
    );
  });
}

async function takeSnapshot() {
  els.snapshotMsg.textContent = "Saving…";
  try {
    let res;
    if (isViewAdjusted()) {
      const blob = await captureViewportSnapshot();
      const form = new FormData();
      form.append("viewport", blob, "snapshot.jpg");
      res = await fetch("/snapshot", { method: "POST", body: form });
    } else {
      res = await fetch("/snapshot", { method: "POST" });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Snapshot failed");
    els.snapshotMsg.textContent = `Saved ${data.filename}`;
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 4000);
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Snapshot failed";
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 4000);
  }
}

function toggleFullscreen() {
  const frame = els.cameraFrame;
  if (!document.fullscreenElement) {
    (frame.requestFullscreen || frame.webkitRequestFullscreen)?.call(frame);
  } else {
    document.exitFullscreen?.();
  }
}

async function postJson(url, method = "POST") {
  const res = await fetch(url, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

async function switchToCamera(cameraId) {
  if (switchingSource) return;

  if (cameraId === 2 && !camera2Ready) {
    viewCameraId = 2;
    applyViewCameraUi(null);
    return;
  }

  if (cameraId === 1 && isCam2SetupView() && activeCameraId === 1) {
    viewCameraId = 1;
    applyViewCameraUi(null);
    return;
  }

  if (cameraId === activeCameraId && !isCam2SetupView()) {
    viewCameraId = cameraId;
    applyViewCameraUi(null);
    return;
  }

  switchingSource = true;
  try {
    if (zoneEditMode) {
      await cancelZoneEdit();
    }
    editZones = [];
    await postJson(`/source/camera/${cameraId}`);
    viewCameraId = cameraId;
    await refreshStatus();
    refreshFrame();
    await refreshFocusStatus();
  } catch (err) {
    els.snapshotMsg.textContent = err.message;
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 3000);
  } finally {
    switchingSource = false;
  }
}

function navigateCamera(_delta) {
  const nextId = viewCameraId === 1 ? 2 : 1;
  switchToCamera(nextId);
}

async function uploadSelectedFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/upload/video", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Upload failed");
  return data;
}

async function deleteCamera2() {
  if (!confirm("Delete CCTV 02 recording? This cannot be undone.")) return;
  try {
    if (zoneEditMode) {
      await cancelZoneEdit();
    }
    editZones = [];
    exitZoneEditMode();
    await postJson("/source/camera2", "DELETE");
    camera2Ready = false;
    els.uploadName.textContent = "No recording loaded";
    if (els.videoFile) els.videoFile.value = "";
    viewCameraId = 1;
    activeCameraId = 1;
    await refreshStatus();
    refreshFrame();
    await refreshFocusStatus();
  } catch (err) {
    els.snapshotMsg.textContent = err.message;
  }
}

async function toggleLoopPlayback() {
  if (currentSource !== SOURCE_VIDEO) return;
  try {
    if (playbackPaused) {
      await postJson("/source/video/resume");
      refreshFrame();
    } else {
      await postJson("/source/video/pause");
    }
    await refreshStatus();
  } catch (err) {
    els.snapshotMsg.textContent = err.message;
  }
}

function getVideoLayout() {
  const vpW = els.videoViewport.clientWidth;
  const vpH = els.videoViewport.clientHeight;
  const img = els.videoStream;
  const nw = img.naturalWidth || 1280;
  const nh = img.naturalHeight || 720;
  const imgRatio = nw / nh;
  const vpRatio = vpW / vpH;
  let dw;
  let dh;
  let dx;
  let dy;
  if (imgRatio > vpRatio) {
    dw = vpW;
    dh = vpW / imgRatio;
    dx = 0;
    dy = (vpH - dh) / 2;
  } else {
    dh = vpH;
    dw = vpH * imgRatio;
    dx = (vpW - dw) / 2;
    dy = 0;
  }
  return { vpW, vpH, nw, nh, dw, dh, dx, dy };
}

function viewportPointToNormalized(vx, vy) {
  const { vpW, vpH, dw, dh, dx, dy } = getVideoLayout();
  const zoom = currentZoom();
  const cx = vpW / 2;
  const cy = vpH / 2;
  let px = (vx - cx - panX) / zoom + cx;
  let py = (vy - cy - panY) / zoom + cy;
  const nx = (px - dx) / dw;
  const ny = (py - dy) / dh;
  return {
    x: Math.max(0, Math.min(1, nx)),
    y: Math.max(0, Math.min(1, ny)),
  };
}

function normalizedRectToViewport(norm) {
  const { dw, dh, dx, dy, vpW, vpH } = getVideoLayout();
  const zoom = currentZoom();
  const cx = vpW / 2;
  const cy = vpH / 2;
  const toVp = (nx, ny) => {
    let px = dx + nx * dw;
    let py = dy + ny * dh;
    px = (px - cx) * zoom + cx + panX;
    py = (py - cy) * zoom + cy + panY;
    return { x: px, y: py };
  };
  const p1 = toVp(norm.x, norm.y);
  const p2 = toVp(norm.x + norm.width, norm.y + norm.height);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

function normRectFromPoints(p1, p2) {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  if (width < 0.008 || height < 0.008) return null;
  return { x, y, width, height };
}

function clampNormZone(z) {
  const x = Math.max(0, Math.min(1, z.x));
  const y = Math.max(0, Math.min(1, z.y));
  const width = Math.max(0.01, Math.min(1 - x, z.width));
  const height = Math.max(0.01, Math.min(1 - y, z.height));
  return { x, y, width, height };
}

function zoneHandles(r) {
  const h = ZONE_HANDLE;
  return {
    nw: { x: r.x - h / 2, y: r.y - h / 2, w: h, h: h },
    ne: { x: r.x + r.w - h / 2, y: r.y - h / 2, w: h, h: h },
    sw: { x: r.x - h / 2, y: r.y + r.h - h / 2, w: h, h: h },
    se: { x: r.x + r.w - h / 2, y: r.y + r.h - h / 2, w: h, h: h },
  };
}

function pointInBox(px, py, bx, by, bw, bh) {
  return px >= bx && px <= bx + bw && py >= by && py <= by + bh;
}

function hitTestZoneEdit(px, py) {
  for (let i = editZones.length - 1; i >= 0; i -= 1) {
    const r = normalizedRectToViewport(editZones[i]);
    const handles = zoneHandles(r);
    for (const [name, h] of Object.entries(handles)) {
      if (pointInBox(px, py, h.x, h.y, h.w, h.h)) {
        return { mode: `resize-${name}`, index: i };
      }
    }
    if (pointInBox(px, py, r.x, r.y, r.w, r.h)) {
      return { mode: "move", index: i };
    }
  }
  return { mode: "draw", index: -1 };
}

function resizeZoneCanvas() {
  const canvas = els.zoneEditCanvas;
  if (!canvas) return;
  canvas.width = els.videoViewport.clientWidth;
  canvas.height = els.videoViewport.clientHeight;
  drawZoneEditCanvas();
}

function drawZoneEditCanvas() {
  const canvas = els.zoneEditCanvas;
  if (!canvas || canvas.classList.contains("hidden")) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawOne = (norm, idx, selected) => {
    const r = normalizedRectToViewport(norm);
    ctx.fillStyle = selected ? "rgba(255,180,80,0.2)" : "rgba(255,80,80,0.15)";
    ctx.strokeStyle = selected ? "rgba(255,180,80,0.95)" : "rgba(255,80,80,0.85)";
    ctx.lineWidth = 2;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillStyle = selected ? "#ffc870" : "#ff8888";
    ctx.fillText(`Zone ${idx + 1}`, r.x + 6, r.y + 14);
    const handles = zoneHandles(r);
    ctx.fillStyle = "#fff";
    Object.values(handles).forEach((h) => {
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.strokeRect(h.x, h.y, h.w, h.h);
    });
  };

  editZones.forEach((z, i) => {
    drawOne(z, i, zoneDragIndex === i);
  });

  if (zoneDraftRect && zoneDragMode === "draw") {
    const r = normalizedRectToViewport(zoneDraftRect);
    ctx.fillStyle = "rgba(255,180,80,0.18)";
    ctx.strokeStyle = "rgba(255,180,80,0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
}

function exitZoneEditMode(restoreEditingFlag = true) {
  zoneEditMode = false;
  zoneDragMode = null;
  zoneDragIndex = -1;
  zoneDragStartNorm = null;
  zoneDragOrigin = null;
  zoneDraftRect = null;
  editZonesSnapshot = null;
  if (zoneSyncTimer) {
    clearTimeout(zoneSyncTimer);
    zoneSyncTimer = null;
  }
  els.zoneEditCanvas?.classList.add("hidden");
  els.zoneEditBar?.classList.add("hidden");
  els.editZoneBtn?.classList.remove("active-edit");
  if (restoreEditingFlag) {
    setZoneEditingMode(false);
  }
}

async function setZoneEditingMode(active) {
  try {
    await fetch("/zone/editing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
  } catch (_err) {
  }
}

async function syncZonesPreview(immediate = false) {
  const run = async () => {
    zoneSyncTimer = null;
    try {
      await fetch("/zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones: editZones, reset_states: true }),
      });
    } catch (_err) {
    }
  };
  if (immediate) {
    if (zoneSyncTimer) clearTimeout(zoneSyncTimer);
    zoneSyncTimer = null;
    await run();
    return;
  }
  if (zoneSyncTimer) return;
  zoneSyncTimer = setTimeout(run, 80);
}

async function startEditZone() {
  if (zoneEditMode) return;
  endViewPanDrag();
  try {
    const res = await fetch("/zone", { cache: "no-store" });
    const data = await res.json();
    editZones = Array.isArray(data.restricted_zones)
      ? data.restricted_zones.map((z) => ({ ...z }))
      : (data.restricted_zone ? [{ ...data.restricted_zone }] : []);
    editZonesSnapshot = JSON.parse(JSON.stringify(editZones));
    await setZoneEditingMode(true);
    zoneEditMode = true;
    els.zoneEditCanvas?.classList.remove("hidden");
    els.zoneEditBar?.classList.remove("hidden");
    els.editZoneBtn?.classList.add("active-edit");
    resizeZoneCanvas();
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Could not start zone edit";
  }
}

async function cancelZoneEdit() {
  if (editZonesSnapshot) {
    try {
      await fetch("/zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones: editZonesSnapshot, reset_states: true }),
      });
    } catch (_err) {
    }
  }
  editZones = [];
  exitZoneEditMode();
  await refreshStatus();
}

async function saveZoneEdit() {
  if (editZones.length === 0) {
    els.snapshotMsg.textContent = "Add at least one zone (drag on empty area)";
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 2500);
    return;
  }
  try {
    await syncZonesPreview(true);
    const res = await fetch("/zone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zones: editZones, reset_states: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Save failed");
    editZones = [];
    editZonesSnapshot = null;
    exitZoneEditMode();
    await refreshStatus();
    const count = data.restricted_zones?.length ?? 0;
    els.snapshotMsg.textContent = `Saved ${count} zone(s)`;
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 2500);
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Save failed";
  }
}

async function clearZone() {
  if (!confirm("Clear all restricted zones for this camera?")) return;
  try {
    await fetch("/zone", { method: "DELETE" });
    editZones = [];
    editZonesSnapshot = null;
    if (zoneEditMode) {
      exitZoneEditMode();
    }
    await refreshStatus();
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Clear failed";
  }
}

function zoneCanvasPoint(event) {
  const rect = els.zoneEditCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function applyZoneResize(origin, handle, currentNorm) {
  let { x, y, width, height } = { ...origin };
  const cx = currentNorm.x;
  const cy = currentNorm.y;
  if (handle === "se") {
    width = cx - x;
    height = cy - y;
  } else if (handle === "sw") {
    const x2 = x + width;
    x = cx;
    width = x2 - x;
    height = cy - y;
  } else if (handle === "ne") {
    const y2 = y + height;
    width = cx - x;
    y = cy;
    height = y2 - y;
  } else if (handle === "nw") {
    const x2 = x + width;
    const y2 = y + height;
    x = cx;
    y = cy;
    width = x2 - x;
    height = y2 - y;
  }
  if (width < 0) { x += width; width = Math.abs(width); }
  if (height < 0) { y += height; height = Math.abs(height); }
  return clampNormZone({ x, y, width, height });
}

function onZonePointerDown(event) {
  if (!zoneEditMode) return;
  event.preventDefault();
  const pt = zoneCanvasPoint(event);
  const hit = hitTestZoneEdit(pt.x, pt.y);
  zoneDragStartNorm = viewportPointToNormalized(pt.x, pt.y);
  zoneDragMode = hit.mode;
  zoneDragIndex = hit.index;
  zoneDraftRect = null;

  if (hit.mode === "move") {
    zoneDragOrigin = { ...editZones[hit.index] };
  } else if (hit.mode.startsWith("resize-")) {
    zoneDragOrigin = { ...editZones[hit.index] };
  } else if (editZones.length < MAX_ZONES) {
    zoneDragMode = "draw";
    zoneDragIndex = -1;
  } else {
    els.snapshotMsg.textContent = `Maximum ${MAX_ZONES} zones`;
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 2000);
    return;
  }
  els.zoneEditCanvas.setPointerCapture(event.pointerId);
}

function onZonePointerMove(event) {
  if (!zoneEditMode || !zoneDragMode) return;
  event.preventDefault();
  const pt = zoneCanvasPoint(event);
  const curNorm = viewportPointToNormalized(pt.x, pt.y);

  if (zoneDragMode === "draw" && zoneDragStartNorm) {
    zoneDraftRect = normRectFromPoints(zoneDragStartNorm, curNorm);
    drawZoneEditCanvas();
    return;
  }

  if (zoneDragIndex < 0 || !zoneDragOrigin) return;

  if (zoneDragMode === "move") {
    const dx = curNorm.x - zoneDragStartNorm.x;
    const dy = curNorm.y - zoneDragStartNorm.y;
    editZones[zoneDragIndex] = clampNormZone({
      x: zoneDragOrigin.x + dx,
      y: zoneDragOrigin.y + dy,
      width: zoneDragOrigin.width,
      height: zoneDragOrigin.height,
    });
    drawZoneEditCanvas();
    syncZonesPreview();
    return;
  }

  if (zoneDragMode.startsWith("resize-")) {
    const handle = zoneDragMode.replace("resize-", "");
    editZones[zoneDragIndex] = applyZoneResize(zoneDragOrigin, handle, curNorm);
    drawZoneEditCanvas();
    syncZonesPreview();
  }
}

async function onZonePointerUp(event) {
  if (!zoneDragMode) return;
  if (zoneDragMode === "draw" && zoneDraftRect) {
    editZones.push(clampNormZone(zoneDraftRect));
    zoneDraftRect = null;
    await syncZonesPreview(true);
  } else if (zoneDragIndex >= 0) {
    await syncZonesPreview(true);
  }
  zoneDragMode = null;
  zoneDragIndex = -1;
  zoneDragStartNorm = null;
  zoneDragOrigin = null;
  if (els.zoneEditCanvas.hasPointerCapture(event.pointerId)) {
    els.zoneEditCanvas.releasePointerCapture(event.pointerId);
  }
  drawZoneEditCanvas();
}

function updateFocusLayout(active) {
  focusActive = Boolean(active);
  els.monitorLayout?.classList.toggle("focus-active", focusActive);
  els.incidentFocusShell?.classList.toggle("hidden", !focusActive);
  els.cameraFrame?.classList.toggle("focus-compact", focusActive);
}

function renderFocusPanels(focuses) {
  const grid = els.incidentFocusGrid;
  if (!grid) return;

  const list = Array.isArray(focuses) ? focuses : [];
  const existingIds = new Set(list.map((f) => f.slot_id));

  grid.querySelectorAll(".incident-focus-item").forEach((node) => {
    if (!existingIds.has(node.dataset.slotId)) {
      const oldUrl = focusObjectUrls.get(node.dataset.slotId);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      focusObjectUrls.delete(node.dataset.slotId);
      node.remove();
    }
  });

  list.forEach((focus) => {
    let item = grid.querySelector(`[data-slot-id="${focus.slot_id}"]`);
    if (!item) {
      item = document.createElement("div");
      item.className = "incident-focus-item";
      item.dataset.slotId = focus.slot_id;
      item.innerHTML = `
        <div class="focus-item-header">
          <div class="focus-item-heading">
            <span class="focus-lock-pill">Target lock</span>
            <span class="focus-item-title">${focus.zone_label || "Incident"} · Track #${focus.track_id}</span>
          </div>
          <button type="button" class="source-btn focus-release-btn focus-release-one">Release</button>
        </div>
        <div class="focus-viewport has-frame">
          <img alt="Incident focus track ${focus.track_id}" />
          <span class="focus-state-chip hidden"></span>
        </div>
        <div class="focus-item-meta">
          <span class="focus-meta-tag focus-meta-event"></span>
          <span class="focus-meta-tag focus-meta-zoom"></span>
          <span class="focus-meta-tag focus-meta-status"></span>
        </div>`;
      item.querySelector(".focus-release-one")?.addEventListener("click", () => {
        releaseTarget(focus.slot_id);
      });
      grid.appendChild(item);
    }

    item.classList.toggle("searching", focus.tracking_status === "searching");
    item.classList.toggle("lost", focus.tracking_status === "lost");
    const title = item.querySelector(".focus-item-title");
    if (title) {
      title.textContent = `${focus.zone_label || "Incident"} · Track #${focus.track_id}`;
    }
    const eventEl = item.querySelector(".focus-meta-event");
    const zoomEl = item.querySelector(".focus-meta-zoom");
    const statusEl = item.querySelector(".focus-meta-status");
    const chip = item.querySelector(".focus-state-chip");
    if (eventEl) {
      eventEl.textContent = focus.event_label || focus.event || "Incident";
    }
    if (zoomEl) {
      zoomEl.textContent = focus.zoom != null ? `${focus.zoom}× zoom` : "—";
    }
    if (statusEl) {
      const st = focus.tracking_status || "active";
      statusEl.textContent = focus.tracking_label || st.toUpperCase();
      statusEl.classList.toggle("is-active", st === "active");
      statusEl.classList.toggle("is-searching", st === "searching");
      statusEl.classList.toggle("is-lost", st === "lost");
    }
    if (chip) {
      const showChip = focus.tracking_status === "searching" || focus.tracking_status === "lost";
      chip.classList.toggle("hidden", !showChip);
      chip.textContent = focus.tracking_status === "lost" ? "Target lost" : "Searching…";
      chip.classList.toggle("is-lost", focus.tracking_status === "lost");
    }

    refreshFocusFrameForSlot(focus.slot_id);
  });
}

function updateFocusHud(data) {
  const focuses = Array.isArray(data?.focuses) && data.focuses.length > 0
    ? data.focuses
    : (data?.active && data?.slot_id ? [data] : []);
  const active = focuses.length > 0;

  if (!active) {
    updateFocusLayout(false);
    if (els.incidentFocusGrid) els.incidentFocusGrid.innerHTML = "";
    focusObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    focusObjectUrls.clear();
    if (els.focusIdleGlobal) els.focusIdleGlobal.textContent = "NO ACTIVE INCIDENT";
    return;
  }

  updateFocusLayout(true);
  if (els.focusIdleGlobal) els.focusIdleGlobal.textContent = "";
  renderFocusPanels(focuses);
}

async function ensureAutoFocus(event, { refresh = true } = {}) {
  const et = event?.event_type;
  if (et !== "entry" && et !== "loitering") return;
  try {
    await fetch("/focus/auto-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track_id: event.track_id,
        event_type: et,
        zone_index: event.zone_index ?? 0,
      }),
    });
    if (refresh) await refreshFocusStatus();
  } catch (_err) {
    if (refresh) await refreshFocusStatus();
  }
}

async function refreshFocusStatus() {
  try {
    const res = await fetch("/focus/status", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    updateFocusHud(data);
    if (Array.isArray(data.evidence_saved) && data.evidence_saved.length > 0) {
      const names = data.evidence_saved.join(", ");
      els.snapshotMsg.textContent = `Evidence saved: ${names}`;
      setTimeout(() => { els.snapshotMsg.textContent = ""; }, 5000);
    }
  } catch (_err) {
  }
}

async function refreshFocusFrameForSlot(slotId) {
  if (!slotId || focusFrameInflight.has(slotId)) return;
  focusFrameInflight.add(slotId);
  try {
    const res = await fetch(
      `/focus/frame?slot=${encodeURIComponent(slotId)}&t=${Date.now()}`,
      { cache: "no-store" },
    );
    if (res.status === 204 || !res.ok) return;
    const blob = await res.blob();
    if (!blob.size) return;
    const url = URL.createObjectURL(blob);
    const item = els.incidentFocusGrid?.querySelector(`[data-slot-id="${slotId}"]`);
    const img = item?.querySelector("img");
    if (img) {
      const old = focusObjectUrls.get(slotId);
      if (old) URL.revokeObjectURL(old);
      focusObjectUrls.set(slotId, url);
      img.src = url;
    }
  } catch (_err) {
  } finally {
    focusFrameInflight.delete(slotId);
  }
}

function refreshAllFocusFrames() {
  if (!focusActive || !els.incidentFocusGrid) return;
  els.incidentFocusGrid.querySelectorAll(".incident-focus-item").forEach((node) => {
    if (node.dataset.slotId) refreshFocusFrameForSlot(node.dataset.slotId);
  });
}

async function followTrack(trackId) {
  try {
    const res = await fetch("/focus/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId }),
    });
    if (!res.ok) throw new Error("Follow failed");
    updateFocusHud(await res.json());
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Could not follow track";
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 3000);
  }
}

async function releaseTarget(slotId = null) {
  try {
    const url = slotId
      ? `/focus/release?slot=${encodeURIComponent(slotId)}`
      : "/focus/release";
    await fetch(url, { method: "POST" });
    await refreshFocusStatus();
  } catch (_err) {
  }
}

function showZoneEventBanner(event) {
  if (!els.zoneEventBanner) return;
  const isLoitering = event.event_type === "loitering";
  if (els.zoneEventTitle) {
    els.zoneEventTitle.textContent = event.title
      || (isLoitering ? "⚠ LOITERING DETECTED" : "⚠ RESTRICTED AREA ENTRY");
  }
  const zlabel = event.zone_label ? ` — ${event.zone_label}` : "";
  els.zoneEventTrack.textContent = `Track #${event.track_id}${zlabel}`;
  if (els.zoneEventDetail) {
    if (isLoitering) {
      const dur = Math.round(Number(event.duration_seconds) || loiteringThresholdSeconds);
      els.zoneEventDetail.textContent = `Restricted Area · Duration: ${dur} seconds`;
      els.zoneEventDetail.classList.remove("hidden");
    } else {
      els.zoneEventDetail.textContent = "";
      els.zoneEventDetail.classList.add("hidden");
    }
  }
  els.zoneEventTime.textContent = `Time: ${event.time_label || "--:--:--"}`;
  els.zoneEventBanner.classList.toggle("loitering-alert", isLoitering);
  els.zoneEventBanner.classList.remove("hidden");
  els.cameraFrame?.classList.add("zone-banner-visible");
  if (zoneBannerTimer) clearTimeout(zoneBannerTimer);
  zoneBannerTimer = setTimeout(() => {
    els.zoneEventBanner?.classList.add("hidden");
    els.cameraFrame?.classList.remove("zone-banner-visible");
  }, 5000);
}

function renderEventFeed(events) {
  if (!els.eventFeed || !Array.isArray(events)) return;
  const recent = events.slice(-6).reverse();
  if (recent.length === 0) {
    els.eventFeed.innerHTML = "";
    return;
  }
  els.eventFeed.innerHTML = recent
    .map((ev) => {
      const isLoitering = ev.event_type === "loitering";
      const typeLabel = isLoitering ? "Loitering Detected" : "Restricted Area Entry";
      const typeCls = isLoitering ? "loitering" : "entry";
      const extra = isLoitering && ev.duration_seconds != null
        ? ` · ${Math.round(ev.duration_seconds)} sec`
        : "";
      return `<li class="event-feed-item">
        <span class="event-feed-time">${ev.time_label || "--:--"}</span>
        <span class="event-feed-type ${typeCls}">${typeLabel}</span>
        <span class="event-feed-track">Track #${ev.track_id}${extra}</span>
      </li>`;
    })
    .join("");
}

async function pollZoneEvents() {
  try {
    const res = await fetch("/zone/events", { cache: "no-store" });
    if (!res.ok) return;
    const events = await res.json();
    if (!Array.isArray(events)) return;
    renderEventFeed(events);
    if (events.length === 0) return;

    const newEvents = events.filter((ev) => {
      const eid = Number(ev.event_id) || 0;
      return eid > lastShownEventId;
    });
    if (newEvents.length === 0) return;

    lastShownEventId = Math.max(
      lastShownEventId,
      ...newEvents.map((ev) => Number(ev.event_id) || 0),
    );
    showZoneEventBanner(newEvents[newEvents.length - 1]);
    await Promise.all(newEvents.map((ev) => ensureAutoFocus(ev, { refresh: false })));
    await refreshFocusStatus();
    await refreshAlerts();
  } catch (_err) {
  }
}

function evidenceUrl(filename) {
  if (!filename) return null;
  return `/alerts/evidence/${encodeURIComponent(filename)}`;
}

function renderAlertsList(alerts) {
  if (!els.alertsList) return;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    els.alertsList.innerHTML = "";
    els.alertsEmpty?.classList.remove("hidden");
    return;
  }
  els.alertsEmpty?.classList.add("hidden");
  els.alertsList.innerHTML = alerts
    .map((alert) => {
      const isNew = alert.status === "new";
      const isFresh = isNew && !knownAlertIds.has(alert.id);
      const sev = String(alert.severity || "medium").toLowerCase();
      const st = String(alert.status || "new").toLowerCase().replace(/ /g, "_");
      const time = alert.video_time || alert.time_label || "--:--:--";
      return `<li class="alert-card${isFresh ? " alert-card-new" : ""}" data-alert-id="${alert.id}">
        <div class="alert-card-severity ${sev}">${(alert.severity_label || sev).toUpperCase()}</div>
        <p class="alert-card-event">${alert.event_label || alert.event_type}</p>
        <div class="alert-card-meta">
          Track #${alert.track_id}<br />
          ${alert.camera || "—"}<br />
          ${time}
        </div>
        <span class="alert-card-status ${st}">${alert.status_label || st.toUpperCase()}</span>
      </li>`;
    })
    .join("");

  alerts.forEach((a) => knownAlertIds.add(a.id));

  els.alertsList.querySelectorAll(".alert-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.alertId;
      if (id) openAlertDetails(id);
    });
  });
}

function updateAlertsNewBadge(count) {
  if (!els.alertsNewCount) return;
  const n = Number(count) || 0;
  els.alertsNewCount.textContent = String(n);
  els.alertsNewCount.classList.toggle("hidden", n <= 0);
}

async function refreshAlerts() {
  try {
    const query = alertsFilter === "all" ? "" : `?filter=${encodeURIComponent(alertsFilter)}`;
    const res = await fetch(`/alerts${query}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    alertsCache = data.alerts || [];
    alertsNewCount = data.new_count || 0;
    renderAlertsList(alertsCache);
    updateAlertsNewBadge(alertsNewCount);
    if (selectedAlertId) {
      const still = alertsCache.find((a) => a.id === selectedAlertId);
      if (still) renderAlertModal(still);
    }
  } catch (_err) {
  }
}

function renderAlertModal(alert) {
  if (!els.alertModalBody || !alert) return;
  selectedAlertId = alert.id;

  const trackActive = activeTrackIds.has(Number(alert.track_id))
    || Boolean(alert.track_active);

  const timeline = (alert.timeline || [])
    .map(
      (ev) => `<li>
        <div class="alert-timeline-time">${ev.time_label || "--:--:--"}</div>
        <div>${ev.event_label || ev.event_type || "Event"}</div>
      </li>`,
    )
    .join("");

  const fullUrl = evidenceUrl(alert.full_snapshot);
  const focusUrl = evidenceUrl(alert.focus_snapshot);

  const fullBlock = fullUrl
    ? `<div class="alert-evidence-block"><div class="alert-evidence-label">Full Scene</div><img src="${fullUrl}" alt="Full scene evidence" data-lightbox="${fullUrl}" /></div>`
    : `<div class="alert-evidence-block"><div class="alert-evidence-label">Full Scene</div><div class="alert-evidence-missing">Evidence unavailable</div></div>`;

  const focusBlock = focusUrl
    ? `<div class="alert-evidence-block"><div class="alert-evidence-label">Incident Focus</div><img src="${focusUrl}" alt="Focus evidence" data-lightbox="${focusUrl}" /></div>`
    : `<div class="alert-evidence-block"><div class="alert-evidence-label">Incident Focus</div><div class="alert-evidence-missing">Evidence unavailable</div></div>`;

  const videoSection = alert.video_filename
    ? `<dt>Recording</dt><dd>${alert.video_filename}</dd>
       <dt>Video Time</dt><dd>${alert.video_time || "—"}</dd>
       <dt>Generated</dt><dd>${alert.generated_label || "—"}</dd>`
    : `<dt>Timestamp</dt><dd>${alert.time_label || "—"}</dd>`;

  els.alertModalBody.innerHTML = `
    <dl class="alert-detail-grid">
      <dt>Alert ID</dt><dd>${alert.id}</dd>
      <dt>Event</dt><dd>${alert.event_label || alert.event_type}</dd>
      <dt>Severity</dt><dd>${alert.severity_label || alert.severity}</dd>
      <dt>Status</dt><dd>${alert.status_label || alert.status}</dd>
      <dt>Track ID</dt><dd>#${alert.track_id}</dd>
      <dt>Camera</dt><dd>${alert.camera || "—"}</dd>
      ${videoSection}
    </dl>
    ${timeline ? `<ul class="alert-timeline">${timeline}</ul>` : ""}
    <div class="alert-evidence-row">${fullBlock}${focusBlock}</div>
  `;

  els.alertModalBody.querySelectorAll("[data-lightbox]").forEach((img) => {
    img.addEventListener("click", () => openEvidenceLightbox(img.dataset.lightbox));
  });

  renderAlertActions(alert, trackActive);
}

function renderAlertActions(alert, trackActive) {
  if (!els.alertModalActions) return;
  const actions = ALERT_ACTIONS[alert.status] || [];
  const btns = actions
    .map(
      (a) => `<button type="button" class="alert-action-btn${a.primary ? " primary" : ""}" data-status="${a.status}">${a.label}</button>`,
    )
    .join("");

  const focusBtn = trackActive
    ? `<button type="button" class="alert-action-btn primary" id="alert-focus-track">Focus Track</button>`
    : `<button type="button" class="alert-action-btn" disabled title="Track no longer active">Track no longer active</button>`;

  els.alertModalActions.innerHTML = `${focusBtn}${btns}`;

  document.getElementById("alert-focus-track")?.addEventListener("click", async () => {
    await followTrack(Number(alert.track_id));
    closeAlertModal();
  });

  els.alertModalActions.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => updateAlertStatus(alert.id, btn.dataset.status));
  });
}

async function openAlertDetails(alertId) {
  try {
    const res = await fetch(`/alerts/${encodeURIComponent(alertId)}`, { cache: "no-store" });
    if (!res.ok) return;
    const alert = await res.json();
    renderAlertModal(alert);
    els.alertModal?.classList.remove("hidden");
  } catch (_err) {
  }
}

function closeAlertModal() {
  els.alertModal?.classList.add("hidden");
  selectedAlertId = null;
}

function openEvidenceLightbox(url) {
  if (!els.evidenceLightbox || !els.evidenceLightboxImg || !url) return;
  els.evidenceLightboxImg.src = url;
  els.evidenceLightbox.classList.remove("hidden");
}

function closeEvidenceLightbox() {
  els.evidenceLightbox?.classList.add("hidden");
  if (els.evidenceLightboxImg) els.evidenceLightboxImg.src = "";
}

async function updateAlertStatus(alertId, status) {
  try {
    const res = await fetch(`/alerts/${encodeURIComponent(alertId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Status update failed");
    }
    const updated = await res.json();
    renderAlertModal(updated);
    await refreshAlerts();
  } catch (err) {
    els.snapshotMsg.textContent = err.message || "Could not update alert";
    setTimeout(() => { els.snapshotMsg.textContent = ""; }, 3000);
  }
}

els.snapshotBtn.addEventListener("click", takeSnapshot);
els.fullscreenBtn.addEventListener("click", toggleFullscreen);
els.resetViewBtn.addEventListener("click", resetView);
els.zoomInBtn.addEventListener("click", zoomIn);
els.zoomOutBtn.addEventListener("click", zoomOut);
els.panUp.addEventListener("click", () => pan(0, PAN_STEP));
els.panDown.addEventListener("click", () => pan(0, -PAN_STEP));
els.panLeft.addEventListener("click", () => pan(PAN_STEP, 0));
els.panRight.addEventListener("click", () => pan(-PAN_STEP, 0));

els.videoViewport?.addEventListener("pointerdown", onViewPanPointerDown);
els.videoViewport?.addEventListener("pointermove", onViewPanPointerMove);
els.videoViewport?.addEventListener("pointerup", endViewPanDrag);
els.videoViewport?.addEventListener("pointercancel", endViewPanDrag);
els.videoViewport?.addEventListener("lostpointercapture", endViewPanDrag);

els.camPrev?.addEventListener("click", () => navigateCamera(-1));
els.camNext?.addEventListener("click", () => navigateCamera(1));
els.closeCam2SetupBtn?.addEventListener("click", closeCam2Setup);
els.loopBtn?.addEventListener("click", toggleLoopPlayback);
els.editZoneBtn?.addEventListener("click", startEditZone);
els.zoneSaveBtn?.addEventListener("click", saveZoneEdit);
els.zoneCancelBtn?.addEventListener("click", cancelZoneEdit);
els.clearZoneBtn?.addEventListener("click", clearZone);
els.loiteringApplyBtn?.addEventListener("click", applyLoiteringThreshold);
els.loiteringInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyLoiteringThreshold();
});

els.zoneEditCanvas?.addEventListener("pointerdown", onZonePointerDown);
els.zoneEditCanvas?.addEventListener("pointermove", onZonePointerMove);
els.zoneEditCanvas?.addEventListener("pointerup", onZonePointerUp);
els.zoneEditCanvas?.addEventListener("pointercancel", onZonePointerUp);

if (els.toggleTrails) {
  els.toggleTrails.addEventListener("change", () => setTrailsEnabled(els.toggleTrails.checked));
}

els.videoFile?.addEventListener("change", async () => {
  const file = els.videoFile.files?.[0];
  if (!file) {
    camera2Ready = false;
    els.uploadName.textContent = "No recording loaded";
    return;
  }
  els.uploadName.textContent = `${file.name} — uploading…`;
  try {
    await uploadSelectedFile(file);
    camera2Ready = true;
    els.uploadName.textContent = file.name;
    await switchToCamera(2);
  } catch (err) {
    camera2Ready = false;
    els.uploadName.textContent = err.message || "Upload failed";
  }
});

els.deleteCamera2Btn?.addEventListener("click", deleteCamera2);

document.querySelectorAll(".alert-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".alert-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    alertsFilter = btn.dataset.filter || "all";
    refreshAlerts();
  });
});

els.alertModalClose?.addEventListener("click", closeAlertModal);
els.alertModalBackdrop?.addEventListener("click", closeAlertModal);
els.evidenceLightboxClose?.addEventListener("click", closeEvidenceLightbox);
els.evidenceLightbox?.addEventListener("click", (e) => {
  if (e.target === els.evidenceLightbox) closeEvidenceLightbox();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshFrame();
    refreshStatus();
    refreshTracks();
  }
});

window.addEventListener("resize", () => {
  applyViewTransform();
  if (zoneEditMode) resizeZoneCanvas();
});

applyViewTransform();
loadSettings();
refreshStatus();
refreshTracks();
refreshFocusStatus();
refreshAlerts();
refreshFrame();
setInterval(() => {
  refreshStatus().then(() => {
    if (currentSource === SOURCE_WEBCAM) updateClockFromStatus({ source_type: SOURCE_WEBCAM });
  });
}, 1000);
setInterval(refreshTracks, 500);
setInterval(refreshFocusStatus, 500);
setInterval(refreshFrame, 100);
setInterval(() => {
  if (focusActive) refreshAllFocusFrames();
}, 100);
setInterval(pollZoneEvents, 1000);
setInterval(refreshAlerts, 2000);
