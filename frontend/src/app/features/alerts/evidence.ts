import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core'
import { api } from '../../shared/services/api'
import type { Alert } from '../../shared/types'
import { PortalToBodyDirective } from '../../shared/ui/common'
import { ClipProcessingPanelComponent, ClipStatusBadgeComponent, clipIsPending, clipStatusLabel } from './clip-status'

/** Port of EvidenceLightbox (portalled to <body>, Escape closes, body scroll locked). */
@Component({
  selector: 'app-evidence-lightbox',
  imports: [PortalToBodyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="evidence-lightbox" role="dialog" aria-modal="true" [attr.aria-label]="alt()" (click)="closed.emit()" appPortalToBody>
      <button type="button" class="evidence-lightbox-close" (click)="$event.stopPropagation(); closed.emit()" aria-label="Close">×</button>
      <figure class="evidence-lightbox-figure" (click)="$event.stopPropagation()">
        <img [src]="src()" [alt]="alt()" />
        @if (caption()) {
          <figcaption>{{ caption() }}</figcaption>
        }
      </figure>
    </div>
  `,
})
export class EvidenceLightboxComponent {
  readonly src = input.required<string>()
  readonly alt = input.required<string>()
  readonly caption = input<string>()
  readonly closed = output<void>()

  constructor() {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closed.emit()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    inject(DestroyRef).onDestroy(() => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    })
  }
}

interface LightboxState {
  src: string
  alt: string
  caption: string
}

/** Port of IncidentEvidencePanel. */
@Component({
  selector: 'app-incident-evidence-panel',
  imports: [ClipStatusBadgeComponent, ClipProcessingPanelComponent, EvidenceLightboxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <section class="incident-evidence" aria-labelledby="incident-evidence-title">
      <div class="incident-evidence-head">
        <h3 id="incident-evidence-title" class="incident-evidence-title">Evidence</h3>
        <app-clip-status-badge [status]="alert().incident_clip_status" [compact]="true" />
      </div>

      <app-clip-processing-panel [status]="alert().incident_clip_status" />

      @if (!hasAnyEvidence()) {
        <div class="incident-evidence-empty">
          <p class="text-sm font-medium text-guardian-text">No evidence saved</p>
          <p class="mt-1 text-xs text-guardian-muted">
            Snapshots and incident clips are captured when restricted-zone events trigger recording.
          </p>
        </div>
      } @else {
        <ol class="incident-evidence-steps">
          @if (clipPending()) {
            <li class="incident-evidence-step incident-evidence-step-pending">
              <span class="incident-evidence-step-num">1</span>
              <div>
                <p class="text-sm font-medium text-amber-200">{{ pendingLabel() }}</p>
                <p class="mt-0.5 text-xs text-guardian-muted">Clip includes pre-roll and in-zone footage. Refreshing automatically.</p>
              </div>
            </li>
          }

          @if (alert().incident_clip; as clip) {
            <li class="incident-evidence-step">
              <span class="incident-evidence-step-num">{{ clipPending() ? '2' : '1' }}</span>
              <div class="min-w-0 flex-1">
                <p class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-guardian-muted">Incident recording</p>
                <div class="overflow-hidden rounded-lg border border-guardian-border bg-black/40">
                  <video [src]="recordingUrl(clip)" controls playsinline class="w-full"></video>
                </div>
                <p class="mt-1.5 text-[11px] text-guardian-muted">5s pre-roll plus footage while the person remains in the zone.</p>
              </div>
            </li>
          } @else if (clipFailed()) {
            <li class="incident-evidence-step incident-evidence-step-failed">
              <span class="incident-evidence-step-num">!</span>
              <div>
                <p class="text-sm font-medium text-red-400">Video unavailable</p>
                <p class="mt-0.5 text-xs text-guardian-muted">Encoding failed or the clip was not saved. Snapshots may still be available below.</p>
              </div>
            </li>
          } @else if (clipNone() && !hasSnapshots()) {
            <li class="incident-evidence-step">
              <span class="incident-evidence-step-num">—</span>
              <div>
                <p class="text-sm text-guardian-muted">No incident clip</p>
                <p class="mt-0.5 text-xs text-guardian-muted">Recording may not have started for this event type or channel.</p>
              </div>
            </li>
          }

          @if (alert().full_snapshot || alert().focus_snapshot) {
            <li class="incident-evidence-step">
              <span class="incident-evidence-step-num">{{ hasClip() || clipPending() || clipFailed() ? '2' : '1' }}</span>
              <div class="min-w-0 flex-1">
                <p class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-guardian-muted">Snapshots</p>
                <div class="incident-evidence-snapshots">
                  @if (alert().full_snapshot; as full) {
                    <figure class="incident-evidence-figure">
                      <button type="button" class="incident-evidence-img-btn" aria-label="Expand full scene snapshot"
                        (click)="lightbox.set({ src: evidenceUrl(full), alt: 'Full scene snapshot', caption: 'Full scene' })">
                        <img [src]="evidenceUrl(full)" alt="Full scene snapshot" class="incident-evidence-img" />
                        <span class="incident-evidence-zoom-hint">Click to expand</span>
                      </button>
                      <figcaption>Full scene</figcaption>
                    </figure>
                  }
                  @if (alert().focus_snapshot; as focus) {
                    <figure class="incident-evidence-figure">
                      <button type="button" class="incident-evidence-img-btn" aria-label="Expand person focus snapshot"
                        (click)="lightbox.set({ src: evidenceUrl(focus), alt: 'Person focus snapshot', caption: 'Person focus' })">
                        <img [src]="evidenceUrl(focus)" alt="Person focus snapshot" class="incident-evidence-img" />
                        <span class="incident-evidence-zoom-hint">Click to expand</span>
                      </button>
                      <figcaption>Person focus</figcaption>
                    </figure>
                  }
                </div>
              </div>
            </li>
          }
        </ol>
      }
    </section>

    @if (lightbox(); as lb) {
      <app-evidence-lightbox [src]="lb.src" [alt]="lb.alt" [caption]="lb.caption" (closed)="lightbox.set(null)" />
    }
  `,
})
export class IncidentEvidencePanelComponent {
  readonly alert = input.required<Alert>()
  protected readonly lightbox = signal<LightboxState | null>(null)
  protected readonly evidenceUrl = api.evidenceUrl
  protected readonly recordingUrl = api.recordingUrl

  protected readonly hasClip = computed(() => Boolean(this.alert().incident_clip))
  protected readonly hasSnapshots = computed(() => {
    const a = this.alert()
    return Boolean(a.full_snapshot || a.focus_snapshot || a.face_snapshot)
  })
  protected readonly clipPending = computed(() => clipIsPending(this.alert().incident_clip_status))
  protected readonly clipFailed = computed(() => this.alert().incident_clip_status === 'failed')
  protected readonly clipNone = computed(
    () => !this.hasClip() && !this.clipPending() && this.alert().incident_clip_status !== 'ready',
  )
  protected readonly hasAnyEvidence = computed(
    () => this.hasClip() || this.hasSnapshots() || this.clipPending() || this.clipFailed(),
  )
  protected readonly pendingLabel = computed(() => clipStatusLabel(this.alert().incident_clip_status))
}

/** Port of IncidentEvidenceThumb (table rows — prefers focus, then full scene). */
@Component({
  selector: 'app-incident-evidence-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (filename(); as file) {
      <img [src]="evidenceUrl(file)" alt="" class="incident-thumb" />
    } @else if (pending()) {
      <span class="incident-thumb incident-thumb-pending" title="Recording in progress">
        <span class="incident-thumb-spinner" aria-hidden="true"></span>
      </span>
    } @else {
      <span class="incident-thumb incident-thumb-empty" aria-label="No preview"></span>
    }
  `,
})
export class IncidentEvidenceThumbComponent {
  readonly alert = input.required<Alert>()
  protected readonly evidenceUrl = api.evidenceUrl
  protected readonly filename = computed(() => this.alert().focus_snapshot ?? this.alert().full_snapshot)
  protected readonly pending = computed(() => clipIsPending(this.alert().incident_clip_status))
}
