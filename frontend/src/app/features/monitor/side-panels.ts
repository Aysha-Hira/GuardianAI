import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core'
import { api } from '../../shared/services/api'
import type { AlertStatus } from '../../shared/types'
import type { AlertFilter, FocusItem } from '../../shared/types/monitor'
import { SeverityLegendComponent } from '../../shared/ui/common'
import { assignBlobToImage } from '../../shared/utils/blobUrl'
import { EvidenceLightboxComponent } from '../alerts/evidence'
import { MonitorService } from './monitor.service'

@Component({
  selector: 'app-video-upload-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <input #fileInput type="file" class="cam-upload-input"
      accept=".mp4,.avi,.mov,video/mp4,video/quicktime,video/x-msvideo,video/*"
      (change)="onFile($any($event.target).files?.[0])" />
    <button type="button" [class]="'cam-upload-btn cam-upload-btn--' + variant()" (click)="fileInput.click()">
      @if (variant() === 'compact') {
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg>
      }
      <span>{{ label() }}</span>
    </button>
  `,
})
export class VideoUploadControlComponent {
  readonly variant = input<'primary' | 'compact' | 'panel'>('primary')
  readonly label = input('Upload Video')
  private readonly m = inject(MonitorService)
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput')

  protected onFile(file: File | undefined) {
    if (!file) return
    void this.m.uploadFile(file)
    const el = this.fileInput()?.nativeElement
    if (el) el.value = ''
  }
}

@Component({
  selector: 'app-focus-frame-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="focus-viewport">
      @if (!ready()) {
        <div class="focus-idle-msg">Loading focus…</div>
      }
      <img #img [alt]="'Focus track ' + trackId()" [style.display]="ready() ? 'block' : 'none'" />
    </div>
  `,
})
export class FocusFrameImageComponent {
  readonly slotId = input.required<string>()
  readonly trackId = input.required<number>()
  protected readonly ready = signal(false)
  private readonly img = viewChild<ElementRef<HTMLImageElement>>('img')

  constructor() {
    const prevUrl: { current: string | null } = { current: null }
    let timer: number | undefined
    let inflight = false
    let generation = 0

    effect(() => {
      const slot = this.slotId()
      const gen = ++generation
      window.clearInterval(timer)
      const tick = async () => {
        if (gen !== generation || inflight || document.hidden) return
        inflight = true
        try {
          const blob = await api.getFocusFrameBlob(slot)
          if (gen !== generation || !blob?.size) return
          const url = URL.createObjectURL(blob)
          assignBlobToImage(this.img()?.nativeElement ?? null, url, prevUrl, () => {
            if (gen === generation) this.ready.set(true)
          })
        } catch {
        } finally {
          inflight = false
        }
      }
      void tick()
      timer = window.setInterval(() => void tick(), 150)
    })

    inject(DestroyRef).onDestroy(() => {
      generation++
      window.clearInterval(timer)
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current)
    })
  }
}

@Component({
  selector: 'app-incident-focus-panel',
  imports: [FocusFrameImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (m.focusActive()) {
      <section class="incident-focus-shell">
        <p class="panel-label">INCIDENT FOCUS</p>
        @if (focuses().length === 0) {
          <p class="focus-idle-msg">NO ACTIVE INCIDENT</p>
        } @else {
          <div class="incident-focus-grid">
            @for (f of focuses(); track f.slot_id) {
              <article [class]="itemClass(f)">
                <div class="focus-item-header">
                  <span class="focus-item-title">
                    {{ f.camera_id ? 'CCTV ' + pad(f.camera_id) + ' · ' : '' }}{{ f.zone_label }} · Track #{{ f.track_id }}
                  </span>
                  <button type="button" class="source-btn" (click)="m.releaseFocus(f.slot_id)">Release</button>
                </div>
                <app-focus-frame-image [slotId]="f.slot_id" [trackId]="f.track_id" />
                <div class="focus-item-meta">
                  <span class="focus-meta-tag">{{ f.event_label }}</span>
                  <span class="focus-meta-tag">{{ f.zoom }}× zoom</span>
                  <span [class]="'focus-meta-tag' + (f.tracking_status === 'active' ? ' is-active' : '')">{{ f.tracking_label }}</span>
                </div>
              </article>
            }
          </div>
        }
      </section>
    }
  `,
})
export class IncidentFocusPanelComponent {
  protected readonly m = inject(MonitorService)
  protected readonly focuses = computed(() => this.m.focus()?.focuses ?? [])
  protected pad(n: number) {
    return String(n).padStart(2, '0')
  }
  protected itemClass(f: FocusItem) {
    const s = f.tracking_status
    return (
      'incident-focus-item' +
      (s === 'searching' ? ' searching' : '') +
      (s === 'lost' ? ' lost' : '') +
      (s === 'recorded' ? ' recorded' : '')
    )
  }
}

const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'new', label: 'NEW' },
  { id: 'high', label: 'HIGH' },
  { id: 'resolved', label: 'RESOLVED' },
]

@Component({
  selector: 'app-monitor-alerts-panel',
  imports: [SeverityLegendComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <aside class="alerts-panel">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem">
        <p class="panel-label" style="margin: 0">
          ALERTS
          @if (m.alertsNewCount() > 0) {
            <span style="margin-left: 0.45rem; background: var(--m-danger); color: #fff; border-radius: 999px; padding: 0 0.35rem; font-size: 0.62rem">{{ m.alertsNewCount() }}</span>
          }
        </p>
      </div>

      <div class="alerts-filters">
        @for (f of filters; track f.id) {
          <button type="button" [class]="'alert-filter-btn' + (m.alertsFilter() === f.id ? ' active' : '')" (click)="m.alertsFilter.set(f.id)">{{ f.label }}</button>
        }
      </div>

      @if (m.alerts().length === 0) {
        <p class="muted" style="text-align: center; margin: 1rem 0">No alerts this session</p>
      } @else {
        <ul class="alerts-list">
          @for (alert of m.alerts(); track alert.id) {
            <li [class]="'alert-card' + (alert.status === 'new' ? ' alert-card-new' : '')" (click)="m.openAlert(alert.id)"
              (keydown.enter)="m.openAlert(alert.id)" role="button" tabindex="0">
              <div [class]="'alert-card-severity ' + alert.severity">{{ (alert.severity_label || alert.severity).toUpperCase() }}</div>
              <p class="alert-card-event">{{ alert.event_label }}</p>
              <div class="alert-card-meta">
                @if (alert.event_type === 'watchlist_match' && alert.watchlist_name) {
                  Watchlist · {{ alert.watchlist_name }}<br />
                }
                @if (alert.event_type === 'behavior_anomaly' && alert.anomaly_score != null) {
                  Score {{ alert.anomaly_score.toFixed(5) }}<br />
                }
                @if (alert.track_id >= 0) {
                  Track #{{ alert.track_id }}<br />
                }
                {{ alert.camera }}<br />
                {{ alert.video_time || alert.time_label }}
              </div>
              <span [class]="'alert-card-status ' + alert.status">{{ alert.status_label }}</span>
            </li>
          }
        </ul>
      }

      <div class="monitor-alerts-legend">
        <div appSeverityLegend [compact]="true"></div>
      </div>
    </aside>
  `,
})
export class MonitorAlertsPanelComponent {
  protected readonly m = inject(MonitorService)
  protected readonly filters = FILTERS
}

@Component({
  selector: 'app-monitor-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (m.toasts().length > 0) {
      <div class="monitor-toast-stack" role="status" aria-live="polite">
        @for (t of m.toasts(); track t.id) {
          <div class="monitor-toast">{{ t.message }}</div>
        }
      </div>
    }
  `,
})
export class MonitorToastComponent {
  protected readonly m = inject(MonitorService)
}

const MODAL_ACTIONS: Partial<Record<AlertStatus, { status: AlertStatus; label: string; primary?: boolean }[]>> = {
  new: [
    { status: 'acknowledged', label: 'Acknowledge', primary: true },
    { status: 'under_review', label: 'Under Review' },
    { status: 'false_alarm', label: 'False Alarm' },
    { status: 'resolved', label: 'Resolve' },
  ],
  acknowledged: [
    { status: 'under_review', label: 'Under Review', primary: true },
    { status: 'escalated', label: 'Escalate' },
    { status: 'false_alarm', label: 'False Alarm' },
    { status: 'resolved', label: 'Resolve' },
  ],
  under_review: [
    { status: 'escalated', label: 'Escalate', primary: true },
    { status: 'false_alarm', label: 'False Alarm' },
    { status: 'resolved', label: 'Resolve' },
  ],
  escalated: [
    { status: 'resolved', label: 'Resolve', primary: true },
    { status: 'false_alarm', label: 'False Alarm' },
  ],
}

@Component({
  selector: 'app-alert-detail-modal',
  imports: [EvidenceLightboxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (m.selectedAlert(); as alert) {
      <div class="alert-modal-overlay" (click)="m.closeAlert()" role="presentation">
        <div class="alert-modal-card" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem">
            <h2 style="font-size: 1rem">Alert Details</h2>
            <button type="button" class="source-btn" (click)="m.closeAlert()">×</button>
          </div>

          <dl class="alert-detail-grid">
            <dt>Alert ID</dt><dd>{{ alert.id }}</dd>
            <dt>Event</dt><dd>{{ alert.event_label }}</dd>
            <dt>Severity</dt><dd>{{ alert.severity_label }}</dd>
            <dt>Status</dt><dd>{{ alert.status_label }}</dd>
            <dt>Track ID</dt><dd>#{{ alert.track_id }}</dd>
            <dt>Camera</dt><dd>{{ alert.camera }}</dd>
            @if (alert.event_type === 'watchlist_match' && alert.watchlist_name) {
              <dt>Watchlist</dt><dd>{{ alert.watchlist_name }}</dd>
              @if (alert.watchlist_category) {
                <dt>Category</dt><dd>{{ spaces(alert.watchlist_category) }}</dd>
              }
              @if (alert.match_distance != null) {
                <dt>Match distance</dt><dd>{{ alert.match_distance.toFixed(3) }}</dd>
              }
            }
            @if (alert.video_time) {
              <dt>Video Time</dt><dd>{{ alert.video_time }}</dd>
            } @else {
              <dt>Timestamp</dt><dd>{{ alert.time_label }}</dd>
            }
          </dl>

          <div class="alert-evidence-row">
            @if (alert.full_snapshot; as full) {
              <div>
                <p class="muted" style="font-size: 0.65rem; margin-bottom: 0.35rem">Full Scene</p>
                <button type="button" class="alert-evidence-img-btn" (click)="lightbox.set({ src: evidenceUrl(full), alt: 'Full scene', caption: 'Full scene' })">
                  <img [src]="evidenceUrl(full)" alt="Full scene" />
                </button>
              </div>
            }
            @if (alert.focus_snapshot; as focus) {
              <div>
                <p class="muted" style="font-size: 0.65rem; margin-bottom: 0.35rem">Incident Focus</p>
                <button type="button" class="alert-evidence-img-btn" (click)="lightbox.set({ src: evidenceUrl(focus), alt: 'Incident focus', caption: 'Person focus' })">
                  <img [src]="evidenceUrl(focus)" alt="Focus" />
                </button>
              </div>
            }
          </div>

          @if (alert.incident_clip; as clip) {
            <div class="mt-4">
              <p class="muted" style="font-size: 0.65rem; margin-bottom: 0.35rem">Incident Recording (5s before + in-zone)</p>
              <video [src]="recordingUrl(clip)" controls playsinline style="width: 100%; border-radius: 6px; background: #000"></video>
            </div>
          }

          <div class="alert-modal-actions">
            @if (alert.focus_snapshot || alert.full_snapshot || alert.incident_clip) {
              <button type="button" class="alert-action-btn primary" (click)="m.focusFromAlert(alert.id); m.closeAlert()">Focus on Person</button>
            } @else {
              <button type="button" class="alert-action-btn" disabled>No recorded person evidence</button>
            }
            @for (a of actionsFor(alert.status); track a.status) {
              <button type="button" [class]="'alert-action-btn' + (a.primary ? ' primary' : '')" (click)="m.updateAlertStatus(alert.id, a.status)">{{ a.label }}</button>
            }
          </div>
        </div>

        @if (lightbox(); as lb) {
          <app-evidence-lightbox [src]="lb.src" [alt]="lb.alt" [caption]="lb.caption" (closed)="lightbox.set(null)" />
        }
      </div>
    }
  `,
})
export class AlertDetailModalComponent {
  protected readonly m = inject(MonitorService)
  protected readonly lightbox = signal<{ src: string; alt: string; caption: string } | null>(null)
  protected readonly evidenceUrl = api.evidenceUrl
  protected readonly recordingUrl = api.recordingUrl
  protected readonly spaces = (v: unknown) => String(v).replace(/_/g, ' ')
  protected actionsFor(status: AlertStatus) {
    return MODAL_ACTIONS[status] ?? []
  }
}
