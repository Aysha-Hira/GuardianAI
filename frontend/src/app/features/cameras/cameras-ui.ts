import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core'
import { api } from '../../shared/services/api'
import type { CameraChannel } from '../../shared/types'
import { IconComponent } from '../../shared/ui/icon'

@Component({
  selector: 'app-cctv-searching-signal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div [class]="'cctv-searching ' + (compact() ? 'cctv-searching-compact' : '') + ' ' + (variant() === 'dashboard' ? 'cctv-searching-dashboard' : '')">
      <div class="cctv-searching-radar" aria-hidden="true">
        <span class="cctv-searching-radar-ring cctv-searching-radar-ring--1"></span>
        <span class="cctv-searching-radar-ring cctv-searching-radar-ring--2"></span>
        <span class="cctv-searching-radar-core">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </span>
      </div>
      <div class="cctv-searching-bars" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <p class="cctv-searching-text">SEARCHING FOR SIGNAL</p>
      @if (!compact()) {
        <p class="cctv-searching-sub">No connection to remote camera</p>
      } @else if (variant() === 'dashboard') {
        <p class="cctv-searching-sub">North Gate · remote perimeter</p>
      }
    </div>
  `,
})
export class CctvSearchingSignalComponent {
  readonly compact = input(false)
  readonly variant = input<'tile' | 'dashboard'>('tile')
}

@Component({
  selector: 'app-camera-feed',
  imports: [CctvSearchingSignalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (hasSignal() && src()) {
      <img [src]="src()" [alt]="'Camera ' + cameraId() + ' feed'" class="cctv-feed-image" />
    } @else {
      <div class="cctv-no-signal"><app-cctv-searching-signal [compact]="true" /></div>
    }
  `,
})
export class CameraFeedComponent {
  readonly cameraId = input.required<number>()
  readonly isMonitor = input(false)
  readonly priority = input(false)
  protected readonly src = signal<string | null>(null)
  protected readonly hasSignal = signal(false)

  constructor() {
    let cleanup: (() => void) | null = null
    effect(() => {
      untracked(() => cleanup?.())
      const cameraId = this.cameraId()
      const isMonitor = this.isMonitor()
      const priority = this.priority()
      let cancelled = false
      let timer: number | undefined

      const poll = async () => {
        try {
          const blob = isMonitor ? await api.getFrameBlob() : await api.getCameraFrameBlob(cameraId)
          if (cancelled) return
          if (!blob) {
            this.hasSignal.set(false)
            return
          }
          const url = URL.createObjectURL(blob)
          const prev = this.src()
          if (prev) URL.revokeObjectURL(prev)
          this.src.set(url)
          this.hasSignal.set(true)
        } catch {
          if (!cancelled) this.hasSignal.set(false)
        }
      }

      const staggerMs = priority ? 0 : (cameraId % 5) * 80
      const pollMs = isMonitor ? 80 : priority ? 60 : 120
      const startId = window.setTimeout(() => {
        void poll()
        timer = window.setInterval(() => void poll(), pollMs)
      }, staggerMs)

      cleanup = () => {
        cancelled = true
        window.clearTimeout(startId)
        window.clearInterval(timer)
        const prev = this.src()
        if (prev) URL.revokeObjectURL(prev)
        this.src.set(null)
      }
    })
    inject(DestroyRef).onDestroy(() => cleanup?.())
  }
}

export function channelIsSearching(camera: CameraChannel): boolean {
  return camera.status !== 'online' && camera.status !== 'playback'
}

function tileSubtitle(camera: CameraChannel): string {
  return camera.type === 'webcam' ? 'Local webcam' : 'Network camera'
}

function statusChip(camera: CameraChannel, active: boolean, aiEnabled: boolean): [string, string] {
  if (active) return ['cctv-chip-active', 'MONITOR FEED']
  if (!aiEnabled && camera.type !== 'searching') return ['cctv-chip-offline', 'AI PAUSED']
  if (camera.type === 'searching' || camera.status === 'searching') return ['cctv-chip-searching', 'NO SIGNAL']
  if (camera.type === 'webcam' && camera.status !== 'online') return ['cctv-chip-searching', 'CONNECTING']
  if (camera.status === 'playback') return ['cctv-chip-playback', 'PLAYBACK']
  if (camera.status === 'online') return ['cctv-chip-online', 'ONLINE']
  if (camera.available) return ['cctv-chip-ready', 'READY']
  return ['cctv-chip-offline', 'OFFLINE']
}

@Component({
  selector: 'app-cctv-tile',
  imports: [IconComponent, CameraFeedComponent, CctvSearchingSignalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let cam = camera();
    <article [class]="tileClass()">
      <header class="cctv-tile-header">
        <div class="cctv-tile-title">
          <span class="cctv-tile-icon">
            @if (cam.type === 'webcam') {
              <svg appIcon="cameras" class="h-4 w-4"></svg>
            } @else if (cam.type === 'searching') {
              <span class="cctv-signal-icon" aria-hidden="true"></span>
            } @else {
              <svg appIcon="video" class="h-4 w-4"></svg>
            }
          </span>
          <div class="min-w-0">
            <p class="cctv-tile-id">{{ cam.label }}</p>
            <p class="cctv-tile-label truncate">{{ subtitle() }}</p>
          </div>
        </div>
        <span [class]="'cctv-chip ' + chip()[0]">{{ chip()[1] }}</span>
      </header>

      <div class="cctv-tile-viewport">
        @if (showFeed()) {
          <app-camera-feed [cameraId]="cam.id" [isMonitor]="active()" [priority]="isWebcam()" />
        } @else {
          <app-cctv-searching-signal />
        }

        @if (active()) {
          <div class="cctv-active-badge"><span class="cctv-live-dot"></span>ACTIVE MONITOR</div>
        }
        @if (!isSearching() && aiEnabled() && (cam.people_count ?? 0) > 0) {
          <div class="cctv-stats-badge">{{ cam.people_count }} people · {{ cam.active_tracks ?? 0 }} tracks</div>
        }
      </div>

      <footer class="cctv-tile-footer">
        @if (!isSearching()) {
          <div class="cctv-tile-toggles">
            <label class="cctv-toggle">
              <input type="checkbox" [checked]="aiEnabled()" [disabled]="!canManage()" (change)="settings.emit({ ai_enabled: $any($event.target).checked })" />
              <span>AI Tracking</span>
            </label>
            <label class="cctv-toggle">
              <input type="checkbox" [checked]="showBoxes()" [disabled]="!aiEnabled() || !canManage()" (change)="settings.emit({ show_boxes: $any($event.target).checked })" />
              <span>Show Boxes</span>
            </label>
          </div>
        }

        <div class="cctv-tile-actions">
          @if (canMonitor()) {
            <button type="button" class="cctv-btn cctv-btn-primary" [disabled]="activating()" (click)="activate.emit()">
              {{ activating() ? 'Opening…' : 'Open in Monitoring' }}
            </button>
          } @else {
            <span class="cctv-footer-note">Waiting for signal…</span>
          }
        </div>
      </footer>
    </article>
  `,
})
export class CctvTileComponent {
  readonly camera = input.required<CameraChannel>()
  readonly active = input(false)
  readonly activating = input(false)
  readonly canManage = input(true)
  readonly activate = output<void>()
  readonly settings = output<{ ai_enabled?: boolean; show_boxes?: boolean }>()

  protected readonly isSearching = computed(() => channelIsSearching(this.camera()))
  protected readonly isWebcam = computed(() => this.camera().type === 'webcam')
  protected readonly showFeed = computed(() => this.isWebcam() || !this.isSearching())
  protected readonly canMonitor = computed(() => this.isWebcam() || !this.isSearching())
  protected readonly aiEnabled = computed(() => this.camera().ai_enabled !== false)
  protected readonly showBoxes = computed(() => this.camera().show_boxes !== false)
  protected readonly subtitle = computed(() => tileSubtitle(this.camera()))
  protected readonly chip = computed(() => statusChip(this.camera(), this.active(), this.aiEnabled()))
  protected readonly tileClass = computed(
    () =>
      `cctv-tile ${this.active() ? 'cctv-tile-active' : ''} ${this.isSearching() && !this.isWebcam() ? 'cctv-tile-searching' : ''} ${this.isSearching() && this.isWebcam() ? 'cctv-tile-connecting' : ''}`,
  )
}
