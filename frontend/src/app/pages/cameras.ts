import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { createPoll, POLL_KEYS } from '../core/polling'
import { CctvTileComponent } from '../features/cameras/cameras-ui'
import { api } from '../shared/services/api'
import { ErrorStateComponent, PageHeaderComponent } from '../shared/ui/common'
import { normalizeWallCameras } from '../shared/utils/wallCameras'

const LEGEND = [
  ['CCTV 01', 'Laptop webcam — live when available'],
  ['CCTV 02–03', 'Upload MP4/AVI/MOV for playback tracking'],
  ['CCTV 04', 'Access road channel — upload traffic clip'],
  ['CCTV 05', 'Remote perimeter — searching for signal (North Gate)'],
  ['Monitoring', 'Green border + ACTIVE MONITOR = same feed as Monitoring page'],
] as const

/** Port of React's pages/Cameras. */
@Component({
  selector: 'app-cameras',
  imports: [RouterLink, CctvTileComponent, ErrorStateComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (camerasPoll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      <div class="cameras-page space-y-6">
        <div appPageHeader eyebrow="Operations" heading="Camera Wall"
          description="All channels can track in parallel. Green border = same feed as Monitoring. Boxes stay visible between detections.">
          <div class="shrink-0 pt-1">
            <div class="flex items-center gap-2">
              @if (message()) {
                <span class="cctv-toast">{{ message() }}</span>
              } @else {
                <span class="cctv-live-badge"><span class="cctv-live-dot"></span>{{ liveCount() }} live</span>
              }
              <a routerLink="/monitoring" class="btn-primary text-xs">Open Monitoring</a>
            </div>
          </div>
        </div>

        <div class="cctv-wall">
          @if (camerasPoll.loading() && cameras().length === 0) {
            <div class="cameras-skeleton-grid col-span-full w-full">
              @for (i of [0, 1, 2, 3, 4]; track i) {
                <div class="cameras-skeleton-card"></div>
              }
            </div>
          } @else {
            @for (camera of cameras(); track camera.id) {
              <app-cctv-tile
                [camera]="camera"
                [active]="camera.id === activeId()"
                [activating]="activatingId() === camera.id"
                [uploading]="uploadingId() === camera.id"
                (activate)="activateCamera(camera.id)"
                (upload)="handleUpload(camera.id, $event)"
                (remove)="handleDelete(camera.id)"
                (settings)="updateSettings(camera.id, $event)"
              />
            }
          }
        </div>

        <div class="cctv-legend panel">
          <div class="panel-header">
            <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">Channel Guide</h3>
          </div>
          <div class="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
            @for (item of legend; track item[0]) {
              <div>
                <p class="text-sm font-medium text-white">{{ item[0] }}</p>
                <p class="mt-1 text-xs leading-relaxed text-guardian-muted">{{ item[1] }}</p>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CamerasPage {
  private readonly router = inject(Router)
  protected readonly camerasPoll = createPoll(() => api.getCameras(), 2000, POLL_KEYS.cameras)
  protected readonly statusPoll = createPoll(() => api.getStatus(), 2000, POLL_KEYS.status)
  protected readonly legend = LEGEND

  protected readonly activatingId = signal<number | null>(null)
  protected readonly uploadingId = signal<number | null>(null)
  protected readonly message = signal<string | null>(null)

  protected readonly cameras = computed(() => normalizeWallCameras(this.camerasPoll.data()?.cameras ?? []))
  protected readonly activeId = computed(
    () => this.statusPoll.data()?.camera_id ?? this.cameras().find((c) => c.active)?.id ?? 1,
  )
  protected readonly liveCount = computed(
    () => this.cameras().filter((c) => c.status === 'online' || c.status === 'playback').length,
  )

  private flash(text: string) {
    this.message.set(text)
    window.setTimeout(() => this.message.set(null), 3000)
  }

  private goMonitor(cameraId: number) {
    void this.router.navigate(['/monitoring'], { queryParams: { camera: cameraId } })
  }

  protected async activateCamera(cameraId: number) {
    const cam = this.cameras().find((c) => c.id === cameraId)
    if (!cam || cam.type === 'searching') return
    if (cameraId !== 1 && !cam.available) return
    if (cameraId === this.activeId()) {
      this.goMonitor(cameraId)
      return
    }
    this.activatingId.set(cameraId)
    try {
      await api.switchCamera(cameraId)
      await Promise.all([this.camerasPoll.refresh(), this.statusPoll.refresh()])
      this.goMonitor(cameraId)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Failed to switch camera')
    } finally {
      this.activatingId.set(null)
    }
  }

  protected async handleUpload(cameraId: number, file: File) {
    this.uploadingId.set(cameraId)
    try {
      await api.uploadVideo(file, cameraId)
      await this.camerasPoll.refresh()
      this.flash(`Uploaded to CCTV 0${cameraId}`)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      this.uploadingId.set(null)
    }
  }

  protected async handleDelete(cameraId: number) {
    if (!window.confirm(`Remove recording from CCTV 0${cameraId}?`)) return
    try {
      await api.deleteCamera(cameraId)
      await Promise.all([this.camerasPoll.refresh(), this.statusPoll.refresh()])
      this.flash(`CCTV 0${cameraId} cleared`)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  protected async updateSettings(cameraId: number, settings: { ai_enabled?: boolean; show_boxes?: boolean }) {
    try {
      await api.setCameraSettings(cameraId, settings)
      await this.camerasPoll.refresh()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Settings update failed')
    }
  }
}
