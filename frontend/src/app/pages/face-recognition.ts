import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core'
import {
  BiometricStatusComponent,
  FaceScannerComponent,
  FaceUploaderComponent,
  MatchResultPanelComponent,
  WatchlistFormComponent,
  WatchlistPanelComponent,
  type WatchlistFormValues,
} from '../features/face-recognition/face-ui'
import { api, ApiError } from '../shared/services/api'
import {
  SCAN_PHASES,
  type EnrollmentResult,
  type FaceImageMeta,
  type ScanState,
  type WatchlistEngineStatus,
  type WatchlistEntry,
} from '../shared/types/faceRecognition'
import { PageHeaderComponent, StatCardComponent } from '../shared/ui/common'

@Component({
  selector: 'app-face-recognition',
  imports: [
    BiometricStatusComponent,
    FaceScannerComponent,
    FaceUploaderComponent,
    MatchResultPanelComponent,
    PageHeaderComponent,
    StatCardComponent,
    WatchlistFormComponent,
    WatchlistPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="fr-page space-y-6">
      <div appPageHeader eyebrow="Biometrics" heading="Face Recognition"
        description="Enroll faces to the local watchlist. DeepFace matches live CCTV tracks against stored embeddings.">
        <div class="shrink-0 pt-1">
          <app-biometric-status [scanState]="scanState()" [hasImage]="!!image()" [engine]="engine()" />
        </div>
      </div>

      <div class="fr-stats">
        <div appStatCard label="Watchlist" [value]="entries().length" sub="Enrolled identities" tone="accent" icon="shield"></div>
        <div appStatCard label="Engine" [value]="engineLabel()"
          [sub]="engine()?.enabled ? 'Live matching active' : 'Check DeepFace worker'"
          [tone]="engine()?.enabled ? 'accent' : 'warning'"></div>
        <div appStatCard label="Enrollment" [value]="enrollmentLabel()"
          [sub]="image() ? image()!.fileName : 'Upload a face to begin'"></div>
      </div>

      <div class="fr-layout">
        <div class="fr-main">
          <app-face-uploader [image]="image()" [error]="uploadError()" (imageChange)="image.set($event)"
            (errorChange)="uploadError.set($event)" (resetScan)="resetScan()" />
          <app-face-scanner [image]="image()" [scanState]="scanState()" [progress]="progress()"
            [statusLabel]="statusLabel()" [canScan]="canEnroll()" [isScanning]="isScanning()"
            (scan)="runEnroll()" (reset)="resetScan()" />
          <app-match-result-panel [scanState]="scanState()" [result]="result()" [watchlistCount]="entries().length" />
        </div>
        <aside class="fr-aside">
          <app-watchlist-form [disabled]="!image()" [busy]="isScanning()" (submitted)="handleEnroll($event)" />
          <app-watchlist-panel [entries]="entries()" [selectedId]="selectedId()" [removingIds]="removingIds()"
            (select)="selectedId.set($event)" (remove)="handleRemove($event)" />
        </aside>
      </div>

      @if (toast()) {
        <div class="fr-toast" role="status">{{ toast() }}</div>
      }
    </div>
  `,
})
export class FaceRecognitionPage {
  readonly image = signal<FaceImageMeta | null>(null)
  readonly uploadError = signal<string | null>(null)
  readonly entries = signal<WatchlistEntry[]>([])
  readonly selectedId = signal<string | null>(null)
  readonly removingIds = signal<ReadonlySet<string>>(new Set())
  readonly toast = signal<string | null>(null)
  readonly engine = signal<WatchlistEngineStatus | null>(null)

  readonly scanState = signal<ScanState>('idle')
  readonly progress = signal(0)
  readonly statusLabel = signal('')
  readonly result = signal<EnrollmentResult | null>(null)
  readonly isScanning = computed(() => this.scanState() === 'scanning')
  readonly canEnroll = computed(() => !!this.image() && !this.isScanning())

  private timer: number | null = null
  private enrollAction: (() => Promise<EnrollmentResult>) | null = null
  private readonly removedBackup = new Map<string, WatchlistEntry>()
  private toastTimer: number | null = null

  readonly engineLabel = computed(() => {
    const e = this.engine()
    return e?.enabled ? (e.engine?.model ?? 'ArcFace') : e?.weights?.ready === false ? 'Weights missing' : 'Offline'
  })

  readonly enrollmentLabel = computed(() =>
    this.scanState() === 'scanning' ? 'Processing'
      : this.result()?.success ? 'Saved'
        : this.image() ? 'Ready' : 'Awaiting image')

  constructor() {
    void this.refreshWatchlist()
    void this.refreshEngine()

    effect(() => {
      const hasImage = !!this.image()
      const state = this.scanState()
      if (hasImage && state === 'idle') this.scanState.set('ready')
      if (!hasImage) {
        this.scanState.set('idle')
        this.progress.set(0)
        this.statusLabel.set('')
        this.result.set(null)
      }
    })

    effect((onCleanup) => {
      if (!this.toast()) return
      const id = window.setTimeout(() => this.toast.set(null), 3500)
      onCleanup(() => window.clearTimeout(id))
    })

    inject(DestroyRef).onDestroy(() => {
      this.cancelScan()
      if (this.toastTimer != null) window.clearTimeout(this.toastTimer)
    })
  }

  private async refreshWatchlist() {
    try {
      this.entries.set((await api.getWatchlist()).entries)
    } catch {
      this.entries.set([])
    }
  }

  private async refreshEngine() {
    try {
      this.engine.set(await api.getWatchlistStatus())
    } catch {
      this.engine.set(null)
    }
  }

  private cancelScan() {
    if (this.timer != null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  resetScan() {
    this.cancelScan()
    this.scanState.set(this.image() ? 'ready' : 'idle')
    this.progress.set(0)
    this.statusLabel.set('')
    this.result.set(null)
  }

  async runEnroll() {
    if (!this.image() || this.scanState() === 'scanning') return
    this.cancelScan()
    this.scanState.set('scanning')
    this.progress.set(0)
    this.statusLabel.set(SCAN_PHASES[0].label)
    this.result.set(null)
    const start = Date.now()

    this.timer = window.setInterval(() => {
      const pct = Math.min(92, Math.round(((Date.now() - start) / 5000) * 100))
      this.progress.set(pct)
      const phase = [...SCAN_PHASES].reverse().find((p) => pct >= p.minProgress)
      if (phase) this.statusLabel.set(phase.label)
    }, 50)

    try {
      const res = await (this.enrollAction?.() ??
        Promise.resolve<EnrollmentResult>({ success: false, error: 'Complete the enrollment form first.' }))
      this.cancelScan()
      this.result.set(res)
      if (res.success) {
        this.progress.set(100)
        this.statusLabel.set('WATCHLIST ENTRY SAVED')
        this.scanState.set('complete')
      } else {
        this.statusLabel.set(res.error ?? 'ENROLLMENT FAILED')
        this.scanState.set('error')
      }
    } catch (err) {
      this.cancelScan()
      this.result.set({ success: false, error: err instanceof Error ? err.message : 'Enrollment failed' })
      this.statusLabel.set('ENROLLMENT FAILED')
      this.scanState.set('error')
    }
  }

  handleEnroll(values: WatchlistFormValues) {
    const image = this.image()
    if (!image?.file) {
      this.uploadError.set('Upload a face image before adding to the watchlist.')
      return
    }
    this.enrollAction = async () => {
      try {
        const resp = await api.enrollWatchlist(image.file, {
          name: values.fullName,
          category: values.category,
          risk_level: values.riskLevel,
          notes: values.notes,
        })
        await this.refreshWatchlist()
        void this.refreshEngine()
        this.toast.set(`${resp.entry.name} enrolled (${resp.entry.id})`)
        return { success: true, entry: resp.entry, processing: resp.processing }
      } catch (err) {
        return { success: false, error: err instanceof ApiError ? err.message : 'Could not enroll watchlist entry.' }
      }
    }
    void this.runEnroll()
  }

  private setRemoving(id: string, on: boolean) {
    this.removingIds.update((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  handleRemove(id: string) {
    if (this.removingIds().has(id)) return
    const backup = this.entries().find((e) => e.id === id)
    if (!backup) return

    this.removedBackup.set(id, backup)
    this.setRemoving(id, true)
    this.entries.update((prev) => prev.filter((e) => e.id !== id))
    if (this.selectedId() === id) this.selectedId.set(null)
    this.engine.update((prev) =>
      prev ? { ...prev, watchlist_count: Math.max(0, (prev.watchlist_count ?? 1) - 1) } : prev)

    api.deleteWatchlistEntry(id).then(
      () => {
        this.removedBackup.delete(id)
        this.setRemoving(id, false)
        void this.refreshEngine()
      },
      (err) => {
        const restored = this.removedBackup.get(id)
        this.removedBackup.delete(id)
        if (restored) {
          this.entries.update((prev) =>
            [...prev, restored].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)))
        }
        this.setRemoving(id, false)
        void this.refreshEngine()
        this.toast.set(err instanceof ApiError ? err.message : 'Could not remove entry')
      },
    )
  }
}
