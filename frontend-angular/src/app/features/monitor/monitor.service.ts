import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { api } from '../../shared/services/api'
import type { Alert } from '../../shared/types'
import type {
  AlertFilter,
  ExtendedStatus,
  FocusStatusResponse,
  TrackSummary,
  VideoSlotId,
  ZoneEvent,
  ZoneRect,
} from '../../shared/types/monitor'
import {
  adjacentCameraId,
  isVideoSlot,
  LOITERING_MAX,
  LOITERING_MIN,
  MAX_ZONES,
  ZOOM_LEVELS,
} from '../../shared/types/monitor'
import { assignBlobToImage } from '../../shared/utils/blobUrl'
import { liveClock } from '../../shared/utils/monitorFormat'
import {
  applyZoneResize,
  clampNormZone,
  getVideoLayout,
  hitTestZoneEdit,
  normRectFromPoints,
  normalizedRectToViewport,
  viewportPointToNormalized,
  zoneHandles,
} from '../../shared/utils/zoneGeometry'

const SOURCE_VIDEO = 'video'

export interface ZoneBanner {
  title: string
  track: string
  detail?: string
  time: string
  loitering: boolean
}

export interface MonitorToastItem {
  id: number
  message: string
}

interface ZoneDrag {
  mode: string | null
  index: number
  startNorm: { x: number; y: number } | null
  origin: ZoneRect | null
  draft: ZoneRect | null
}

/**
 * Port of React's MonitorContext/MonitorProvider. Provided by the Monitoring page component,
 * so it lives exactly as long as the page (like the React provider).
 * DOM elements (video img, viewport, camera box, zone canvas) are registered by CameraView.
 */
@Injectable()
export class MonitorService {
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)

  readonly status = signal<ExtendedStatus | null>(null)
  readonly tracks = signal<TrackSummary[]>([])
  readonly focus = signal<FocusStatusResponse | null>(null)
  readonly alerts = signal<Alert[]>([])
  readonly alertsNewCount = signal(0)
  readonly alertsFilter = signal<AlertFilter>('all')
  readonly selectedAlert = signal<Alert | null>(null)
  readonly hasFrame = signal(false)
  readonly frameGen = signal(0)
  readonly toasts = signal<MonitorToastItem[]>([])
  readonly zoneBanner = signal<ZoneBanner | null>(null)
  readonly zoneEvents = signal<ZoneEvent[]>([])
  readonly viewCameraId = signal(1)
  readonly videoSlotReady = signal<Record<VideoSlotId, boolean>>({ 2: false, 3: false, 4: false })
  readonly playbackPaused = signal(false)
  readonly zoomIndex = signal(0)
  readonly panX = signal(0)
  readonly panY = signal(0)
  readonly panDragging = signal(false)
  readonly zoneEditMode = signal(false)
  readonly editZones = signal<ZoneRect[]>([])
  readonly loiteringInput = signal('15')
  readonly loiteringMsg = signal('')
  readonly loiteringOk = signal(false)
  readonly showTrails = signal(false)
  private readonly liveClockValue = signal(liveClock())
  readonly videoReplaceMode = signal(false)
  readonly uploadLabel = signal('No recording loaded')

  readonly zoom = computed(() => ZOOM_LEVELS[this.zoomIndex()])
  readonly focusActive = computed(() => (this.focus()?.focuses?.length ?? 0) > 0)
  readonly showVideoSetup = computed(() => {
    const id = this.viewCameraId()
    return isVideoSlot(id) && (!this.videoSlotReady()[id] || this.videoReplaceMode())
  })
  readonly clock = computed(() => {
    const s = this.status()
    return s?.source_type === SOURCE_VIDEO
      ? `${s.playback_time || '00:00'} / ${s.total_time || '00:00'}`
      : this.liveClockValue()
  })
  readonly isRecording = computed(() => Boolean(this.status()?.manual_recording))
  readonly recordingDuration = computed(() => this.status()?.manual_duration_sec ?? 0)

  // DOM elements registered by CameraView (React refs)
  videoEl: HTMLImageElement | null = null
  viewportEl: HTMLDivElement | null = null
  cameraEl: HTMLDivElement | null = null
  canvasEl: HTMLCanvasElement | null = null

  private toastId = 0
  private frameInflight = false
  private readonly prevFrameUrl: { current: string | null } = { current: null }
  private uploading = false
  private lastEventId = 0
  private zoneBannerTimer: number | null = null
  private zoneSnapshot: ZoneRect[] | null = null
  private zoneDrag: ZoneDrag = { mode: null, index: -1, startNorm: null, origin: null, draft: null }
  private panDrag = { active: false, pointerId: null as number | null, startX: 0, startY: 0, originX: 0, originY: 0 }
  private switching = false

  constructor() {
    void this.refreshTracks()
    void this.refreshFocus()
    void this.refreshFrame()
    void api
      .getSettings()
      .then((settings) => {
        if (typeof settings.show_trails === 'boolean') this.showTrails.set(settings.show_trails)
      })
      .catch(() => {})

    const timers = [
      window.setInterval(() => void this.refreshStatus(), 1000),
      window.setInterval(() => void this.refreshTracks(), 500),
      window.setInterval(() => void this.refreshFocus(), 500),
      window.setInterval(() => void this.refreshFrame(), 100),
      window.setInterval(() => void this.pollZoneEvents(), 1000),
      window.setInterval(() => void this.refreshAlertsList(), 2000),
      window.setInterval(() => {
        if (this.status()?.source_type !== SOURCE_VIDEO) this.liveClockValue.set(liveClock())
      }, 1000),
    ]
    inject(DestroyRef).onDestroy(() => {
      timers.forEach((t) => window.clearInterval(t))
      if (this.prevFrameUrl.current) {
        URL.revokeObjectURL(this.prevFrameUrl.current)
        this.prevFrameUrl.current = null
      }
      if (this.zoneBannerTimer) window.clearTimeout(this.zoneBannerTimer)
    })

    // Reload the alerts list whenever the filter changes (React: useEffect on alertsFilter).
    effect(() => {
      this.alertsFilter()
      untracked(() => void this.refreshAlertsList())
    })

    // Keep pan within bounds when zoom changes.
    effect(() => {
      const x = this.panX()
      const y = this.panY()
      const z = this.zoom()
      untracked(() => {
        const c = this.clampPan(x, y, z)
        if (c.x !== x) this.panX.set(c.x)
        if (c.y !== y) this.panY.set(c.y)
      })
    })

    // ?camera=N and ?focus=ALERT deep links (from the dashboard, incidents, map…).
    this.route.queryParamMap.subscribe((params) => void this.handleDeepLink(params.get('camera'), params.get('focus')))
  }

  // ------------------------------------------------------------------ helpers
  flash(msg: string, ms = 3000) {
    const id = ++this.toastId
    this.toasts.update((prev) => [...prev, { id, message: msg }])
    window.setTimeout(() => this.toasts.update((prev) => prev.filter((t) => t.id !== id)), ms)
  }

  private clampPan(x: number, y: number, z: number) {
    const vp = this.viewportEl
    if (!vp || z <= 1) return { x: 0, y: 0 }
    const rect = vp.getBoundingClientRect()
    const maxX = (rect.width * (z - 1)) / 2
    const maxY = (rect.height * (z - 1)) / 2
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }

  private layout() {
    const vp = this.viewportEl!
    const img = this.videoEl
    return getVideoLayout(vp.clientWidth, vp.clientHeight, img?.naturalWidth || 1280, img?.naturalHeight || 720)
  }

  drawCanvas() {
    const canvas = this.canvasEl
    const vp = this.viewportEl
    if (!canvas || !vp || !this.zoneEditMode()) return
    canvas.width = vp.clientWidth
    canvas.height = vp.clientHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const layout = this.layout()
    const zoom = this.zoom()
    const panX = this.panX()
    const panY = this.panY()
    const drawOne = (norm: ZoneRect, selected: boolean) => {
      const r = normalizedRectToViewport(norm, layout, zoom, panX, panY)
      ctx.fillStyle = selected ? 'rgba(255,180,80,0.2)' : 'rgba(255,80,80,0.15)'
      ctx.strokeStyle = selected ? 'rgba(255,180,80,0.95)' : 'rgba(255,80,80,0.85)'
      ctx.lineWidth = 2
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      Object.values(zoneHandles(r)).forEach((h) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(h.x, h.y, h.w, h.h)
      })
    }
    this.editZones().forEach((z, i) => drawOne(z, this.zoneDrag.index === i))
    const draft = this.zoneDrag.draft
    if (draft && this.zoneDrag.mode === 'draw') {
      const r = normalizedRectToViewport(draft, layout, zoom, panX, panY)
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(255,180,80,0.95)'
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.setLineDash([])
    }
  }

  // ------------------------------------------------------------------ polling
  async refreshFrame() {
    if (this.frameInflight || document.hidden) return
    this.frameInflight = true
    try {
      const blob = await api.getFrameBlob()
      if (!blob || blob.size < 100) return
      const url = URL.createObjectURL(blob)
      assignBlobToImage(this.videoEl, url, this.prevFrameUrl, () => {
        this.hasFrame.set(true)
        this.frameGen.update((g) => g + 1)
      })
    } catch {
      /* ignore */
    } finally {
      this.frameInflight = false
    }
  }

  async refreshStatus() {
    try {
      const data = await api.getExtendedStatus()
      this.status.set(data)
      this.videoSlotReady.set({
        2: Boolean(data.camera2_available),
        3: Boolean(data.camera3_available),
        4: Boolean(data.camera4_available),
      })
      this.playbackPaused.set(data.playback_state === 'paused')
      if (data.loitering_threshold_seconds != null) {
        this.loiteringInput.set(String(Math.round(data.loitering_threshold_seconds)))
      }
      if (typeof data.show_trails === 'boolean') this.showTrails.set(data.show_trails)
      if (!this.showVideoSetup() && !this.uploading) this.viewCameraId.set(data.camera_id ?? 1)
      if (data.incident_focus) this.focus.set(data.incident_focus)
    } catch {
      /* ignore */
    }
  }

  async refreshTracks() {
    try {
      this.tracks.set(await api.getTrackSummaries())
    } catch {
      this.tracks.set([])
    }
  }

  async refreshFocus() {
    try {
      this.focus.set(await api.getFocusStatus())
    } catch {
      /* ignore */
    }
  }

  async refreshAlertsList() {
    try {
      const filter = this.alertsFilter()
      const data = await api.getAlerts(filter === 'all' ? undefined : { filter })
      this.alerts.set(data.alerts)
      this.alertsNewCount.set(data.new_count)
    } catch {
      /* ignore */
    }
  }

  private showZoneBanner(ev: ZoneEvent) {
    const loitering = ev.event_type === 'loitering'
    this.zoneBanner.set({
      title: ev.title || (loitering ? '⚠ LOITERING DETECTED' : '⚠ RESTRICTED AREA ENTRY'),
      track: `${ev.camera_id ? `CCTV ${String(ev.camera_id).padStart(2, '0')} · ` : ''}Track #${ev.track_id}${ev.zone_label ? ` — ${ev.zone_label}` : ''}`,
      detail: loitering ? `Restricted Area · Duration: ${Math.round(ev.duration_seconds ?? 15)} seconds` : undefined,
      time: `Time: ${ev.time_label || '--:--:--'}`,
      loitering,
    })
    if (this.zoneBannerTimer) window.clearTimeout(this.zoneBannerTimer)
    this.zoneBannerTimer = window.setTimeout(() => this.zoneBanner.set(null), 5000)
  }

  private async pollZoneEvents() {
    try {
      const events = await api.getZoneEvents()
      this.zoneEvents.set(events)
      const newOnes = events.filter((ev) => ev.event_id > this.lastEventId)
      if (newOnes.length === 0) return
      this.lastEventId = Math.max(this.lastEventId, ...newOnes.map((e) => e.event_id))
      this.showZoneBanner(newOnes[newOnes.length - 1]!)
      await Promise.all(
        newOnes.map((ev) =>
          api.autoFocusLock({
            track_id: ev.track_id,
            event_type: ev.event_type,
            zone_index: ev.zone_index ?? 0,
            camera_id: ev.camera_id,
          }),
        ),
      )
      await this.refreshFocus()
      await this.refreshAlertsList()
    } catch {
      /* ignore */
    }
  }

  private async handleDeepLink(rawCamera: string | null, focusAlertId: string | null) {
    if (!rawCamera && !focusAlertId) return
    const clearParams = () =>
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true })
    try {
      this.switching = true
      if (rawCamera) {
        const cameraId = Number(rawCamera)
        if (!Number.isInteger(cameraId) || cameraId < 1 || cameraId > 3) {
          clearParams()
          return
        }
        await api.switchCamera(cameraId)
        this.viewCameraId.set(cameraId)
      }
      if (focusAlertId) {
        const data = await api.focusFromAlert(focusAlertId)
        this.focus.set(data)
        if (data.camera_id) this.viewCameraId.set(data.camera_id)
        this.flash(
          data.live ? `Live focus on Track #${data.track_id ?? '—'}` : 'Showing recorded person from this incident',
          3500,
        )
      }
      await this.refreshStatus()
      await this.refreshFrame()
      await this.refreshFocus()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Focus unavailable')
    } finally {
      this.switching = false
      clearParams()
    }
  }

  // ------------------------------------------------------------------ view (zoom / pan)
  resetView() {
    this.zoomIndex.set(0)
    this.panX.set(0)
    this.panY.set(0)
  }

  zoomIn() {
    this.zoomIndex.update((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))
  }

  zoomOut() {
    const next = Math.max(this.zoomIndex() - 1, 0)
    if (next === 0) {
      this.panX.set(0)
      this.panY.set(0)
    }
    this.zoomIndex.set(next)
  }

  pan(dx: number, dy: number) {
    const zoom = this.zoom()
    if (zoom <= 1) return
    const x = this.panX()
    const y = this.panY()
    this.panX.set(this.clampPan(x + dx, y, zoom).x)
    this.panY.set(this.clampPan(x, y + dy, zoom).y)
  }

  onPanPointerDown(e: PointerEvent) {
    if (this.zoom() <= 1 || this.zoneEditMode()) return
    this.panDrag = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: this.panX(),
      originY: this.panY(),
    }
    this.panDragging.set(true)
    this.viewportEl?.setPointerCapture(e.pointerId)
  }

  onPanPointerMove(e: PointerEvent) {
    if (!this.panDrag.active || e.pointerId !== this.panDrag.pointerId) return
    const c = this.clampPan(
      this.panDrag.originX + (e.clientX - this.panDrag.startX),
      this.panDrag.originY + (e.clientY - this.panDrag.startY),
      this.zoom(),
    )
    this.panX.set(c.x)
    this.panY.set(c.y)
  }

  onPanPointerUp(e: PointerEvent) {
    if (e.pointerId !== this.panDrag.pointerId) return
    this.panDrag.active = false
    this.panDragging.set(false)
    this.viewportEl?.releasePointerCapture(e.pointerId)
  }

  // ------------------------------------------------------------------ cameras
  private async switchTo(cameraId: number) {
    this.switching = true
    try {
      if (this.zoneEditMode()) await this.cancelZoneEditInternal()
      await api.switchCamera(cameraId)
      this.viewCameraId.set(cameraId)
      this.videoReplaceMode.set(false)
      await this.refreshStatus()
      await this.refreshFrame()
      await this.refreshFocus()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Switch failed')
    } finally {
      this.switching = false
    }
  }

  async navigateCamera(direction: 'prev' | 'next') {
    if (this.switching) return
    const next = adjacentCameraId(this.viewCameraId(), direction)
    if (isVideoSlot(next) && !this.videoSlotReady()[next]) {
      this.videoReplaceMode.set(false)
      this.viewCameraId.set(next)
      return
    }
    await this.switchTo(next)
  }

  async navigateToCamera(cameraId: number) {
    if (cameraId === this.viewCameraId() && !this.showVideoSetup()) return
    if (this.switching) return
    if (isVideoSlot(cameraId) && !this.videoSlotReady()[cameraId]) {
      this.videoReplaceMode.set(false)
      this.viewCameraId.set(cameraId)
      return
    }
    await this.switchTo(cameraId)
  }

  // ------------------------------------------------------------------ zones
  private async cancelZoneEditInternal() {
    if (this.zoneSnapshot) {
      try {
        await api.setZones(this.zoneSnapshot, true)
      } catch {
        /* ignore */
      }
    }
    this.editZones.set([])
    this.zoneEditMode.set(false)
    this.zoneSnapshot = null
    await api.setZoneEditing(false)
  }

  async startZoneEdit() {
    try {
      const data = await api.getZone()
      const zones = data.restricted_zones?.length
        ? [...data.restricted_zones]
        : data.restricted_zone
          ? [{ ...data.restricted_zone }]
          : []
      this.zoneSnapshot = JSON.parse(JSON.stringify(zones)) as ZoneRect[]
      this.editZones.set(zones)
      this.zoneEditMode.set(true)
      await api.setZoneEditing(true)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Zone edit failed')
    }
  }

  async saveZoneEdit() {
    const zones = this.editZones()
    if (zones.length === 0) {
      this.flash('Add at least one zone (drag on empty area)', 2500)
      return
    }
    try {
      await api.setZones(zones, true)
      this.zoneEditMode.set(false)
      this.zoneSnapshot = null
      await api.setZoneEditing(false)
      await this.refreshStatus()
      this.flash(`Saved ${zones.length} zone(s)`, 2500)
      this.editZones.set([])
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async cancelZoneEdit() {
    await this.cancelZoneEditInternal()
    await this.refreshStatus()
  }

  async clearZones() {
    if (!window.confirm('Clear all restricted zones for this camera?')) return
    try {
      await api.clearZones()
      this.editZones.set([])
      if (this.zoneEditMode()) await this.cancelZoneEditInternal()
      await this.refreshStatus()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Clear failed')
    }
  }

  private canvasPoint(e: PointerEvent) {
    const rect = this.canvasEl!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  onZonePointerDown(e: PointerEvent) {
    if (!this.zoneEditMode()) return
    const pt = this.canvasPoint(e)
    const layout = this.layout()
    const zones = this.editZones()
    const hit = hitTestZoneEdit(pt.x, pt.y, zones, layout, this.zoom(), this.panX(), this.panY())
    const startNorm = viewportPointToNormalized(pt.x, pt.y, layout, this.zoom(), this.panX(), this.panY())
    this.zoneDrag = {
      mode: hit.mode,
      index: hit.index,
      startNorm,
      origin: hit.index >= 0 ? { ...zones[hit.index]! } : null,
      draft: null,
    }
    if (hit.mode === 'draw' && zones.length >= MAX_ZONES) {
      this.flash(`Maximum ${MAX_ZONES} zones`, 2000)
      this.zoneDrag.mode = null
      return
    }
    this.canvasEl?.setPointerCapture(e.pointerId)
  }

  onZonePointerMove(e: PointerEvent) {
    const drag = this.zoneDrag
    if (!this.zoneEditMode() || !drag.mode) return
    const pt = this.canvasPoint(e)
    const cur = viewportPointToNormalized(pt.x, pt.y, this.layout(), this.zoom(), this.panX(), this.panY())
    if (drag.mode === 'draw' && drag.startNorm) {
      drag.draft = normRectFromPoints(drag.startNorm, cur)
      this.drawCanvas()
      return
    }
    if (drag.index < 0 || !drag.origin || !drag.startNorm) return
    const origin = drag.origin
    if (drag.mode === 'move') {
      const dx = cur.x - drag.startNorm.x
      const dy = cur.y - drag.startNorm.y
      this.editZones.update((zones) => {
        const next = [...zones]
        next[drag.index] = clampNormZone({
          x: origin.x + dx,
          y: origin.y + dy,
          width: origin.width,
          height: origin.height,
        })
        return next
      })
    } else if (drag.mode.startsWith('resize-')) {
      const handle = drag.mode.replace('resize-', '')
      this.editZones.update((zones) => {
        const next = [...zones]
        next[drag.index] = applyZoneResize(origin, handle, cur)
        return next
      })
    }
    this.drawCanvas()
  }

  async onZonePointerUp(e: PointerEvent) {
    const drag = this.zoneDrag
    if (!drag.mode) return
    if (drag.mode === 'draw' && drag.draft) {
      const added = clampNormZone(drag.draft)
      const before = this.editZones()
      this.editZones.set([...before, added])
      try {
        await api.setZones([...before, added], true)
      } catch {
        /* ignore */
      }
    }
    this.zoneDrag = { mode: null, index: -1, startNorm: null, origin: null, draft: null }
    this.canvasEl?.releasePointerCapture(e.pointerId)
    this.drawCanvas()
  }

  // ------------------------------------------------------------------ actions
  async takeSnapshot() {
    this.flash('Saving…', 10000)
    try {
      const zoom = this.zoom()
      const panX = this.panX()
      const panY = this.panY()
      const adjusted = zoom > 1 || panX !== 0 || panY !== 0
      if (adjusted && this.videoEl && this.viewportEl) {
        const img = this.videoEl
        const vp = this.viewportEl
        const canvas = document.createElement('canvas')
        canvas.width = vp.clientWidth
        canvas.height = vp.clientHeight
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const layout = getVideoLayout(vp.clientWidth, vp.clientHeight, img.naturalWidth, img.naturalHeight)
        ctx.save()
        ctx.translate(vp.clientWidth / 2 + panX, vp.clientHeight / 2 + panY)
        ctx.scale(zoom, zoom)
        ctx.translate(-vp.clientWidth / 2, -vp.clientHeight / 2)
        ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh)
        ctx.restore()
        const blob = await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error('fail'))), 'image/jpeg', 0.92),
        )
        const result = await api.takeSnapshot(blob)
        this.flash(`Saved ${result.filename}`, 4000)
      } else {
        const result = await api.takeSnapshot()
        this.flash(`Saved ${result.filename}`, 4000)
      }
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Snapshot failed', 4000)
    }
  }

  async toggleRecording() {
    try {
      if (this.isRecording()) {
        const result = await api.stopRecording()
        this.flash(result.filename ? `Recording saved: ${result.filename}` : 'Recording stopped', 4000)
      } else {
        await api.startRecording()
        this.flash('Recording started', 2500)
      }
      await this.refreshStatus()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Recording failed', 4000)
    }
  }

  toggleFullscreen() {
    const el = this.cameraEl
    if (!el) return
    if (!document.fullscreenElement) void el.requestFullscreen?.()
    else void document.exitFullscreen?.()
  }

  async toggleLoop() {
    try {
      if (this.playbackPaused()) {
        await api.resumeVideo()
        await this.refreshFrame()
      } else {
        await api.pauseVideo()
      }
      await this.refreshStatus()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Playback error')
    }
  }

  async followTrack(trackId: number) {
    try {
      this.focus.set(await api.followTrack(trackId))
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Follow failed')
    }
  }

  async focusFromAlert(alertId: string) {
    try {
      const data = await api.focusFromAlert(alertId)
      this.focus.set(data)
      if (data.camera_id) this.viewCameraId.set(data.camera_id)
      await this.refreshStatus()
      await this.refreshFrame()
      this.flash(
        data.live ? `Live focus on Track #${data.track_id ?? '—'}` : 'Showing recorded person from this incident',
        3500,
      )
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Focus failed')
    }
  }

  async releaseFocus(slot?: string) {
    try {
      await api.releaseFocus(slot)
      await this.refreshFocus()
    } catch {
      /* ignore */
    }
  }

  async applyLoitering() {
    const v = Number(this.loiteringInput())
    if (!Number.isInteger(v) || v < LOITERING_MIN || v > LOITERING_MAX) {
      this.loiteringMsg.set(`Threshold must be ${LOITERING_MIN}–${LOITERING_MAX} seconds`)
      this.loiteringOk.set(false)
      return
    }
    try {
      const r = await api.updateLoiteringThreshold(v)
      this.loiteringInput.set(String(r.loitering_threshold_seconds))
      this.loiteringMsg.set(`Threshold set to ${r.loitering_threshold_seconds}s`)
      this.loiteringOk.set(true)
      window.setTimeout(() => this.loiteringMsg.set(''), 2500)
      await this.refreshTracks()
    } catch (err) {
      this.loiteringMsg.set(err instanceof Error ? err.message : 'Apply failed')
      this.loiteringOk.set(false)
    }
  }

  async setShowTrails(enabled: boolean) {
    this.showTrails.set(enabled)
    try {
      await api.setTrails(enabled)
    } catch {
      this.showTrails.set(!enabled)
    }
  }

  async uploadFile(file: File) {
    const current = this.viewCameraId()
    const targetId: VideoSlotId = isVideoSlot(current) ? current : 2
    this.uploading = true
    this.uploadLabel.set(`${file.name} — uploading…`)
    try {
      await api.uploadVideo(file, targetId)
      this.uploadLabel.set(`${file.name} — starting playback…`)
      await api.switchCamera(targetId)
      this.videoReplaceMode.set(false)
      this.viewCameraId.set(targetId)
      await this.refreshStatus()
      await this.refreshFrame()
      this.uploadLabel.set(file.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      this.uploadLabel.set(msg)
      this.flash(msg)
    } finally {
      this.uploading = false
    }
  }

  async deleteVideoSlot() {
    const slot = this.viewCameraId()
    if (!isVideoSlot(slot)) return
    if (!window.confirm(`Delete CCTV 0${slot} recording?`)) return
    try {
      await api.deleteCamera(slot)
      this.videoSlotReady.update((prev) => ({ ...prev, [slot]: false }))
      this.uploadLabel.set('No recording loaded')
      this.videoReplaceMode.set(false)
      this.viewCameraId.set(1)
      await api.switchCamera(1)
      await this.refreshStatus()
      await this.refreshFrame()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  closeVideoSetup() {
    this.videoReplaceMode.set(false)
    this.viewCameraId.set(1)
  }

  openVideoReplace() {
    if (!isVideoSlot(this.viewCameraId())) return
    this.videoReplaceMode.set(true)
  }

  async openAlert(id: string) {
    try {
      this.selectedAlert.set(await api.getAlert(id))
    } catch {
      /* ignore */
    }
  }

  closeAlert() {
    this.selectedAlert.set(null)
  }

  async updateAlertStatus(id: string, st: string) {
    try {
      this.selectedAlert.set(await api.updateAlertStatus(id, st))
      await this.refreshAlertsList()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Update failed')
    }
  }
}
