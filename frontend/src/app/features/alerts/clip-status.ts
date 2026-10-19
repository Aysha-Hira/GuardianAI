import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import type { Alert } from '../../shared/types'

export type IncidentClipStatus = Alert['incident_clip_status']

export function clipIsPending(status: IncidentClipStatus | undefined): boolean {
  return status === 'recording' || status === 'processing'
}

export function clipStatusLabel(status: IncidentClipStatus | undefined, compact = false): string | null {
  switch (status) {
    case 'recording':
      return compact ? 'Recording' : 'Recording incident…'
    case 'processing':
      return compact ? 'Processing' : 'Processing video…'
    case 'ready':
      return compact ? 'Ready' : 'Video ready'
    case 'failed':
      return compact ? 'Failed' : 'Video unavailable'
    default:
      return null
  }
}

/** Port of IncidentClipStatusBadge (renders nothing when there is no label, like React). */
@Component({
  selector: 'app-clip-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (label(); as label) {
      <span [class]="'clip-status-badge clip-status-badge--' + tone()">
        @if (pending()) {
          <span class="clip-status-badge-spinner" aria-hidden="true"></span>
        }
        @if (status() === 'ready') {
          <span class="clip-status-badge-icon" aria-hidden="true">▶</span>
        }
        {{ label }}
      </span>
    }
  `,
})
export class ClipStatusBadgeComponent {
  readonly status = input<IncidentClipStatus | undefined>()
  readonly compact = input(false)
  protected readonly label = computed(() => clipStatusLabel(this.status(), this.compact()))
  protected readonly pending = computed(() => clipIsPending(this.status()))
  protected readonly tone = computed(() => {
    const s = this.status()
    return this.pending() ? 'pending' : s === 'failed' ? 'failed' : s === 'ready' ? 'ready' : 'none'
  })
}

/** Port of IncidentClipProcessingPanel. */
@Component({
  selector: 'app-clip-processing-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (pending()) {
      <div class="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" aria-hidden="true"></span>
          <div>
            <p class="text-sm font-medium text-amber-200">{{ label() }}</p>
            <p class="mt-1 text-[11px] text-guardian-muted">
              @if (status() === 'recording') {
                Capturing pre-roll and in-zone footage. The video will appear when the person leaves the zone.
              } @else {
                Encoding the incident clip for playback. This usually takes a few seconds.
              }
            </p>
          </div>
        </div>
      </div>
    }
  `,
})
export class ClipProcessingPanelComponent {
  readonly status = input<IncidentClipStatus | undefined>()
  protected readonly pending = computed(() => clipIsPending(this.status()))
  protected readonly label = computed(() => clipStatusLabel(this.status(), false))
}
