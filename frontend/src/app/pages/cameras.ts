import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { AuthService } from '../core/auth.service'
import { createPoll, POLL_KEYS } from '../core/polling'
import { CctvTileComponent } from '../features/cameras/cameras-ui'
import { api } from '../shared/services/api'
import type { CameraRecord, CameraSourceType } from '../shared/types'
import { ErrorStateComponent, PageHeaderComponent } from '../shared/ui/common'
import { normalizeWallCameras } from '../shared/utils/wallCameras'

const SOURCE_LABELS: Record<CameraSourceType, string> = {
  webcam: 'Local webcam',
  rtsp: 'RTSP camera',
  http: 'IP webcam (HTTP)',
}

const URL_HINTS: Record<CameraSourceType, string> = {
  webcam: 'Device index, e.g. 0',
  rtsp: 'rtsp://user:password@192.168.1.10:554/stream',
  http: 'http://192.168.1.20:8080/video',
}

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
          description="All active cameras track in parallel. Green border = same feed as Monitoring.">
          <div class="shrink-0 pt-1">
            <div class="flex items-center gap-2">
              @if (message()) {
                <span class="cctv-toast">{{ message() }}</span>
              } @else {
                <span class="cctv-live-badge"><span class="cctv-live-dot"></span>{{ liveCount() }} live</span>
              }
              @if (!auth.isAdmin()) {
                <span class="role-note">View only — cameras are managed by an administrator</span>
              }
              <a routerLink="/monitoring" class="btn-primary text-xs">Open Monitoring</a>
            </div>
          </div>
        </div>

        <div class="cctv-wall">
          @if (camerasPoll.loading() && cameras().length === 0) {
            <div class="cameras-skeleton-grid col-span-full w-full">
              @for (i of [0, 1, 2]; track i) {
                <div class="cameras-skeleton-card"></div>
              }
            </div>
          } @else if (cameras().length === 0) {
            <p class="col-span-full text-sm text-guardian-muted">
              No active cameras. Add a camera below and switch it on.
            </p>
          } @else {
            @for (camera of cameras(); track camera.id) {
              <app-cctv-tile
                [camera]="camera"
                [active]="camera.id === activeId()"
                [activating]="activatingId() === camera.id"
                [canManage]="auth.isAdmin()"
                (activate)="activateCamera(camera.id)"
                (settings)="updateSettings(camera.id, $event)"
              />
            }
          }
        </div>

        @if (auth.isAdmin()) {
          <section class="panel">
            <div class="panel-header">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">Add Camera</h3>
            </div>
            <div class="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label class="field-label">Name</label>
                <input class="input-field w-full" maxlength="36" placeholder="Front gate"
                  [value]="newName()" (input)="newName.set($any($event.target).value)" />
              </div>
              <div>
                <label class="field-label">Type</label>
                <select class="input-field w-full" [value]="newType()"
                  (change)="newType.set($any($event.target).value)">
                  @for (t of sourceTypes; track t) {
                    <option [value]="t">{{ sourceLabels[t] }}</option>
                  }
                </select>
              </div>
              <div class="sm:col-span-2">
                <label class="field-label">{{ newType() === 'webcam' ? 'Device index' : 'Stream URL' }}</label>
                <input class="input-field w-full font-mono" autocomplete="off"
                  [placeholder]="urlHint()" [value]="newUrl()"
                  (input)="newUrl.set($any($event.target).value)" />
              </div>
              <div class="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
                <label class="cctv-toggle">
                  <input type="checkbox" [checked]="newActive()"
                    (change)="newActive.set($any($event.target).checked)" />
                  <span>Start streaming now</span>
                </label>
                <button type="button" class="btn-primary text-xs" [disabled]="saving()" (click)="addCamera()">
                  {{ saving() ? 'Saving…' : 'Add Camera' }}
                </button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">Saved Cameras</h3>
            </div>
            <div class="divide-y divide-white/5">
              @for (record of records(); track record.id) {
                <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-white">{{ record.camera_name }}</p>
                    <p class="text-xs text-guardian-muted">
                      {{ sourceLabels[record.source_type] }} · {{ record.is_active ? 'Streaming' : 'Off' }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button type="button" class="cctv-btn" (click)="toggleActive(record)">
                      {{ record.is_active ? 'Turn off' : 'Turn on' }}
                    </button>
                    <button type="button" class="cctv-btn cctv-btn-danger" (click)="removeRecord(record)">Delete</button>
                  </div>
                </div>
              } @empty {
                <p class="px-5 py-4 text-sm text-guardian-muted">No cameras saved yet.</p>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
})
export class CamerasPage {
  private readonly router = inject(Router)
  protected readonly auth = inject(AuthService)
  protected readonly camerasPoll = createPoll(() => api.getCameras(), 2000, POLL_KEYS.cameras)
  protected readonly statusPoll = createPoll(() => api.getStatus(), 2000, POLL_KEYS.status)

  protected readonly sourceTypes: CameraSourceType[] = ['webcam', 'rtsp', 'http']
  protected readonly sourceLabels = SOURCE_LABELS

  protected readonly activatingId = signal<number | null>(null)
  protected readonly message = signal<string | null>(null)
  protected readonly records = signal<CameraRecord[]>([])
  protected readonly saving = signal(false)

  protected readonly newName = signal('')
  protected readonly newType = signal<CameraSourceType>('rtsp')
  protected readonly newUrl = signal('')
  protected readonly newActive = signal(true)
  protected readonly urlHint = computed(() => URL_HINTS[this.newType()])

  protected readonly cameras = computed(() => normalizeWallCameras(this.camerasPoll.data()?.cameras ?? []))
  protected readonly activeId = computed(
    () => this.statusPoll.data()?.camera_id ?? this.cameras().find((c) => c.active)?.id ?? null,
  )
  protected readonly liveCount = computed(
    () => this.cameras().filter((c) => c.status === 'online' || c.status === 'playback').length,
  )

  constructor() {
    void this.loadRecords()
  }

  private flash(text: string) {
    this.message.set(text)
    window.setTimeout(() => this.message.set(null), 3000)
  }

  private async loadRecords() {
    if (!this.auth.isAdmin()) return
    try {
      this.records.set(await api.listCameraRecords())
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not load cameras')
    }
  }

  private async refreshAll() {
    await Promise.all([this.loadRecords(), this.camerasPoll.refresh(), this.statusPoll.refresh()])
  }

  protected async activateCamera(cameraId: number) {
    if (cameraId === this.activeId()) {
      void this.router.navigate(['/monitoring'], { queryParams: { camera: cameraId } })
      return
    }
    this.activatingId.set(cameraId)
    try {
      await api.switchCamera(cameraId)
      await Promise.all([this.camerasPoll.refresh(), this.statusPoll.refresh()])
      void this.router.navigate(['/monitoring'], { queryParams: { camera: cameraId } })
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Failed to switch camera')
    } finally {
      this.activatingId.set(null)
    }
  }

  protected async addCamera() {
    const name = this.newName().trim()
    const url = this.newUrl().trim()
    if (!name) return this.flash('Enter a camera name')
    if (!url) return this.flash(this.newType() === 'webcam' ? 'Enter a device index' : 'Enter a stream URL')
    this.saving.set(true)
    try {
      await api.createCameraRecord({
        camera_name: name,
        source_type: this.newType(),
        url,
        is_active: this.newActive(),
      })
      this.newName.set('')
      this.newUrl.set('')
      await this.refreshAll()
      this.flash(`Added ${name}`)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not add camera')
    } finally {
      this.saving.set(false)
    }
  }

  protected async toggleActive(record: CameraRecord) {
    try {
      await api.updateCameraRecord(record.id, { is_active: !record.is_active })
      await this.refreshAll()
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Update failed')
    }
  }

  protected async removeRecord(record: CameraRecord) {
    if (!window.confirm(`Delete camera "${record.camera_name}"?`)) return
    try {
      await api.deleteCameraRecord(record.id)
      await this.refreshAll()
      this.flash(`Deleted ${record.camera_name}`)
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
