import {
  ChangeDetectionStrategy,
  Component,
  computed,

  effect,
  ElementRef,

  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { api } from '../../shared/services/api'
import {
  detectFaceLandmarks,
  FACE_OVAL_INDICES,
  NOSE_TIP_INDEX,
  SPY_MESH_EDGES,
} from '../../shared/services/faceLandmarker'
import {
  RISK_LEVEL_LABELS,
  WATCHLIST_CATEGORY_LABELS,
  type EnrollmentResult,
  type FaceImageMeta,
  type RiskLevel,
  type ScanState,
  type WatchlistCategory,
  type WatchlistEngineStatus,
  type WatchlistEntry,
} from '../../shared/types/faceRecognition'
import {
  boundsFromPoints,
  getContainedImageRect,
  mapLandmarksToViewport,
  type Rect,
} from '../../shared/utils/imageLayout'

const CONTENTS = { style: 'display: contents' }

type EngineState = 'offline' | 'weights_missing' | 'ready' | 'scanning' | 'complete' | 'error' | 'no-image'
const STATE_COPY: Record<EngineState, { label: string; detail: string; tone: 'muted' | 'accent' | 'warn' | 'info' }> = {
  offline: { label: 'Engine offline', detail: 'DeepFace worker unavailable', tone: 'warn' },
  weights_missing: { label: 'Model weights missing', detail: 'Run setup_deepface_weights.py (Facenet512 from Hugging Face)', tone: 'warn' },
  'no-image': { label: 'Awaiting image', detail: 'Upload a face to enroll', tone: 'muted' },
  ready: { label: 'DeepFace ready', detail: 'Local watchlist · enrollment active', tone: 'info' },
  scanning: { label: 'Processing…', detail: 'Backend face + embedding', tone: 'accent' },
  complete: { label: 'Enrollment saved', detail: 'Watchlist entry stored locally', tone: 'info' },
  error: { label: 'Enrollment failed', detail: 'See result panel for details', tone: 'warn' },
}

@Component({
  selector: 'app-biometric-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <div [class]="'fr-engine-status fr-engine-status-' + copy().tone + (state() === 'scanning' ? ' is-scanning' : '')"
      role="status" [attr.aria-label]="'Biometric engine: ' + copy().label">
      <span class="fr-engine-status-dot" aria-hidden="true"></span>
      <span class="fr-engine-status-text">
        <strong>{{ copy().label }}</strong>
        <span class="fr-engine-status-detail">{{ engine()?.engine?.model ? engine()!.engine!.model + ' · ' : '' }}{{ copy().detail }}</span>
      </span>
    </div>
  `,
})
export class BiometricStatusComponent {
  readonly scanState = input.required<ScanState>()
  readonly hasImage = input.required<boolean>()
  readonly engine = input<WatchlistEngineStatus | null>(null)
  readonly state = computed<EngineState>(() => {
    const engine = this.engine()
    if (!engine?.enabled && engine?.weights?.ready === false) return 'weights_missing'
    if (!engine?.enabled) return 'offline'
    if (!this.hasImage()) return 'no-image'
    const s = this.scanState()
    if (s === 'scanning') return 'scanning'
    if (s === 'complete') return 'complete'
    if (s === 'error') return 'error'
    return 'ready'
  })
  readonly copy = computed(() => STATE_COPY[this.state()])
}

@Component({
  selector: 'app-match-result-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <section class="fr-panel fr-match-panel" aria-labelledby="match-results-title">
      <div class="fr-panel-head">
        <h3 id="match-results-title" class="fr-panel-title">Enrollment result</h3>
        <span [class]="'fr-panel-badge ' + (result()?.success ? 'live' : 'muted')">{{ badge() }}</span>
      </div>
      <div class="fr-match-body">
        @let r = result();
        @if (scanState() === 'scanning') {
          <div class="fr-match-scan-note fr-match-scan-note-active">
            <p class="fr-match-result-line">PROCESSING WITH DEEPFACE…</p>
            <p class="fr-match-result-muted">Face detection and ArcFace embedding generation run on the Guardian AI backend.</p>
          </div>
        } @else if (r?.success && r?.entry) {
          <div class="fr-match-scan-note">
            <p class="fr-match-result-line">WATCHLIST ENTRY SAVED</p>
            <dl class="fr-detail-list">
              <div><dt>Watchlist ID</dt><dd>{{ r!.entry!.id }}</dd></div>
              <div><dt>Name</dt><dd>{{ r!.entry!.name }}</dd></div>
              <div><dt>Model</dt><dd>{{ r!.processing?.model ?? r!.entry!.model }}</dd></div>
              <div>
                <dt>Match metric</dt>
                <dd>{{ r!.processing?.distance_metric ?? 'cosine' }} · threshold {{ r!.processing?.threshold ?? r!.entry!.match_threshold ?? '—' }}</dd>
              </div>
            </dl>
            <p class="fr-match-result-muted">Live CCTV matching compares cosine distance against this embedding (not a fake confidence score).</p>
          </div>
        } @else if (r?.error) {
          <div class="fr-match-scan-note">
            <p class="fr-match-result-line">ENROLLMENT FAILED</p>
            <p class="fr-match-result-muted">{{ r!.error }}</p>
          </div>
        } @else {
          <div class="fr-match-placeholder">
            <div class="fr-match-icon" aria-hidden="true">◈</div>
            <p class="fr-match-headline">Backend watchlist enrollment</p>
            <p class="fr-match-sub">Upload a consenting test face, complete the scan animation, and enroll via DeepFace.{{ watchlistCount() > 0 ? ' ' + watchlistCount() + ' identities on the local watchlist.' : ' No identities enrolled yet.' }}</p>
          </div>
        }
      </div>
    </section>
  `,
})
export class MatchResultPanelComponent {
  readonly scanState = input.required<ScanState>()
  readonly result = input<EnrollmentResult | null>(null)
  readonly watchlistCount = input(0)
  readonly badge = computed(() =>
    this.scanState() === 'scanning' ? 'Processing'
      : this.result()?.success ? 'Enrolled'
        : this.scanState() === 'error' ? 'Failed' : 'Awaiting')
}

const ACCEPT = ['image/jpeg', 'image/jpg', 'image/png']
const MAX_BYTES = 5 * 1024 * 1024

async function loadImageFile(file: File): Promise<FaceImageMeta> {
  if (!ACCEPT.includes(file.type)) throw new Error('Only JPG, JPEG, and PNG images are supported.')
  if (file.size > MAX_BYTES) throw new Error('Image must be 5 MB or smaller.')
  const objectUrl = URL.createObjectURL(file)
  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Unable to load image. File may be corrupt.'))
      img.src = objectUrl
    })
    return { fileName: file.name, width: dims.width, height: dims.height, objectUrl, file }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

@Component({
  selector: 'app-face-uploader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <section class="fr-panel fr-upload-panel" aria-labelledby="face-upload-title">
      <input #fileInput type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" class="fr-upload-input-hidden"
        aria-label="Upload face image" (change)="onInputChange($event)" />
      <div class="fr-panel-head"><h3 id="face-upload-title" class="fr-panel-title">Face image</h3></div>
      @if (error()) {
        <p class="fr-upload-error" role="alert">{{ error() }}</p>
      }
      @if (image(); as img) {
        <div class="fr-upload-preview-wrap">
          <div class="fr-upload-preview"><img [src]="img.objectUrl" alt="Uploaded face preview" /></div>
          <dl class="fr-upload-meta">
            <div><dt>Filename</dt><dd>{{ img.fileName }}</dd></div>
            <div><dt>Dimensions</dt><dd>{{ img.width }} × {{ img.height }}</dd></div>
          </dl>
          <div class="fr-upload-actions">
            <button type="button" class="fr-btn fr-btn-ghost" (click)="fileInput.click()">Replace</button>
            <button type="button" class="fr-btn fr-btn-danger" (click)="removeImage()">Remove</button>
          </div>
        </div>
      } @else {
        <div [class]="'fr-upload-drop' + (dragging() ? ' dragging' : '')" role="button" tabindex="0"
          (click)="fileInput.click()"
          (keydown)="onKey($event, fileInput)"
          (dragover)="$event.preventDefault(); dragging.set(true)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)">
          <div class="fr-upload-icon" aria-hidden="true">+</div>
          <p class="fr-upload-title-text">Drop face image or click to browse</p>
          <p class="fr-upload-hint">JPG · JPEG · PNG · Max 5 MB</p>
          <button type="button" class="fr-btn fr-btn-ghost" (click)="$event.stopPropagation(); fileInput.click()">Select Image</button>
        </div>
      }
    </section>
  `,
})
export class FaceUploaderComponent {
  readonly image = input<FaceImageMeta | null>(null)
  readonly error = input<string | null>(null)
  readonly imageChange = output<FaceImageMeta | null>()
  readonly errorChange = output<string | null>()
  readonly resetScan = output<void>()
  readonly dragging = signal(false)

  private async handleFile(file: File | undefined) {
    if (!file) return
    this.errorChange.emit(null)
    try {
      const current = this.image()
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl)
      const meta = await loadImageFile(file)
      this.imageChange.emit(meta)
      this.resetScan.emit()
    } catch (err) {
      this.errorChange.emit(err instanceof Error ? err.message : 'Invalid image file.')
    }
  }

  onInputChange(e: Event) {
    const target = e.target as HTMLInputElement
    void this.handleFile(target.files?.[0])
    target.value = ''
  }

  onDrop(e: DragEvent) {
    e.preventDefault()
    this.dragging.set(false)
    void this.handleFile(e.dataTransfer?.files?.[0])
  }

  onKey(e: KeyboardEvent, input: HTMLInputElement) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      input.click()
    }
  }

  removeImage() {
    const current = this.image()
    if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl)
    this.imageChange.emit(null)
    this.errorChange.emit(null)
    this.resetScan.emit()
  }
}

export interface ViewportFaceData {
  points: { x: number; y: number }[]
  bounds: Rect
  noseTip: { x: number; y: number } | null
}

const MESH_POINT_IDS = SPY_MESH_EDGES.flat().filter((v, i, arr) => arr.indexOf(v) === i)

@Component({
  selector: 'app-face-mesh-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    @if (visible()) {
      @let f = faceData()!;
      @let b = f.bounds;
      <div class="fr-face-mesh-layer" aria-hidden="true">
        <div class="fr-face-highlight" [style.left.px]="b.left" [style.top.px]="b.top" [style.width.px]="b.width"
          [style.height.px]="b.height" [style.opacity]="0.35 + meshReveal() * 0.35"></div>

        <svg class="fr-face-mesh-svg" [attr.viewBox]="'0 0 ' + viewportWidth() + ' ' + viewportHeight()"
          [attr.width]="viewportWidth()" [attr.height]="viewportHeight()">
          <defs>
            <radialGradient id="frFaceGlow" [attr.cx]="b.left + b.width / 2" [attr.cy]="b.top + b.height * 0.45"
              [attr.r]="b.width * 0.55" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="rgba(34,211,238,0.16)" />
              <stop offset="100%" stop-color="rgba(34,211,238,0)" />
            </radialGradient>
          </defs>
          <ellipse [attr.cx]="b.left + b.width / 2" [attr.cy]="b.top + b.height * 0.52" [attr.rx]="b.width * 0.42"
            [attr.ry]="b.height * 0.48" fill="url(#frFaceGlow)" class="fr-mesh-glow-ellipse" />
          @for (e of edges(); track e.key) {
            <line [attr.x1]="e.x1" [attr.y1]="e.y1" [attr.x2]="e.x2" [attr.y2]="e.y2" class="fr-mesh-edge"
              [attr.stroke-dasharray]="e.len" [attr.stroke-dashoffset]="e.offset" />
          }
          @for (p of meshPoints(); track p.idx) {
            <g>
              <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.isNose ? 3.2 : 2.2"
                [attr.class]="'fr-mesh-point' + (p.isNose ? ' center' : '')"
                [style.opacity]="pointReveal()" [style.animation-delay]="p.delay" />
              @if (p.isNose) {
                <circle [attr.cx]="p.x" [attr.cy]="p.y" r="8" class="fr-mesh-pulse" [style.opacity]="pointReveal() * 0.6" />
              }
            </g>
          }
        </svg>

        <div class="fr-mesh-frame" [style.left.px]="b.left" [style.top.px]="b.top" [style.width.px]="b.width" [style.height.px]="b.height">
          <span class="fr-mesh-corner tl">+</span>
          <span class="fr-mesh-corner tr">+</span>
          <span class="fr-mesh-corner bl">+</span>
          <span class="fr-mesh-corner br">+</span>
        </div>

        <div class="fr-mesh-scale" [style.left.px]="scaleLeft()" [style.top.px]="b.top + b.height * 0.02"
          [style.height.px]="b.height * 0.96" aria-hidden="true">
          @for (i of ticks; track i) {
            <span class="fr-mesh-scale-tick" [style.animation-delay]="i * 0.08 + 's'"></span>
          }
          <span class="fr-mesh-scale-indicator" [style.top]="8 + (progress() % 100) * 0.72 + '%'"></span>
        </div>

        <div class="fr-mesh-hud">
          <div class="fr-mesh-meta">
            <span>X: {{ meta().x }}</span>
            <span>Y: {{ meta().y }}</span>
            <span>Z: 0.0044</span>
            <span class="fr-mesh-demo-tag">LANDMARK UI</span>
          </div>
          <svg class="fr-mesh-waveform" viewBox="0 0 80 20" preserveAspectRatio="none">
            <polyline class="fr-mesh-wave-line" points="0,10 8,6 16,14 24,4 32,12 40,8 48,15 56,5 64,11 72,7 80,10" />
          </svg>
          <span class="fr-mesh-status">ANALYZING DATA</span>
        </div>
      </div>
    }
  `,
})
export class FaceMeshOverlayComponent {
  readonly active = input(false)
  readonly progress = input(0)
  readonly faceData = input<ViewportFaceData | null>(null)
  readonly viewportWidth = input(0)
  readonly viewportHeight = input(0)
  readonly ticks = Array.from({ length: 12 }, (_, i) => i)

  readonly visible = computed(() =>
    this.active() && !!this.faceData() && this.viewportWidth() > 0 && this.viewportHeight() > 0)
  readonly meshReveal = computed(() => Math.min(1, this.progress() / 55))
  readonly pointReveal = computed(() => Math.min(1, Math.max(0, (this.progress() - 25) / 45)))

  readonly edges = computed(() => {
    const f = this.faceData()
    if (!f) return []
    const reveal = this.meshReveal()
    const out: { key: string; x1: number; y1: number; x2: number; y2: number; len: number; offset: number }[] = []
    SPY_MESH_EDGES.forEach(([a, b], i) => {
      const p1 = f.points[a]
      const p2 = f.points[b]
      if (!p1 || !p2) return
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const edgeProgress = Math.min(1, Math.max(0, reveal * 1.15 - i * 0.025))
      out.push({ key: `e-${a}-${b}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, len, offset: len * (1 - edgeProgress) })
    })
    return out
  })

  readonly meshPoints = computed(() => {
    const f = this.faceData()
    if (!f) return []
    const out: { idx: number; x: number; y: number; isNose: boolean; delay: string }[] = []
    MESH_POINT_IDS.forEach((idx, i) => {
      const p = f.points[idx]
      if (!p) return
      out.push({ idx, x: p.x, y: p.y, isNose: idx === NOSE_TIP_INDEX, delay: `${i * 0.02}s` })
    })
    return out
  })

  readonly scaleLeft = computed(() => {
    const b = this.faceData()?.bounds
    return b ? Math.min(b.left + b.width + 6, this.viewportWidth() - 18) : 0
  })

  readonly meta = computed(() => {
    const f = this.faceData()
    const nose = f ? (f.noseTip ?? f.points[NOSE_TIP_INDEX]) : null
    return {
      x: nose ? (nose.x / this.viewportWidth()).toFixed(4) : '—',
      y: nose ? (nose.y / this.viewportHeight()).toFixed(4) : '—',
    }
  })
}

const SCAN_LOG = [
  'INITIALIZING…',
  'IMAGE ACQUIRED',
  'NORMALIZING INPUT',
  'SEARCHING FACE REGION',
  'EXTRACTING BIOMETRIC FEATURES',
  'MATCH ENGINE UNAVAILABLE',
  'COMPLETE',
]

@Component({
  selector: 'app-face-scanner',
  imports: [FaceMeshOverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <section class="fr-panel fr-scanner-panel" aria-labelledby="face-scanner-title">
      <div class="fr-panel-head">
        <h3 id="face-scanner-title" class="fr-panel-title">Biometric scan</h3>
        @if (image()) {
          <span [class]="'fr-panel-badge' + (isScanning() ? ' scanning' : scanComplete() ? ' complete' : ' ready')">
            {{ isScanning() ? 'SCANNING' : scanComplete() ? 'COMPLETE' : 'IMAGE ACQUIRED' }}
          </span>
        } @else {
          <span class="fr-panel-badge">AWAITING INPUT</span>
        }
      </div>

      <div class="fr-scanner-stage">
        @if (image(); as img) {
          <div class="fr-scanner-viewport-wrap">
            <div #viewport [class]="'fr-scanner-viewport' + (isScanning() ? ' scanning' : '') + (scanComplete() ? ' complete' : '')">
              <img [src]="img.objectUrl" alt="Face scan target"
                [class]="'fr-scanner-image' + (isScanning() ? ' scanning-highlight' : '')" />

              <app-face-mesh-overlay [active]="isScanning() && faceReady()" [progress]="progress()" [faceData]="faceData()"
                [viewportWidth]="viewportSize().width" [viewportHeight]="viewportSize().height" />

              @if (faceReady() && !isScanning()) {
                @let b = faceData()!.bounds;
                <div class="fr-face-detected-frame" aria-hidden="true" [style.left.px]="b.left" [style.top.px]="b.top"
                  [style.width.px]="b.width" [style.height.px]="b.height"></div>
              }

              <div class="fr-scanner-overlay" aria-hidden="true">
                <div class="fr-vignette"></div>
                <div class="fr-scanner-grid"></div>
                <div class="fr-scanner-grid fine"></div>

                <div [class]="'fr-face-target' + (faceReady() ? ' hidden' : '')">
                  <span class="fr-bracket tl"></span>
                  <span class="fr-bracket tr"></span>
                  <span class="fr-bracket bl"></span>
                  <span class="fr-bracket br"></span>
                </div>

                @if (!isScanning() && !faceReady()) {
                  <div class="fr-scanner-reticle">
                    <span class="fr-reticle-ring"></span>
                    <span class="fr-reticle-cross"></span>
                  </div>
                }

                @if (isScanning()) {
                  <div class="fr-scan-beam"></div>
                  <div class="fr-scan-flash"></div>
                } @else {
                  <div class="fr-scanner-labels">
                    <span class="fr-float-label tl">{{ detecting() ? 'LOCATING FACE…' : faceReady() ? 'FACE DETECTED' : 'FACE REGION' }}</span>
                    <span class="fr-float-label tr">SCAN · UI-DEMO</span>
                    <span class="fr-float-label bl">STATUS · {{ detecting() ? 'DETECTING' : isScanning() ? 'ACTIVE' : scanComplete() ? 'DONE' : faceReady() ? 'READY' : 'STANDBY' }}</span>
                    <span class="fr-float-label br">QUALITY · UI DEMO</span>
                  </div>
                  <div class="fr-scan-dots">
                    @for (i of dots; track i) {
                      <span class="fr-scan-dot" [style.animation-delay]="i * 0.12 + 's'"></span>
                    }
                  </div>
                }
              </div>

              @if (isScanning()) {
                <div class="fr-viewport-progress" aria-hidden="true">
                  <svg viewBox="0 0 36 36" class="fr-progress-ring">
                    <path class="fr-progress-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path class="fr-progress-ring-fill" [attr.stroke-dasharray]="progress() + ', 100'"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <span class="fr-viewport-progress-text">{{ progress() }}%</span>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="fr-scanner-empty">
            <div class="fr-scanner-empty-icon" aria-hidden="true">
              <span class="fr-empty-bracket tl"></span>
              <span class="fr-empty-bracket br"></span>
              <span class="fr-empty-reticle"></span>
            </div>
            <p>Upload a face image to begin UI scan sequence.</p>
            <p class="fr-scanner-empty-sub">No biometric processing occurs in this demo.</p>
          </div>
        }

        @if (isScanning() || scanComplete()) {
          <div class="fr-scan-console">
            <div class="fr-progress-block">
              <div class="fr-progress-head">
                <span class="fr-progress-label">{{ statusLabel() || 'INITIALIZING…' }}</span>
                <span class="fr-progress-pct">{{ progress() }}%</span>
              </div>
              <div class="fr-progress-track" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
                <div class="fr-progress-fill" [style.width]="progress() + '%'"><span class="fr-progress-glow"></span></div>
                <div class="fr-progress-ticks" aria-hidden="true">
                  @for (i of progressTicks; track i) {
                    <span></span>
                  }
                </div>
              </div>
            </div>
            <ul class="fr-scan-log" aria-live="polite">
              @for (line of scanLog; track line; let i = $index) {
                <li [class]="'fr-scan-log-line' + (i <= activeLogIndex() ? ' visible' : '') + (i === activeLogIndex() && isScanning() ? ' active' : '')">
                  <span class="fr-scan-log-prefix">&gt;</span> {{ line }}
                </li>
              }
            </ul>
          </div>
        }

        @if (scanComplete()) {
          <div class="fr-scan-complete" role="status">
            <div class="fr-scan-complete-icon" aria-hidden="true">◉</div>
            <p class="fr-scan-complete-title">SCAN COMPLETE</p>
            <p class="fr-scan-complete-engine">BIOMETRIC BACKEND NOT CONNECTED</p>
            <p class="fr-scan-complete-result">NO MATCHING PERFORMED</p>
            <p class="fr-scan-complete-note">UI animation only — no face detection or identity matching occurred.</p>
          </div>
        }

        @if (scanBlocked() && landmarkError()) {
          <p class="fr-landmark-warning" role="status">{{ landmarkError() }}. Use a clear front-facing face photo to enable the scan overlay.</p>
        }
        @if (detecting()) {
          <p class="fr-landmark-detecting" role="status">Locating face landmarks…</p>
        }

        <div class="fr-scanner-actions">
          <button type="button" [class]="'fr-btn fr-btn-primary fr-btn-scan' + (isScanning() ? ' scanning' : '')"
            [disabled]="!canScan() || isScanning() || detecting() || scanBlocked()" (click)="scan.emit()">
            <span class="fr-btn-scan-icon" aria-hidden="true">{{ isScanning() ? '◌' : '◎' }}</span>
            {{ isScanning() ? 'SCANNING…' : scanComplete() ? 'SCAN AGAIN' : 'SCAN FACE' }}
          </button>
          @if (isScanning() || scanComplete()) {
            <button type="button" class="fr-btn fr-btn-ghost" (click)="reset.emit()" [disabled]="isScanning()">Reset</button>
          }
        </div>
      </div>
    </section>
  `,
})
export class FaceScannerComponent {
  readonly image = input<FaceImageMeta | null>(null)
  readonly scanState = input.required<ScanState>()
  readonly progress = input(0)
  readonly statusLabel = input('')
  readonly canScan = input(false)
  readonly isScanning = input(false)
  readonly scan = output<void>()
  readonly reset = output<void>()

  readonly scanLog = SCAN_LOG
  readonly dots = [0, 1, 2, 3, 4, 5, 6]
  readonly progressTicks = Array.from({ length: 20 }, (_, i) => i)

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport')
  readonly viewportSize = signal({ width: 0, height: 0 })
  private readonly rawLandmarks = signal<NormalizedLandmark[] | null>(null)
  readonly detecting = signal(false)
  private readonly detectError = signal<string | null>(null)

  constructor() {
    effect((onCleanup) => {
      const el = this.viewport()?.nativeElement
      if (!el) return
      const update = () => this.viewportSize.set({ width: el.clientWidth, height: el.clientHeight })
      update()
      const observer = new ResizeObserver(update)
      observer.observe(el)
      onCleanup(() => observer.disconnect())
    })

    effect((onCleanup) => {
      const imageUrl = this.image()?.objectUrl ?? null
      untracked(() => {
        if (!imageUrl) {
          this.rawLandmarks.set(null)
          this.detectError.set(null)
          this.detecting.set(false)
          return
        }
        let cancelled = false
        onCleanup(() => { cancelled = true })
        this.detecting.set(true)
        this.detectError.set(null)
        this.rawLandmarks.set(null)
        detectFaceLandmarks(imageUrl)
          .then((landmarks) => {
            if (cancelled) return
            if (!landmarks) {
              this.detectError.set('No face detected in image')
              this.rawLandmarks.set(null)
              return
            }
            this.rawLandmarks.set(landmarks)
          })
          .catch(() => {
            if (!cancelled) {
              this.detectError.set('Face landmark detection unavailable')
              this.rawLandmarks.set(null)
            }
          })
          .finally(() => {
            if (!cancelled) this.detecting.set(false)
          })
      })
    })
  }

  private readonly landmarkResult = computed<{ faceData: ViewportFaceData | null; error: string | null }>(() => {
    const raw = this.rawLandmarks()
    const { width, height } = this.viewportSize()
    const error = this.detectError()
    const img = this.image()
    if (!raw || width <= 0 || height <= 0 || !img) return { faceData: null, error }
    const imageRect = getContainedImageRect({ width, height }, { width: img.width, height: img.height })
    const points = mapLandmarksToViewport(raw, imageRect)
    const ovalPoints = FACE_OVAL_INDICES.map((i) => points[i]).filter(Boolean)
    const bounds = boundsFromPoints(ovalPoints, 0.1)
    if (!bounds) return { faceData: null, error: error ?? 'Could not compute face bounds' }
    return { faceData: { points, bounds, noseTip: points[1] ?? null }, error }
  })

  readonly faceData = computed(() => this.landmarkResult().faceData)
  readonly landmarkError = computed(() => this.landmarkResult().error)
  readonly faceReady = computed(() => !!this.faceData())
  readonly scanComplete = computed(() => this.scanState() === 'complete')
  readonly scanBlocked = computed(() => !!this.image() && !this.detecting() && !this.faceReady())
  readonly activeLogIndex = computed(() =>
    Math.min(SCAN_LOG.length - 1, Math.floor((this.progress() / 100) * (SCAN_LOG.length - 1))))
}

export interface WatchlistFormValues {
  fullName: string
  category: WatchlistCategory
  riskLevel: RiskLevel
  notes: string
}
const DEFAULT_FORM: WatchlistFormValues = { fullName: '', category: 'general', riskLevel: 'medium', notes: '' }

@Component({
  selector: 'app-watchlist-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <section class="fr-panel fr-form-panel" aria-labelledby="watchlist-form-title">
      <div class="fr-panel-head"><h3 id="watchlist-form-title" class="fr-panel-title">Enroll subject</h3></div>
      @for (k of [formKey()]; track k) {
      <form class="fr-form" (submit)="handleSubmit($event)">
        <label class="fr-field">
          <span class="field-label">Full name</span>
          <input class="input-field w-full" [value]="values().fullName" (input)="patch({ fullName: val($event) })"
            placeholder="Enter subject name" [disabled]="locked()" />
        </label>
        <label class="fr-field">
          <span class="field-label">Category</span>
          <select class="input-field w-full" (change)="patch({ category: $any(val($event)) })" [disabled]="locked()">
            @for (c of categories; track c[0]) {
              <option [value]="c[0]" [selected]="values().category === c[0]">{{ c[1] }}</option>
            }
          </select>
        </label>
        <fieldset class="fr-field">
          <legend class="field-label">Risk level</legend>
          <div class="choice-chips">
            @for (r of risks; track r[0]) {
              <label [class]="'choice-chip-radio choice-chip-radio--' + r[0]">
                <input type="radio" name="riskLevel" [value]="r[0]" [checked]="values().riskLevel === r[0]"
                  (change)="patch({ riskLevel: r[0] })" [disabled]="locked()" />
                <span>{{ r[1] }}</span>
              </label>
            }
          </div>
        </fieldset>
        <label class="fr-field">
          <span class="field-label">Notes</span>
          <textarea class="input-field w-full" rows="3" [value]="values().notes" (input)="patch({ notes: val($event) })"
            placeholder="Optional operator notes…" [disabled]="locked()"></textarea>
        </label>
        @if (error()) {
          <p class="fr-form-error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn-primary w-full" [disabled]="locked()">{{ busy() ? 'Enrolling…' : 'Add to watchlist' }}</button>
        <p class="fr-form-foot">DeepFace ArcFace on the backend · stored locally in data/watchlist/</p>
      </form>
      }
    </section>
  `,
})
export class WatchlistFormComponent {
  readonly disabled = input(false)
  readonly busy = input(false)
  readonly submitted = output<WatchlistFormValues>()
  readonly values = signal<WatchlistFormValues>(DEFAULT_FORM)
  readonly error = signal<string | null>(null)
  readonly formKey = signal(0)
  readonly locked = computed(() => this.disabled() || this.busy())
  readonly categories = Object.entries(WATCHLIST_CATEGORY_LABELS) as [WatchlistCategory, string][]
  readonly risks = Object.entries(RISK_LEVEL_LABELS) as [RiskLevel, string][]

  val(e: Event) {
    return (e.target as HTMLInputElement).value
  }

  patch(p: Partial<WatchlistFormValues>) {
    this.values.update((v) => ({ ...v, ...p }))
  }

  handleSubmit(e: Event) {
    e.preventDefault()
    const v = this.values()
    if (!v.fullName.trim()) {
      this.error.set('Full name is required.')
      return
    }
    this.error.set(null)
    this.submitted.emit({ ...v, fullName: v.fullName.trim() })
    this.values.set({ ...DEFAULT_FORM })
    this.formKey.update((k) => k + 1)
  }
}

function formatTime(ts?: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

@Component({
  selector: 'app-watchlist-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: CONTENTS,
  template: `
    <section class="fr-panel fr-watchlist-panel" aria-labelledby="watchlist-title">
      <div class="fr-panel-head">
        <h3 id="watchlist-title" class="fr-panel-title">Watchlist</h3>
        <span class="fr-panel-badge">{{ entries().length }}</span>
      </div>
      @if (entries().length === 0) {
        <p class="fr-watchlist-empty">No enrolled identities yet. Upload a face and enroll a subject to enable live matching.</p>
      } @else {
        <ul class="fr-watchlist-list">
          @for (entry of entries(); track entry.id) {
            @let removing = removingIds().has(entry.id);
            <li [class]="'fr-watchlist-item' + (selectedId() === entry.id ? ' selected' : '') + (removing ? ' is-removing' : '')">
              <button type="button" class="fr-watchlist-view" (click)="select.emit(entry.id)"
                [attr.aria-pressed]="selectedId() === entry.id" [disabled]="removing">
                @if (entry.image_file) {
                  <img [src]="thumbUrl(entry.image_file)" alt="" class="fr-watchlist-thumb" />
                } @else {
                  <span class="fr-watchlist-thumb fr-watchlist-thumb-empty" aria-hidden="true"></span>
                }
                <div class="fr-watchlist-info">
                  <p class="fr-watchlist-name">{{ entry.name }}</p>
                  <p class="fr-watchlist-meta">{{ categoryLabel(entry.category) }} · <span [class]="'fr-risk-tag risk-' + entry.risk_level">{{ riskLabel(entry.risk_level) }}</span></p>
                  <p class="fr-watchlist-time">{{ formatTime(entry.created_at) }}</p>
                </div>
              </button>
              <button type="button" class="fr-watchlist-remove"
                [attr.aria-label]="(removing ? 'Removing ' : 'Remove ') + entry.name" [disabled]="removing"
                (click)="$event.stopPropagation(); remove.emit(entry.id)">
                @if (removing) {
                  <span class="fr-watchlist-remove-spinner" aria-hidden="true"></span>
                } @else {
                  ×
                }
              </button>
            </li>
          }
        </ul>
      }
      @if (selected(); as s) {
        <dl class="fr-watchlist-detail">
          <div><dt>ID</dt><dd>{{ s.id }}</dd></div>
          <div><dt>Model</dt><dd>{{ s.model }}</dd></div>
          @if (s.notes) {
            <div class="fr-watchlist-detail-notes"><dt>Notes</dt><dd>{{ s.notes }}</dd></div>
          }
        </dl>
      }
    </section>
  `,
})
export class WatchlistPanelComponent {
  readonly entries = input<WatchlistEntry[]>([])
  readonly selectedId = input<string | null>(null)
  readonly removingIds = input<ReadonlySet<string>>(new Set())
  readonly select = output<string>()
  readonly remove = output<string>()
  readonly formatTime = formatTime

  readonly selected = computed(() => {
    const s = this.entries().find((e) => e.id === this.selectedId())
    return s && !this.removingIds().has(s.id) ? s : null
  })

  thumbUrl(file: string) {
    return api.watchlistImageUrl(file)
  }
  categoryLabel(c: string) {
    return WATCHLIST_CATEGORY_LABELS[c as WatchlistCategory] ?? c
  }
  riskLabel(r: string) {
    return RISK_LEVEL_LABELS[r as RiskLevel] ?? r
  }
}

