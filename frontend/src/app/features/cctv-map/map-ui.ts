import { ChangeDetectionStrategy, Component, computed, input, output, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { CCTV_MAP_VIEWBOX, MAP_AREAS, MAP_ZONES, SIDEBAR_AREAS } from '../../shared/data/cctvMapLayout'
import type { Alert, CameraChannel } from '../../shared/types'
import type { MapArea, MapAreaIconKind } from '../../shared/types/cctvMap'
import { IconComponent } from '../../shared/ui/icon'
import { cameraBadgeLabel, feedStatusLabel, feedStatusTone } from '../../shared/utils/cameraLabels'
import { getAlertsForCamera, getAreaAlertCount, isActiveAlert } from '../../shared/utils/cctvMapAlerts'
import { rotateSitePoint } from '../../shared/utils/isoMapGeometry'
import { MapTwinSceneComponent } from './map-scene'

@Component({
  selector: 'app-map-area-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @switch (kind()) {
      @case ('building') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" [attr.class]="cn()" aria-hidden="true">
          <rect x="4" y="8" width="16" height="12" rx="1" />
          <path d="M8 20V12h3v8M13 20v-5h3v5" />
          <path d="M3 20h18" />
          <path d="M12 3l7 5H5l7-5z" />
        </svg>
      }
      @case ('parking') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" [attr.class]="cn()" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 8h3.5a2.5 2.5 0 010 5H10V8z" />
          <path d="M10 13v3" />
        </svg>
      }
      @case ('road') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" [attr.class]="cn()" aria-hidden="true">
          <path d="M5 17h14" />
          <path d="M6.5 17l1.4-4.5h8.2l1.4 4.5" />
          <path d="M8.5 12.5L10 8h4l1.5 4.5" />
          <circle cx="8" cy="17" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="16" cy="17" r="1.35" fill="currentColor" stroke="none" />
        </svg>
      }
      @case ('perimeter') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" [attr.class]="cn()" aria-hidden="true">
          <path d="M12 3l8 4v6c0 5-3.5 8-8 8s-8-3-8-8V7l8-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      }
      @case ('remote') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" [attr.class]="cn()" aria-hidden="true">
          <path d="M4 8.5A11 11 0 0112 5a11 11 0 018 3.5" />
          <path d="M7 12a5 5 0 018 0" />
          <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 4l16 16" stroke="#f87171" stroke-width="2" />
        </svg>
      }
    }
  `,
})
export class MapAreaIconComponent {
  readonly kind = input.required<MapAreaIconKind>()
  readonly extraClass = input('')
  protected readonly cn = computed(() => `cctv-area-icon-svg ${this.extraClass()}`.trim())
}

@Component({
  selector: 'app-map-command-bar',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <header class="cctv-map-command">
      <div class="cctv-map-command-left">
        <div class="cctv-map-command-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </div>
        <div>
          <h1 class="cctv-map-command-title">Digital Twin</h1>
          <p class="cctv-map-command-sub">Facility map · click a pin to inspect coverage</p>
        </div>
      </div>

      <div class="cctv-map-command-stats">
        <span class="cctv-map-chip cctv-map-chip--live"><span class="cctv-map-chip-dot"></span>{{ liveCount() }}/{{ totalFeeds() }} online</span>
        <span [class]="'cctv-map-chip ' + (activeIncidents() > 0 ? 'cctv-map-chip--alert' : 'cctv-map-chip--clear')">
          {{ activeIncidents() > 0 ? activeIncidents() + ' incident' + (activeIncidents() === 1 ? '' : 's') : 'All zones secure' }}
        </span>
      </div>

      <div class="cctv-map-command-actions">
        <a routerLink="/monitoring" class="cctv-map-action-btn">Live Monitoring</a>
        <a routerLink="/incidents" class="cctv-map-action-btn cctv-map-action-btn--ghost">Incidents</a>
      </div>
    </header>
  `,
})
export class MapCommandBarComponent {
  readonly liveCount = input.required<number>()
  readonly totalFeeds = input(5)
  readonly activeIncidents = input.required<number>()
}

@Component({
  selector: 'app-map-location-panel',
  imports: [RouterLink, MapAreaIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <aside class="cctv-map-locations" aria-label="Site locations">
      <div class="cctv-map-locations-header">
        <p class="cctv-map-locations-title">Site Overview</p>
        @if (activeCount() > 0) {
          <span class="cctv-map-locations-alert-pill">{{ activeCount() }} active</span>
        } @else {
          <span class="cctv-map-locations-clear-pill">All clear</span>
        }
      </div>

      <nav class="cctv-map-tree">
        @for (row of rows(); track row.area.id) {
          <div class="cctv-map-tree-group">
            <button type="button" [class]="row.cls" [style.--area-accent]="row.area.cardColor" (click)="selectArea.emit(row.area.id); selectCamera.emit(row.area.cameraId)">
              <span class="cctv-map-tree-area-icon" [style.background]="row.area.cardColor">
                <app-map-area-icon [kind]="row.area.icon" />
              </span>
              <span class="cctv-map-tree-area-text">
                <span class="cctv-map-tree-area-label">{{ row.area.label }}</span>
                <span class="cctv-map-tree-area-sub">{{ row.badge }}{{ row.area.subtitle ? ' · ' + row.area.subtitle : '' }}</span>
              </span>
              @if (row.cameraDown) {
                <span class="cctv-map-tree-down-badge">Down</span>
              } @else if (row.areaAlerts > 0 || row.camAlerts > 0) {
                <span class="cctv-map-tree-alert-badge">{{ row.areaAlerts || row.camAlerts }}</span>
              } @else {
                <span class="cctv-map-tree-cam-count">{{ row.isLive ? 'Live' : 'Offline' }}</span>
              }
            </button>
          </div>
        }
      </nav>

      <div class="cctv-map-locations-footer">
        <a routerLink="/incidents" class="cctv-map-locations-link">View all incidents →</a>
      </div>
    </aside>
  `,
})
export class MapLocationPanelComponent {
  readonly alerts = input.required<Alert[]>()
  readonly cameras = input.required<CameraChannel[]>()
  readonly selectedAreaId = input<string | null>(null)
  readonly selectedCameraId = input<number | null>(null)
  readonly selectArea = output<string>()
  readonly selectCamera = output<number>()

  protected readonly activeCount = computed(() => this.alerts().filter(isActiveAlert).length)
  protected readonly rows = computed(() => {
    const alerts = this.alerts()
    const cameras = this.cameras()
    return SIDEBAR_AREAS.map((area) => {
      const cam = cameras.find((c) => c.id === area.cameraId)
      const isSearching = cam?.type === 'searching' || cam?.status === 'searching'
      const cameraDown = isSearching || Boolean(area.downMessage)
      const areaAlerts = getAreaAlertCount(alerts, area.id, area.cameraId)
      const camAlerts = getAlertsForCamera(alerts, area.cameraId).length
      const selected = this.selectedAreaId() === area.id || this.selectedCameraId() === area.cameraId
      const isLive = Boolean(cam?.available && !cameraDown && (cam.status === 'online' || cam.status === 'playback'))
      const cls = `cctv-map-tree-area ${selected ? 'is-expanded is-selected' : ''} ${
        cameraDown ? 'has-down' : areaAlerts > 0 || camAlerts > 0 ? 'has-alert' : ''
      }`
      return { area, cameraDown, areaAlerts, camAlerts, isLive, cls, badge: cameraBadgeLabel(area.cameraId) }
    })
  })
}

@Component({
  selector: 'app-map-site-markers',
  imports: [IconComponent, MapAreaIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="cctv-map-markers-layer" aria-label="Camera locations">
      @for (m of markers(); track m.area.id) {
        <button type="button" [class]="m.cls" [style.left.%]="m.left" [style.top.%]="m.top" [style.--marker-color]="m.area.cardColor"
          (click)="selectArea.emit({ areaId: m.area.id, cameraId: m.area.cameraId })">
          <span class="cctv-site-tag">
            <span class="cctv-site-tag-icon"><app-map-area-icon [kind]="m.area.icon" /></span>
            <span class="cctv-site-tag-body">
              <span class="cctv-site-tag-title">{{ m.area.label }}</span>
              @if (m.cameraDown) {
                <span class="cctv-site-tag-incident cctv-site-tag-down">{{ m.area.downMessage ?? 'Camera down — please check' }}</span>
              } @else if (m.hasAlert) {
                <span class="cctv-site-tag-incident">{{ m.alertCount }} incident{{ m.alertCount === 1 ? '' : 's' }} detected</span>
              } @else {
                <span class="cctv-site-tag-meta">{{ m.live ? m.badge : 'Offline' }}{{ m.area.id === 'access-road' ? ' · Road' : '' }}</span>
              }
            </span>
            @if (m.cameraDown || m.hasAlert) {
              <span class="cctv-site-tag-warn">!</span>
            }
          </span>

          <span class="cctv-site-connector" aria-hidden="true"></span>

          <span class="cctv-site-pin">
            @if (m.hasAlert) {
              <span class="cctv-site-alert-pulse" aria-hidden="true"></span>
            }
            <span class="cctv-site-pin-ring"></span>
            <span class="cctv-site-pin-body"><svg appIcon="camera" class="cctv-site-pin-icon" aria-hidden="true"></svg></span>
          </span>
        </button>
      }
    </div>
  `,
})
export class MapSiteMarkersComponent {
  readonly alerts = input.required<Alert[]>()
  readonly cameras = input.required<CameraChannel[]>()
  readonly selectedAreaId = input<string | null>(null)
  readonly orbitYaw = input(0)
  readonly selectArea = output<{ areaId: string; cameraId: number }>()

  protected readonly markers = computed(() => {
    const { width, height } = CCTV_MAP_VIEWBOX
    const alerts = this.alerts()
    const cameras = this.cameras()
    return MAP_AREAS.map((area) => {
      const cam = cameras.find((c) => c.id === area.cameraId)
      const isSearching = cam?.type === 'searching' || cam?.status === 'searching'
      const cameraDown = isSearching || Boolean(area.downMessage)
      const alertCount = getAlertsForCamera(alerts, area.cameraId).length
      const live = Boolean(cam?.available && !cameraDown && (cam.status === 'online' || cam.status === 'playback'))
      const selected = this.selectedAreaId() === area.id
      const hasAlert = !cameraDown && alertCount > 0
      const [px, py] = rotateSitePoint(area.sceneX, area.sceneY, this.orbitYaw())
      const statusClass = cameraDown ? 'is-down' : hasAlert ? 'is-alert' : live ? 'is-live' : 'is-offline'
      const cls = `cctv-site-marker ${selected ? 'is-selected' : ''} ${statusClass}${area.id === 'north-gate' ? ' cctv-site-marker--compact' : ''}`
      return {
        area,
        cameraDown,
        alertCount,
        live,
        hasAlert,
        cls,
        left: (px / width) * 100,
        top: (py / height) * 100,
        badge: cameraBadgeLabel(area.cameraId),
      }
    })
  })
}

@Component({
  selector: 'app-map-floating-preview',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let v = view();
    <svg class="cctv-map-preview-connector" aria-hidden="true">
      <line [attr.x1]="v.pinLeft + '%'" [attr.y1]="v.pinTop + '%'" [attr.x2]="v.cardLeft + 12 + '%'" [attr.y2]="v.cardTop + 22 + '%'"
        stroke="rgba(148,163,184,0.28)" stroke-width="1" stroke-dasharray="4 4" />
    </svg>

    <div class="cctv-map-float-preview" [style.left.%]="v.cardLeft" [style.top.%]="v.cardTop" [style.--hero-color]="area().cardColor">
      <header class="cctv-map-float-preview-head">
        <div class="cctv-map-float-preview-head-main">
          <span class="cctv-map-float-preview-icon" [style.background]="'color-mix(in srgb, ' + area().cardColor + ' 18%, #0a0e16)'">
            <svg appIcon="camera" aria-hidden="true"></svg>
          </span>
          <div class="cctv-map-float-preview-titles">
            <div class="cctv-map-float-preview-title-row">
              <h3 class="cctv-map-float-preview-name">{{ area().label }}</h3>
              <span [class]="'cctv-map-data-status cctv-map-data-status--' + v.tone">
                <span class="cctv-map-data-status-dot"></span>{{ v.statusLabel }}
              </span>
            </div>
            <p class="cctv-map-float-preview-meta">{{ v.meta }}</p>
          </div>
        </div>
        <button type="button" class="cctv-map-float-preview-close" (click)="closed.emit()" aria-label="Close">×</button>
      </header>

      <div class="cctv-map-data-panel">
        <dl class="cctv-map-data-stats">
          <div>
            <dt>Incidents</dt>
            <dd [attr.class]="v.alertCount > 0 ? 'is-alert' : ''">{{ v.alertCount }}</dd>
          </div>
          <div>
            <dt>{{ area().id === 'access-road' ? 'Vehicles' : 'Tracks' }}</dt>
            <dd>{{ area().id === 'access-road' ? (camera().vehicle_count ?? 0) : (camera().active_tracks ?? 0) }}</dd>
          </div>
          <div>
            <dt>AI</dt>
            <dd [attr.class]="camera().ai_enabled === false ? 'is-muted' : 'is-active'">{{ camera().ai_enabled === false ? 'Paused' : 'Active' }}</dd>
          </div>
        </dl>

        @if (v.cameraDown) {
          <div class="cctv-map-data-alert cctv-map-data-alert--down">
            <span class="cctv-map-data-alert-label">Camera status</span>
            <span class="cctv-map-data-alert-text">{{ area().downMessage ?? 'Camera down — please check' }}</span>
            <span class="cctv-map-data-alert-meta">No signal from remote feed</span>
          </div>
        } @else if (v.latest; as latest) {
          <div class="cctv-map-data-alert">
            <span class="cctv-map-data-alert-label">Latest incident</span>
            <span class="cctv-map-data-alert-text">{{ latest.event_label }}</span>
            <span class="cctv-map-data-alert-meta">{{ latest.zone_label }} · {{ latest.time_label }}</span>
          </div>
        } @else {
          <p class="cctv-map-data-clear">All clear — no active incidents.</p>
        }
      </div>

      <footer class="cctv-map-float-preview-foot">
        @if (!v.cameraDown) {
          <button type="button" class="cctv-map-open-monitor-btn" (click)="openLive()">
            <svg appIcon="camera" aria-hidden="true"></svg>
            Open live feed
          </button>
        } @else {
          <p class="cctv-map-data-clear cctv-map-float-preview-down-note">Remote camera unreachable — check power and network link.</p>
        }
      </footer>
    </div>
  `,
})
export class MapFloatingPreviewComponent {
  readonly area = input.required<MapArea>()
  readonly camera = input.required<CameraChannel>()
  readonly alerts = input.required<Alert[]>()
  readonly closed = output<void>()
  private readonly router = inject(Router)

  protected readonly view = computed(() => {
    const area = this.area()
    const camera = this.camera()
    const { width, height } = CCTV_MAP_VIEWBOX
    const camAlerts = getAlertsForCamera(this.alerts(), camera.id)
    const zones = MAP_ZONES.filter((z) => z.areaId === area.id)
    const isSearching = camera.type === 'searching' || camera.status === 'searching'
    const cameraDown = isSearching || Boolean(area.downMessage)
    const zoneLabel = zones.map((z) => z.label).join(' · ')
    const pinLeft = (area.sceneX / width) * 100
    const pinTop = (area.sceneY / height) * 100
    return {
      alertCount: camAlerts.length,
      latest: camAlerts[0] ?? null,
      cameraDown,
      tone: cameraDown ? 'offline' : feedStatusTone(camera),
      statusLabel: feedStatusLabel(camera),
      meta: cameraBadgeLabel(camera.id) + (zoneLabel ? ` · ${zoneLabel}` : area.subtitle ? ` · ${area.subtitle}` : ''),
      pinLeft,
      pinTop,
      cardLeft: Math.min(Math.max(pinLeft + 8, 4), 56),
      cardTop: Math.min(Math.max(pinTop - 28, 4), 48),
    }
  })

  protected openLive() {
    void this.router.navigate(['/monitoring'], { queryParams: { camera: this.camera().id } })
  }
}

@Component({
  selector: 'app-map-viewport-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="cctv-map-scale" aria-hidden="true">
      <span class="cctv-map-scale-bar"></span>
      <span class="cctv-map-scale-label">200 m</span>
    </div>

    <div class="cctv-map-view-controls">
      <div class="cctv-map-view-mode">
        <button type="button" [class]="'cctv-map-view-btn ' + (!view3d() ? 'is-active' : '')" (click)="toggle3d.emit()" title="Flat map view">2D</button>
        <button type="button" [class]="'cctv-map-view-btn ' + (view3d() ? 'is-active' : '')" (click)="toggle3d.emit()" title="Isometric map view">3D</button>
      </div>
      @if (view3d()) {
        <button type="button" class="cctv-map-view-btn" (click)="orbitStep.emit(-90)" title="View previous side" aria-label="Rotate left 90 degrees">◀</button>
        <button type="button" class="cctv-map-view-btn" (click)="orbitStep.emit(90)" title="View next side" aria-label="Rotate right 90 degrees">▶</button>
        <button type="button" class="cctv-map-view-btn" (click)="resetOrbit.emit()" title="Reset to north">⟲</button>
      }
      <div class="cctv-map-zoom-group">
        <button type="button" class="cctv-map-view-btn" (click)="zoomIn.emit()" aria-label="Zoom in">+</button>
        <button type="button" class="cctv-map-view-btn" (click)="zoomOut.emit()" aria-label="Zoom out">−</button>
      </div>
      <span class="cctv-map-zoom-readout">{{ readout() }}</span>
    </div>
  `,
})
export class MapViewportControlsComponent {
  readonly zoom = input.required<number>()
  readonly view3d = input.required<boolean>()
  readonly orbitYaw = input.required<number>()
  readonly zoomIn = output<void>()
  readonly zoomOut = output<void>()
  readonly toggle3d = output<void>()
  readonly resetOrbit = output<void>()
  readonly orbitStep = output<number>()

  protected readonly readout = computed(() => {
    const snapped = (((Math.round(this.orbitYaw() / 90) * 90) % 360) + 360) % 360
    const heading = snapped === 0 ? 'N' : snapped === 90 ? 'E' : snapped === 180 ? 'S' : 'W'
    const pct = `${Math.round(this.zoom() * 100)}%`
    return this.view3d() ? `${pct} · ${heading}` : pct
  })
}

@Component({
  selector: 'app-cctv-map-canvas',
  imports: [MapTwinSceneComponent, MapSiteMarkersComponent, MapFloatingPreviewComponent, MapViewportControlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="cctv-map-canvas-wrap">
      <span class="cctv-map-coords" aria-hidden="true">Site twin · v1.0</span>

      <div class="cctv-map-hud" aria-hidden="true">
        <span class="cctv-map-hud-corner cctv-map-hud-corner--tl"></span>
        <span class="cctv-map-hud-corner cctv-map-hud-corner--tr"></span>
        <span class="cctv-map-hud-corner cctv-map-hud-corner--bl"></span>
        <span class="cctv-map-hud-corner cctv-map-hud-corner--br"></span>
      </div>

      <div class="cctv-map-scanlines" aria-hidden="true"></div>

      <div
        [class]="'cctv-map-scene ' + (view3d() ? 'is-3d' : 'is-2d') + (isDragging() ? ' is-dragging' : '')"
        [style.--map-zoom]="zoom()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="endDrag($event)"
        (pointercancel)="endDrag($event)"
        (dblclick)="view3d() && orbitYaw.set(0)"
      >
        <div class="cctv-map-turntable">
          <div class="cctv-map-scene-inner">
            <app-map-twin-scene [selectedAreaId]="selectedAreaId()" [orbitYaw]="activeYaw()" [view3d]="view3d()" />
            <app-map-site-markers [alerts]="alerts()" [cameras]="cameras()" [selectedAreaId]="selectedAreaId()" [orbitYaw]="activeYaw()"
              (selectArea)="selectArea.emit($event)" />
          </div>
        </div>
      </div>

      @if (view3d()) {
        <p class="cctv-map-rotate-hint" aria-hidden="true">Drag to walk around · ◀ ▶ for sides · double-click to reset</p>
      }

      @if (selectedArea() && selectedCamera()) {
        <app-map-floating-preview [area]="selectedArea()!" [camera]="selectedCamera()!" [alerts]="alerts()" (closed)="closePreview.emit()" />
      }

      <app-map-viewport-controls
        [zoom]="zoom()"
        [view3d]="view3d()"
        [orbitYaw]="orbitYaw()"
        (zoomIn)="zoom.set(min(1.6, +(zoom() + 0.1).toFixed(1)))"
        (zoomOut)="zoom.set(max(0.7, +(zoom() - 0.1).toFixed(1)))"
        (toggle3d)="view3d.set(!view3d())"
        (resetOrbit)="orbitYaw.set(0)"
        (orbitStep)="orbitYaw.set(orbitYaw() + $event)"
      />

      <div class="cctv-map-legend" aria-label="Map legend">
        <span class="cctv-map-legend-item"><span class="cctv-map-legend-swatch cctv-map-legend-swatch--clear"></span>Secure</span>
        <span class="cctv-map-legend-item"><span class="cctv-map-legend-swatch cctv-map-legend-swatch--active"></span>Incident</span>
        <span class="cctv-map-legend-item"><span class="cctv-map-legend-swatch cctv-map-legend-swatch--yolo"></span>Access road</span>
      </div>
    </div>
  `,
})
export class CctvMapCanvasComponent {
  readonly alerts = input.required<Alert[]>()
  readonly cameras = input.required<CameraChannel[]>()
  readonly selectedAreaId = input<string | null>(null)
  readonly selectedCameraId = input<number | null>(null)
  readonly selectArea = output<{ areaId: string; cameraId: number }>()
  readonly closePreview = output<void>()

  protected readonly zoom = signal(1)
  protected readonly view3d = signal(true)
  protected readonly orbitYaw = signal(0)
  protected readonly isDragging = signal(false)
  protected readonly min = Math.min
  protected readonly max = Math.max
  private drag = { active: false, pointerId: -1, startX: 0, startYaw: 0 }

  protected readonly activeYaw = computed(() => (this.view3d() ? this.orbitYaw() : 0))
  protected readonly selectedArea = computed(() => {
    const id = this.selectedAreaId()
    return id ? (MAP_AREAS.find((a) => a.id === id) ?? null) : null
  })
  protected readonly selectedCamera = computed(() => {
    const id = this.selectedCameraId()
    return id ? (this.cameras().find((c) => c.id === id) ?? null) : null
  })

  protected onPointerDown(event: PointerEvent) {
    if (!this.view3d()) return
    if ((event.target as HTMLElement).closest('.cctv-map-html-pin, button, a')) return
    this.drag = { active: true, pointerId: event.pointerId, startX: event.clientX, startYaw: this.orbitYaw() }
    this.isDragging.set(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  protected onPointerMove(event: PointerEvent) {
    if (!this.drag.active || event.pointerId !== this.drag.pointerId) return
    this.orbitYaw.set(this.drag.startYaw + (event.clientX - this.drag.startX) * 0.65)
  }

  protected endDrag(event: PointerEvent) {
    if (!this.drag.active || event.pointerId !== this.drag.pointerId) return
    this.drag.active = false
    this.isDragging.set(false)
    const el = event.currentTarget as HTMLElement
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  }
}
