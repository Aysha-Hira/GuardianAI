import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core'
import { createPoll, POLL_KEYS } from '../core/polling'
import { api } from '../shared/services/api'
import type { MulticamTransition } from '../shared/types/multicam'
import { ErrorStateComponent, PageHeaderComponent, PanelComponent, StatCardComponent } from '../shared/ui/common'

type VideoMode = 'sequential' | 'camera_01' | 'camera_02' | 'side_by_side'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const PHASE_LABELS: Record<string, string> = {
  idle: 'Ready',
  starting: 'Starting…',
  loading: 'Loading models…',
  camera_1: 'Camera 1 — local tracking',
  camera_2: 'Camera 2 — cross-camera Re-ID',
  writing: 'Writing outputs…',
  completed: 'Completed',
  error: 'Error',
}

const VIDEO_TABS: [VideoMode, string][] = [
  ['sequential', 'Cam 1 then 2'],
  ['camera_01', 'Camera 1'],
  ['camera_02', 'Camera 2'],
  ['side_by_side', 'Side by side'],
]

@Component({
  selector: 'app-multicam-reid',
  imports: [ErrorStateComponent, PageHeaderComponent, PanelComponent, StatCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (poll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      @let status = poll.data();
      @let report = status?.report;
      <div class="multicam-lab space-y-6">
        <div appPageHeader eyebrow="Experiments" heading="Multi-Camera Re-ID Lab"
          description="Offline cross-camera person linking. Camera 1 (HallWide) processes first, then Camera 2 (HallSeg) matches global identities. Does not affect live monitoring.">
          <div class="shrink-0 pt-1">
            <span [class]="'multicam-phase-badge multicam-phase-' + (status?.phase ?? 'idle')">{{ isRunning() ? 'Running' : phaseLabel() }}</span>
          </div>
        </div>

        @if (presets().length > 0) {
          <section appPanel heading="Dataset preset" subtitle="CITIC-MTMC captures — switch to multi-person sessions">
            <div class="multicam-preset-grid">
              @for (preset of presets(); track preset.id) {
                @let isActive = status?.active_preset?.preset_id === preset.id;
                <button type="button" [class]="'multicam-preset-card' + (isActive ? ' is-active' : '')"
                  [disabled]="isRunning() || loadingPreset() !== null" (click)="activatePreset(preset.id)">
                  <span class="multicam-preset-label">{{ preset.label }}</span>
                  <span class="multicam-preset-hint">{{ preset.people_hint }}</span>
                  <span class="multicam-preset-desc">{{ preset.description }}</span>
                  @if (loadingPreset() === preset.id) {
                    <span class="multicam-preset-loading">Loading…</span>
                  } @else if (isActive) {
                    <span class="multicam-preset-active-tag">Active</span>
                  }
                </button>
              }
            </div>
            <p class="multicam-hint">
              CITIC hall captures 1–3 are the same room on different days — use
              <strong class="text-guardian-text">Passage</strong> or
              <strong class="text-guardian-text">Showroom</strong> for a visually different scene.
              Upload your own multi-person videos anytime below.
            </p>
          </section>
        }

        <section appPanel heading="Camera sources" subtitle="Upload two views of the same space — Camera 1 runs first, then Camera 2">
          <div class="multicam-upload-grid">
            @for (s of slots(); track s.slot) {
              <div class="multicam-upload-card">
                <div class="multicam-upload-card-head">
                  <div>
                    <p class="multicam-upload-title">{{ s.label }}</p>
                    <p class="multicam-upload-hint">{{ s.hint }}</p>
                  </div>
                  <span [class]="'multicam-upload-badge' + (s.source?.ready ? ' is-ready' : '')">{{ s.source?.ready ? 'Ready' : 'Missing' }}</span>
                </div>
                @if (s.source?.ready) {
                  <div class="multicam-source-preview">
                    @for (k of [s.videoKey]; track k) {
                      <video [src]="s.src" controls playsinline preload="metadata" class="multicam-source-video"></video>
                    }
                    <p class="multicam-source-meta">{{ s.source?.original_filename ?? 'video.mp4' }} · {{ formatBytes(s.source?.size_bytes) }}</p>
                  </div>
                } @else {
                  <p class="multicam-source-empty">No video uploaded yet.</p>
                }
                <input #fileInput type="file" class="sr-only"
                  accept=".mp4,.avi,.mov,video/mp4,video/quicktime,video/x-msvideo,video/*"
                  [disabled]="isRunning() || uploadingSlot() !== null" (change)="onFile(s.slot, $event)" />
                <button type="button" class="btn-ghost multicam-upload-btn"
                  [disabled]="isRunning() || uploadingSlot() !== null" (click)="fileInput.click()">
                  {{ uploadingSlot() === s.slot ? 'Uploading…' : s.source?.ready ? 'Replace video' : 'Upload video' }}
                </button>
              </div>
            }
          </div>
          <p class="multicam-hint">
            MP4, AVI, or MOV · up to 500 MB each. Or use the sample hall dataset via
            <code class="text-guardian-text">python scripts/download_multicam_dataset.py</code>
          </p>
        </section>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div appStatCard label="Global IDs" [value]="report?.global_identities?.toString() ?? '—'" [loading]="isRunning() && !report"></div>
          <div appStatCard label="Cross-camera links" [value]="report?.cross_camera_transitions?.toString() ?? '—'" [loading]="isRunning() && !report"></div>
          <div appStatCard label="Cam 1 local tracks" [value]="report?.local_tracks_camera_1?.toString() ?? '—'" [loading]="isRunning() && !report"></div>
          <div appStatCard label="Cam 2 local tracks" [value]="report?.local_tracks_camera_2?.toString() ?? '—'" [loading]="isRunning() && !report"></div>
        </div>

        <div class="multicam-lab-grid">
          <section appPanel heading="Run experiment" subtitle="Sequential processing: Camera 1 → Camera 2">
            <div class="multicam-controls">
              <button type="button" class="btn-primary multicam-run-btn"
                [disabled]="isRunning() || !status?.dataset_ready" (click)="runExperiment()">
                {{ isRunning() ? 'Running…' : 'Run Camera 1 → Camera 2' }}
              </button>
            </div>
            @if (report && !isRunning() && (report.local_tracks_camera_1 ?? 0) === 0 && (report.local_tracks_camera_2 ?? 0) === 0) {
              <p class="multicam-error-line">
                Last run found no people. Check that both camera videos show people walking, then run again.
              </p>
            }
            @if (status?.message) {
              <p class="multicam-status-line">{{ status!.message }}</p>
            }
            @if (status?.error) {
              <p class="multicam-error-line">{{ status!.error }}</p>
            }
            @if (message()) {
              <p class="multicam-toast">{{ message() }}</p>
            }
            <p class="multicam-hint">
              Finds every person in both videos, then gives the same person the same Global ID on both
              cameras. A run takes about 4 minutes.
            </p>
          </section>

          <section appPanel heading="Annotated playback" subtitle="Local # + Global # overlays" [noPadding]="true">
            <div class="multicam-video-toolbar">
              @for (t of videoTabs; track t[0]) {
                <button type="button" [class]="'multicam-video-tab' + (videoMode() === t[0] ? ' is-active' : '')"
                  (click)="videoMode.set(t[0])">{{ t[1] }}</button>
              }
            </div>
            <div class="multicam-video-wrap">
              @if (videoSrc(); as src) {
                @for (k of [videoMode() + '-' + outputRevision()]; track k) {
                  <video [src]="src" controls playsinline preload="metadata" class="multicam-video"></video>
                }
              } @else {
                <div class="multicam-video-placeholder">
                  {{ isRunning() ? 'Processing… video will appear when complete.' : 'Run the experiment to generate annotated video.' }}
                </div>
              }
            </div>
          </section>
        </div>

        <section appPanel heading="Cross-camera transitions" subtitle="When the same global ID appears on both cameras">
          @if (transitions().length === 0) {
            <p class="text-sm text-guardian-muted">{{ isRunning() ? 'Waiting for results…' : 'No transitions logged yet.' }}</p>
          } @else {
            <div class="multicam-table-wrap">
              <table class="multicam-table">
                <thead>
                  <tr><th>Global ID</th><th>From</th><th>To</th><th>Similarity</th><th>Gap (s)</th></tr>
                </thead>
                <tbody>
                  @for (t of transitions(); track $index) {
                    <tr>
                      <td>#{{ t.global_id }}</td>
                      <td>{{ t.from_camera }} / Local #{{ t.from_local_track }}</td>
                      <td>{{ t.to_camera }} / Local #{{ t.to_local_track }}</td>
                      <td>{{ t.similarity.toFixed(3) }}</td>
                      <td>{{ t.time_gap_seconds.toFixed(1) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class MultiCamReIdPage {
  readonly poll = createPoll(api.getMulticamStatus, 2000, POLL_KEYS.multicam)
  readonly running = signal(false)
  readonly videoMode = signal<VideoMode>('sequential')
  readonly message = signal<string | null>(null)
  readonly uploadingSlot = signal<1 | 2 | null>(null)
  readonly loadingPreset = signal<string | null>(null)
  readonly videoTabs = VIDEO_TABS
  readonly formatBytes = formatBytes

  readonly isRunning = computed(() => this.running() || !!this.poll.data()?.running)
  readonly transitions = computed(() => (this.poll.data()?.report?.transitions ?? []) as MulticamTransition[])
  readonly presets = computed(() => this.poll.data()?.presets ?? [])
  readonly outputRevision = computed(() => this.poll.data()?.report?.performance?.total_wall_seconds ?? 0)
  readonly phaseLabel = computed(() => {
    const phase = this.poll.data()?.phase
    return PHASE_LABELS[phase ?? 'idle'] ?? phase ?? 'Ready'
  })

  readonly slots = computed(() => {
    const status = this.poll.data()
    const rev = status?.active_preset?.revision
    return ([
      { slot: 1 as const, label: 'Camera 1', hint: 'Wide / entry view', source: status?.camera_1 },
      { slot: 2 as const, label: 'Camera 2', hint: 'Second angle / exit view', source: status?.camera_2 },
    ]).map((s) => ({
      ...s,
      src: api.multicamSourceVideoUrl(s.slot),
      videoKey: `source-${s.slot}-${rev ?? s.source?.size_bytes ?? 0}`,
    }))
  })

  readonly videoSrc = computed(() => {
    const status = this.poll.data()
    const videos = status?.videos ?? status?.report?.videos ?? {}
    const mode = this.videoMode()
    const file = mode === 'sequential' ? videos['sequential']
      : mode === 'camera_01' ? videos['camera_01']
        : mode === 'camera_02' ? videos['camera_02'] : videos['side_by_side']
    if (!file) return null
    const rev = this.outputRevision()
    return rev ? api.multicamVideoUrl(file, rev) : api.multicamVideoUrl(file)
  })

  constructor() {
    effect(() => this.poll.setIntervalMs(this.isRunning() ? 800 : 2000))
  }

  onFile(slot: 1 | 2, e: Event) {
    const input = e.target as HTMLInputElement
    void this.uploadCamera(slot, input.files?.[0])
    input.value = ''
  }

  async runExperiment() {
    this.message.set(null)
    this.running.set(true)
    try {
      await api.runMulticamExperiment({ sequential: true, side_by_side: true, fast_mode: false })
      this.message.set('Run started. Results appear here in about 4 minutes.')
      await this.poll.refresh()
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Failed to start experiment')
    } finally {
      this.running.set(false)
    }
  }

  private async uploadCamera(slot: 1 | 2, file: File | undefined) {
    if (!file) return
    this.message.set(null)
    this.uploadingSlot.set(slot)
    try {
      const result = await api.uploadMulticamVideo(slot, file)
      this.message.set(`Camera ${slot} uploaded: ${result.original_filename}`)
      await this.poll.refresh()
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      this.uploadingSlot.set(null)
    }
  }

  async activatePreset(presetId: string) {
    this.message.set(null)
    this.loadingPreset.set(presetId)
    try {
      const result = await api.activateMulticamPreset(presetId)
      this.message.set(`Loaded dataset: ${result.label} (${result.people_hint})`)
      await this.poll.refresh()
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Failed to load preset')
    } finally {
      this.loadingPreset.set(null)
    }
  }
}
