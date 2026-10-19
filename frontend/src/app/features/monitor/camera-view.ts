import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core'
import { isVideoSlot, MONITOR_CAMERA_ORDER, type VideoSlotId } from '../../shared/types/monitor'
import type { TrackSummary } from '../../shared/types/monitor'
import { formatDuration, formatMmSs } from '../../shared/utils/monitorFormat'
import { MonitorService } from './monitor.service'
import { Router } from '@angular/router'
import { SubscriptionService } from '../../core/subscription.service'
import { VideoUploadControlComponent } from './side-panels'

function monitorCameraLabel(viewCameraId: number, showVideoSetup: boolean, cameraLabel: string | null | undefined): string {
  if (showVideoSetup && isVideoSlot(viewCameraId)) return `CCTV 0${viewCameraId} — Load Recording`
  if (cameraLabel) return cameraLabel
  if (viewCameraId === 1) return 'CCTV 01 — Laptop Camera'
  return `CCTV 0${viewCameraId}`
}

@Component({
  selector: 'app-camera-view',
  imports: [VideoUploadControlComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <section class="camera-shell">
      @if (onVideoSlot() && videoReady() && !m.showVideoSetup()) {
        <div class="cam2-admin-bar">
          <span class="muted">
            {{ m.status()?.video_filename ? 'CCTV 0' + m.viewCameraId() + ' — ' + m.status()?.video_filename : 'CCTV 0' + m.viewCameraId() + ' — Recording' }}
          </span>
          <button type="button" class="source-btn" (click)="m.openVideoReplace()">Replace Video</button>
          <button type="button" class="source-btn danger" (click)="m.deleteVideoSlot()">Delete Recording</button>
        </div>
      }

      <p class="panel-label">FULL CCTV VIEW</p>

      <div class="monitor-camera-strip" role="tablist" aria-label="CCTV channels">
        @for (id of cameraOrder; track id) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="m.viewCameraId() === id"
            [class]="'monitor-cam-pill' + (m.viewCameraId() === id ? ' active' : '') + (slotReady(id) ? '' : ' empty')"
            (click)="m.navigateToCamera(id)"
          >
            CCTV 0{{ id }}
            @if (!slotReady(id)) {
              <span class="monitor-cam-pill-hint">No video</span>
            }
          </button>
        }
      </div>

      <div [class]="'camera-view' + (overlayVisible() ? '' : ' overlay-hidden')" #cameraBox>
        @if (showHudDecor()) {
          <div class="camera-hud-frame" aria-hidden="true">
            <span class="hud-corner tl"></span>
            <span class="hud-corner tr"></span>
            <span class="hud-corner bl"></span>
            <span class="hud-corner br"></span>
            <div class="hud-scanline"></div>
            @if (online()) {
              <div class="hud-sweep"></div>
            }
          </div>
        }

        <div
          #viewport
          [class]="'camera-video-layer' + (m.zoom() > 1 && !m.zoneEditMode() ? ' pan-enabled' : '') + (m.panDragging() ? ' pan-dragging' : '')"
          (pointerdown)="m.onPanPointerDown($event)"
          (pointermove)="m.onPanPointerMove($event)"
          (pointerup)="m.onPanPointerUp($event)"
          (pointercancel)="m.onPanPointerUp($event)"
        >
          <div class="video-stage" [style.transform]="'translate(' + m.panX() + 'px, ' + m.panY() + 'px) scale(' + m.zoom() + ')'">
            @if (m.hasFrame()) {
              <img #videoImg alt="CCTV feed" />
            } @else {
              <div class="camera-connecting">
                <div class="connecting-ring"></div>
                <span>SIGNAL ACQUIRING</span>
              </div>
            }
          </div>
        </div>

        @if (m.zoneEditMode()) {
          <canvas
            #zoneCanvas
            class="zone-edit-canvas"
            (pointerdown)="m.onZonePointerDown($event)"
            (pointermove)="m.onZonePointerMove($event)"
            (pointerup)="m.onZonePointerUp($event)"
            (pointercancel)="m.onZonePointerUp($event)"
          ></canvas>
        }

        @if (m.showVideoSetup() && onVideoSlot()) {
          <div class="cam2-setup">
            <div class="cam2-setup-inner">
              <p class="cam2-setup-eyebrow">CCTV 0{{ m.viewCameraId() }}</p>
              <h3 class="cam2-setup-title">{{ m.videoReplaceMode() ? 'Replace Recording' : 'Load Recording' }}</h3>
              <p class="cam2-setup-desc">Upload MP4, AVI, or MOV (H.264 recommended). Max 100 MB.</p>
              <app-video-upload-control variant="panel" label="Upload Video" />
              <p class="muted cam2-upload-status">{{ m.uploadLabel() }}</p>
              <button type="button" class="source-btn cam2-setup-back" (click)="m.closeVideoSetup()">Back to CCTV 01</button>
            </div>
          </div>
        }

        @if (m.zoneEditMode()) {
          <div class="zone-edit-bar">
            <span class="muted" style="font-size: 0.62rem">Drag to add · move · resize corners</span>
            <button type="button" class="source-btn primary" (click)="m.saveZoneEdit()">Save Zones</button>
            <button type="button" class="source-btn" (click)="m.cancelZoneEdit()">Cancel</button>
          </div>
        }

        @if (!m.showVideoSetup()) {
          <div [class]="'camera-ui-grid' + (overlayVisible() ? '' : ' is-hidden')">
            <header class="cam-ui-header">
              <div class="cam-nav">
                <button type="button" class="cam-nav-btn" (click)="m.navigateCamera('prev')" aria-label="Previous camera">
                  <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
                </button>
                <div class="cam-name">{{ camLabel() }}</div>
                <button type="button" class="cam-nav-btn" (click)="m.navigateCamera('next')" aria-label="Next camera">
                  <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
                </button>
              </div>
              <div class="cam-header-right">
                <span [class]="'live-badge ' + (online() ? 'online' : 'offline')">
                  @if (online()) {
                    <span class="rec-dot" aria-hidden="true"></span>
                  }
                  <span [class]="'dot ' + (online() ? 'online' : 'offline')"></span>
                  {{ online() ? 'LIVE' : 'OFFLINE' }}
                </span>
                <time class="cam-clock">{{ m.clock() }}</time>
                <div class="cam-controls">
                  <button type="button" [class]="'ctrl-btn trail-toggle-btn' + (m.showTrails() ? ' trail-on' : '')"
                    [attr.title]="m.showTrails() ? 'Hide track trails' : 'Show track trails'" [attr.aria-pressed]="m.showTrails()"
                    (click)="m.setShowTrails(!m.showTrails())">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 17c2.8-3.2 5.8-4.5 8-4.5s5.2 1.3 8 4.5" />
                      <circle cx="12" cy="10.5" r="1.75" />
                    </svg>
                  </button>
                  <button type="button" [class]="'ctrl-btn hud-toggle' + (overlayVisible() ? ' hud-on' : '')"
                    [attr.title]="overlayVisible() ? 'Hide HUD (H)' : 'Show HUD (H)'" [attr.aria-pressed]="overlayVisible()"
                    (click)="toggleOverlay()">
                    @if (overlayVisible()) {
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="eyeIcon" /></svg>
                    } @else {
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="eyeOffIcon" /></svg>
                    }
                  </button>
                  <button type="button" [class]="'ctrl-btn' + (m.zoneEditMode() ? ' active-edit' : '')" title="Edit zone" (click)="m.startZoneEdit()">
                    <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                  </button>
                  @if (isVideo()) {
                    <button type="button" class="ctrl-btn" title="Pause/resume" (click)="m.toggleLoop()">
                      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  }
                  @if (canRecord() || m.isRecording()) {
                    <button type="button" [class]="'ctrl-btn record-toggle' + (m.isRecording() ? ' recording-on' : '')"
                      [attr.title]="m.isRecording() ? 'Stop recording (' + floor(m.recordingDuration()) + 's)' : 'Record'"
                      [attr.aria-pressed]="m.isRecording()" (click)="m.toggleRecording()">
                      @if (m.isRecording()) {
                        <span class="rec-dot" aria-hidden="true"></span>
                      } @else {
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>
                      }
                    </button>
                  } @else {
                    <button type="button" class="ctrl-btn" style="opacity: 0.55"
                      title="Recording needs a paid plan. Click to see plans." aria-label="Recording locked on the Free plan" (click)="upgradeForRecording()">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9z" /></svg>
                    </button>
                  }
                  <button type="button" class="ctrl-btn" title="Snapshot" (click)="m.takeSnapshot()">
                    <svg viewBox="0 0 24 24"><path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" /></svg>
                  </button>
                  <button type="button" class="ctrl-btn" title="Fullscreen" (click)="m.toggleFullscreen()">
                    <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
                  </button>
                  <button type="button" class="ctrl-btn" title="Reset view" (click)="m.resetView()">
                    <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v3l5-5-5-5v3z" /></svg>
                  </button>
                </div>
              </div>
            </header>

            <aside class="cam-ui-sidebar glass-panel tracking-panel">
              <div class="tracking-panel-scroll">
                <div class="tracking-panel-header">
                  <p class="tracking-panel-title">TRACKING</p>
                  <span class="track-count-badge">{{ m.tracks().length }}</span>
                </div>
                <ul class="tracking-list">
                  @for (t of m.tracks(); track m.viewCameraId() + '-' + t.track_id) {
                    <li [class]="'tracking-row' + (t.loitering_detected ? ' loitering' : t.in_zone ? ' in-zone' : '')">
                      <div class="tracking-row-info">
                        <span class="track-id">#{{ t.track_id }}</span>
                        <div class="tracking-row-meta">
                          @if (t.identity_matched && t.watchlist_name) {
                            <span class="track-identity track-identity-match">WATCHLIST · {{ t.watchlist_name }}</span>
                          } @else {
                            <span class="track-identity track-identity-unknown">UNKNOWN</span>
                          }
                          <span class="track-status">{{ trackStatus(t) }}</span>
                          <span class="track-duration">{{ duration(t.visible_duration) }}</span>
                        </div>
                      </div>
                      <button type="button" class="track-follow-btn" (click)="m.followTrack(t.track_id)">Follow</button>
                    </li>
                  } @empty {
                    <li class="tracking-empty">No active tracks</li>
                  }
                </ul>
                @if (recentEvents().length > 0) {
                  <ul class="event-feed">
                    @for (ev of recentEvents(); track ev.event_id) {
                      <li class="event-feed-item">
                        <span class="event-feed-time">{{ ev.time_label }} </span>
                        <span [class]="'event-feed-type' + (ev.event_type === 'loitering' ? ' loitering' : '')">
                          {{ ev.event_type === 'loitering' ? 'Loitering' : 'Restricted Entry' }}
                        </span>
                        · Track #{{ ev.track_id }}
                      </li>
                    }
                  </ul>
                }
                <div class="zone-status-row">
                  <span class="muted">Restricted Zone:</span>
                  <span>{{ m.status()?.restricted_zone_label || 'Not Set' }}</span>
                </div>
                @if (hasZones()) {
                  <button type="button" class="source-btn danger" style="width: 100%; margin-top: 0.45rem" (click)="m.clearZones()">Clear Zone</button>
                }
              </div>
              <div class="tracking-panel-footer">
                <label class="trail-toggle">
                  <input type="checkbox" [checked]="m.showTrails()" (change)="m.setShowTrails($any($event.target).checked)" />
                  Show Track Trails
                </label>
                <div class="loitering-threshold-row">
                  <span class="loitering-label">Loitering Threshold</span>
                  <div class="loitering-input-row">
                    <input type="number" min="5" max="300" [value]="m.loiteringInput()" (input)="m.loiteringInput.set($any($event.target).value)" />
                    <span class="muted">sec</span>
                    <button type="button" class="source-btn" (click)="m.applyLoitering()">Apply</button>
                  </div>
                  @if (m.loiteringMsg()) {
                    <p class="muted" [style.color]="m.loiteringOk() ? 'var(--m-accent)' : '#ff9090'" style="margin-top: 0.25rem">{{ m.loiteringMsg() }}</p>
                  }
                </div>
              </div>
            </aside>

            <div class="cam-ui-info glass-panel info-panel">
              <p class="info-panel-title">{{ m.viewCameraId() === 1 ? 'CAM 01 · LIVE' : 'CAM 0' + m.viewCameraId() + ' · FEED' }}</p>
              <div class="info-stats">
                <div class="info-stat">
                  <span class="info-stat-label">Status</span>
                  <span [class]="'info-stat-value' + (online() ? ' accent' : '')">{{ online() ? '● Online' : '○ Offline' }}</span>
                </div>
                <div class="info-stat">
                  <span class="info-stat-label">FPS</span>
                  <span class="info-stat-value cyan">{{ fpsLabel() }}</span>
                </div>
                <div class="info-stat">
                  <span class="info-stat-label">Resolution</span>
                  <span class="info-stat-value">{{ m.status()?.resolution || '—' }}</span>
                </div>
                <div class="info-stat">
                  <span class="info-stat-label">People</span>
                  <span class="info-stat-value warn">{{ m.status()?.people_count ?? 0 }}</span>
                </div>
                @if (m.viewCameraId() === 4) {
                  <div class="info-stat">
                    <span class="info-stat-label">Vehicles</span>
                    <span class="info-stat-value cyan">{{ m.status()?.vehicle_count ?? 0 }}</span>
                  </div>
                }
              </div>
            </div>

            @if (m.zoneBanner(); as banner) {
              <div [class]="'cam-ui-alert zone-event-banner' + (banner.loitering ? ' loitering' : '')">
                <span class="zone-event-icon" aria-hidden="true">{{ banner.loitering ? '◈' : '⚠' }}</span>
                <p class="zone-event-title">{{ banner.title }}</p>
                <p>{{ banner.track }}</p>
                @if (banner.detail) {
                  <p class="muted">{{ banner.detail }}</p>
                }
                <p class="muted">{{ banner.time }}</p>
              </div>
            }

            <div class="cam-ui-controls">
              <div class="zoom-bar">
                <button type="button" class="ctrl-btn small" [disabled]="m.zoomIndex() === 0" (click)="m.zoomOut()">−</button>
                <span class="zoom-label">{{ zoomLabel() }}×</span>
                <button type="button" class="ctrl-btn small" [disabled]="m.zoomIndex() >= 3" (click)="m.zoomIn()">+</button>
              </div>
              <div class="pan-pad">
                <button type="button" class="pan-btn" [disabled]="m.zoom() <= 1" (click)="m.pan(0, 36)">▲</button>
                <div class="pan-row">
                  <button type="button" class="pan-btn" [disabled]="m.zoom() <= 1" (click)="m.pan(36, 0)">◀</button>
                  <span class="pan-center"></span>
                  <button type="button" class="pan-btn" [disabled]="m.zoom() <= 1" (click)="m.pan(-36, 0)">▶</button>
                </div>
                <button type="button" class="pan-btn" [disabled]="m.zoom() <= 1" (click)="m.pan(0, -36)">▼</button>
              </div>
            </div>
          </div>

          @if (!overlayVisible()) {
            <button type="button" class="overlay-restore-btn" (click)="toggleOverlay()" title="Show HUD (H)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="eyeIcon" /></svg>
              <span>Show HUD</span>
              <kbd>H</kbd>
            </button>
          }

          @if (!overlayVisible() && m.zoneBanner(); as banner) {
            <div [class]="'zone-event-banner zone-event-banner-minimal' + (banner.loitering ? ' loitering' : '')">
              <p class="zone-event-title">{{ banner.title }}</p>
              <p>{{ banner.track }}</p>
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class CameraViewComponent {
  protected readonly m = inject(MonitorService)
  private readonly subs = inject(SubscriptionService)
  private readonly router = inject(Router)
  protected readonly canRecord = computed(() => this.subs.current()?.recording !== false)

  protected upgradeForRecording() {
    this.m.flash('Recording is on the Professional and Enterprise plans.', 3500)
    void this.router.navigate(['/subscription'], { queryParams: { upgrade: 'recording' } })
  }
  protected readonly cameraOrder = MONITOR_CAMERA_ORDER
  protected readonly overlayVisible = signal(true)
  protected readonly floor = Math.floor
  protected readonly duration = formatDuration
  protected readonly eyeIcon =
    'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
  protected readonly eyeOffIcon =
    'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'

  private readonly videoImg = viewChild<ElementRef<HTMLImageElement>>('videoImg')
  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport')
  private readonly cameraBox = viewChild<ElementRef<HTMLDivElement>>('cameraBox')
  private readonly zoneCanvas = viewChild<ElementRef<HTMLCanvasElement>>('zoneCanvas')

  protected readonly online = computed(() => Boolean(this.m.status()?.camera_active))
  protected readonly isVideo = computed(() => this.m.status()?.source_type === 'video')
  protected readonly onVideoSlot = computed(() => isVideoSlot(this.m.viewCameraId()))
  protected readonly videoReady = computed(
    () => this.onVideoSlot() && this.m.videoSlotReady()[this.m.viewCameraId() as VideoSlotId],
  )
  protected readonly camLabel = computed(() =>
    monitorCameraLabel(this.m.viewCameraId(), this.m.showVideoSetup(), this.m.status()?.camera_label),
  )
  protected readonly hasZones = computed(
    () => Boolean(this.m.status()?.restricted_zone_active) || (this.m.status()?.restricted_zones?.length ?? 0) > 0,
  )
  protected readonly showHudDecor = computed(() => !this.m.showVideoSetup() && this.overlayVisible())
  protected readonly recentEvents = computed(() => [...this.m.zoneEvents()].slice(-6).reverse())
  protected readonly fpsLabel = computed(() => {
    const s = this.m.status()
    return Number(s?.fps ?? 0).toFixed(1) + (this.isVideo() && s?.source_fps ? ` / ${s.source_fps}` : '')
  })
  protected readonly zoomLabel = computed(() => {
    const z = this.m.zoom()
    return z.toFixed(z % 1 === 0 ? 1 : 2)
  })

  constructor() {
    effect(() => {
      this.m.videoEl = this.videoImg()?.nativeElement ?? null
      this.m.viewportEl = this.viewport()?.nativeElement ?? null
      this.m.cameraEl = this.cameraBox()?.nativeElement ?? null
      this.m.canvasEl = this.zoneCanvas()?.nativeElement ?? null
    })
    effect(() => {
      this.zoneCanvas()
      this.m.editZones()
      this.m.zoneEditMode()
      this.m.zoom()
      this.m.panX()
      this.m.panY()
      this.m.frameGen()
      this.m.drawCanvas()
    })
    effect(() => {
      if (this.m.zoneEditMode()) this.overlayVisible.set(true)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'H') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      this.overlayVisible.update((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey))
  }

  protected toggleOverlay() {
    this.overlayVisible.update((v) => !v)
  }

  protected slotReady(id: number): boolean {
    return !isVideoSlot(id) || this.m.videoSlotReady()[id]
  }

  protected trackStatus(t: TrackSummary): string {
    const loitering = Boolean(t.loitering_detected)
    const inZone = Boolean(t.in_zone)
    const threshold = t.loitering_threshold_seconds ?? Number(this.m.loiteringInput())
    const inside = t.inside_zone_duration ?? 0
    if (loitering) return `Loitering (${formatDuration(inside)})`
    if (inZone) return `Inside ${formatMmSs(inside)} / ${formatMmSs(threshold)}`
    return t.status || 'Visible'
  }
}
