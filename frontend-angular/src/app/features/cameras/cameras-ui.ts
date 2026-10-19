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

/** Port of CctvSearchingSignal. */
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

/** Port of the Cameras page's CameraFeed — polls one channel's JPEG. */
@Component({
  selector: 'app-camera-feed',
  imports: [CctvSearchingSignalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (hasSignal() && src()) {
      <img [src]="src()" [alt]="'CCTV 0' + cameraId() + ' feed'" class="cctv-feed-image" />
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

      const staggerMs = priority ? 0 : (cameraId - 1) * 80
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
  if (camera.type === 'searching' || camera.status === 'searching') return true
  if (camera.type === 'webcam' && camera.status !== 'online') return true
  if (camera.type === 'video' && !camera.available) return true
  return false
}

function tileSubtitle(camera: CameraChannel): string {
  if (camera.type === 'webcam') return 'Laptop Camera'
  if (camera.type === 'searching') return 'Remote perimeter — no signal'
  if (camera.id === 4) return camera.available ? (camera.filename ?? 'Access road feed') : 'Access road — upload traffic clip'
  if (camera.available) return camera.filename ?? 'Recording loaded'
  return 'No recording'
}

function statusChip(camera: CameraChannel, active: boolean, aiEnabled: boolean): [string, string] {
  if (active) return ['cctv-chip-active', 'MONITOR FEED']
  if (!aiEnabled && camera.type !== 'searching') return ['cctv-chip-offline', 'AI PAUSED']
  if (camera.type === 'searching' || camera.status === 'searching') return ['cctv-chip-searching', 'NO SIGNAL']
  if (camera.type === 'video' && !camera.available) return ['cctv-chip-searching', 'NO SIGNAL']
  if (camera.type === 'webcam' && camera.status !== 'online') return ['cctv-chip-searching', 'CONNECTING']
  if (camera.status === 'playback') return ['cctv-chip-playback', 'PLAYBACK']
  if (camera.status === 'online') return ['cctv-chip-online', 'ONLINE']
  if (camera.available) return ['cctv-chip-ready', 'READY']
  return ['cctv-chip-offline', 'OFFLINE']
}

/** Port of the Cameras page's CctvTile. */
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
            <p class="cctv-tile-id">CCTV 0{{ cam.id }}</p>
            <p class="cctv-tile-label truncate">{{ cam.type === 'searching' ? 'Remote perimeter — North Gate' : (cam.filename ?? subtitle()) }}</p>
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
        @if (uploading()) {
          <div class="cctv-upload-overlay">Uploading…</div>
        }
      </div>

      <footer class="cctv-tile-footer">
        @if (!isSearching()) {
          <div class="cctv-tile-toggles">
            <label class="cctv-toggle">
              <input type="checkbox" [checked]="aiEnabled()" (change)="settings.emit({ ai_enabled: $any($event.target).checked })" />
              <span>AI Tracking</span>
            </label>
            <label class="cctv-toggle">
              <input type="checkbox" [checked]="showBoxes()" [disabled]="!aiEnabled()" (change)="settings.emit({ show_boxes: $any($event.target).checked })" />
              <span>Show Boxes</span>
            </label>
          </div>
        }

        <div class="cctv-tile-actions">
          @if (canMonitor()) {
            <button type="button" class="cctv-btn cctv-btn-primary" [disabled]="activating()" (click)="activate.emit()">
              {{ activating() ? 'Opening…' : 'Open in Monitoring' }}
            </button>
          } @else if (isVideoSlot() && !cam.available) {
            <input #fileInput type="file" accept="video/mp4,video/avi,video/quicktime,.mp4,.avi,.mov" class="hidden" (change)="onFile($event)" />
            <button type="button" class="cctv-btn cctv-btn-primary" [disabled]="uploading()" (click)="fileInput.click()">Upload Video</button>
          } @else {
            <span class="cctv-footer-note">{{ cam.id === 1 ? 'Waiting for webcam…' : 'No source' }}</span>
          }

          @if (isVideoSlot() && cam.available) {
            <input #replaceInput type="file" accept="video/mp4,video/avi,video/quicktime,.mp4,.avi,.mov" class="hidden" (change)="onFile($event)" />
            <button type="button" class="cctv-btn" [disabled]="uploading()" (click)="replaceInput.click()">Replace</button>
            <button type="button" class="cctv-btn cctv-btn-danger" (click)="remove.emit()">Remove</button>
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
  readonly uploading = input(false)
  readonly activate = output<void>()
  readonly upload = output<File>()
  readonly remove = output<void>()
  readonly settings = output<{ ai_enabled?: boolean; show_boxes?: boolean }>()

  protected readonly isSearching = computed(() => channelIsSearching(this.camera()))
  protected readonly isWebcam = computed(() => this.camera().type === 'webcam')
  protected readonly showFeed = computed(() => this.isWebcam() || !this.isSearching())
  protected readonly isVideoSlot = computed(() => this.camera().type === 'video')
  protected readonly canMonitor = computed(
    () => (this.isWebcam() || !this.isSearching()) && (this.camera().id === 1 || this.camera().available),
  )
  protected readonly aiEnabled = computed(() => this.camera().ai_enabled !== false)
  protected readonly showBoxes = computed(() => this.camera().show_boxes !== false)
  protected readonly subtitle = computed(() => tileSubtitle(this.camera()))
  protected readonly chip = computed(() => statusChip(this.camera(), this.active(), this.aiEnabled()))
  protected readonly tileClass = computed(
    () =>
      `cctv-tile ${this.active() ? 'cctv-tile-active' : ''} ${this.isSearching() && !this.isWebcam() ? 'cctv-tile-searching' : ''} ${this.isSearching() && this.isWebcam() ? 'cctv-tile-connecting' : ''}`,
  )

  protected onFile(event: Event) {
    const el = event.target as HTMLInputElement
    const file = el.files?.[0]
    if (file) this.upload.emit(file)
    el.value = ''
  }
}
