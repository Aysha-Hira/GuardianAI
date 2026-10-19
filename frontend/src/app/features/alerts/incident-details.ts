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
import { NgTemplateOutlet } from '@angular/common'
import { api } from '../../shared/services/api'
import type { Alert, AlertStatus } from '../../shared/types'
import { CameraBadgeComponent, LoadingStateComponent, StatusBadgeComponent } from '../../shared/ui/common'
import { SeverityBadgeComponent } from '../../shared/ui/severity-badge'
import { getAlertActions, type AlertAction } from '../../shared/utils/alertActions'
import { parseCameraIdFromAlert } from '../../shared/utils/cameraLabels'
import { clipIsPending } from './clip-status'
import { IncidentEvidencePanelComponent } from './evidence'

@Component({
  selector: 'app-incident-action-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (open()) {
      <div class="incident-action-dialog-backdrop" role="presentation" (click)="cancel.emit()">
        <div class="incident-action-dialog" role="dialog" aria-modal="true" aria-labelledby="incident-action-dialog-title" (click)="$event.stopPropagation()">
          <div class="incident-action-dialog-icon" aria-hidden="true">
            @if (variant() === 'danger') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            } @else {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            }
          </div>
          <h3 id="incident-action-dialog-title" class="incident-action-dialog-title">{{ heading() }}</h3>
          <p class="incident-action-dialog-message">{{ message() }}</p>
          <div class="incident-action-dialog-actions">
            <button type="button" class="incident-action-dialog-cancel" (click)="cancel.emit()">Cancel</button>
            <button type="button" [class]="'incident-action-dialog-confirm incident-action-dialog-confirm--' + variant()" [disabled]="loading()" (click)="confirm.emit()">
              {{ loading() ? 'Working…' : confirmLabel() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class IncidentActionDialogComponent {
  readonly open = input(false)
  readonly heading = input('')
  readonly message = input('')
  readonly confirmLabel = input('Confirm')
  readonly loading = input(false)
  readonly variant = input<'primary' | 'danger'>('primary')
  readonly confirm = output<void>()
  readonly cancel = output<void>()
}

function actionButtonClass(action: AlertAction): string {
  if (action.status === 'escalated' || action.variant === 'danger') return 'incident-action-btn--danger'
  if (action.variant === 'primary') return 'incident-action-btn--primary'
  return 'incident-action-btn--ghost'
}

@Component({
  selector: 'app-incident-details',
  imports: [
    NgTemplateOutlet,
    CameraBadgeComponent,
    LoadingStateComponent,
    StatusBadgeComponent,
    SeverityBadgeComponent,
    IncidentEvidencePanelComponent,
    IncidentActionDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (alertId()) {
      @if (loading() && !alert()) {
        <aside class="panel w-full shrink-0 lg:w-[22rem] xl:w-96">
          <div appLoadingState></div>
        </aside>
      } @else if (!alert()) {
        <aside class="panel w-full shrink-0 p-5 lg:w-[22rem] xl:w-96">
          <p class="text-sm text-red-400">{{ error() ?? 'Alert not found' }}</p>
          <button type="button" (click)="closed.emit()" class="btn-ghost mt-4">Close</button>
        </aside>
      } @else {
        @let a = alert()!;
        <aside class="panel incident-details-panel sticky top-24 w-full shrink-0 self-start lg:w-[22rem] xl:w-96">
          <div class="panel-header flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-[0.12em] text-guardian-muted">Incident Details</h2>
              <p class="mt-0.5 font-mono text-xs text-guardian-text/70">{{ a.id.slice(0, 12) }}…</p>
            </div>
            <button type="button" (click)="closed.emit()" class="flex h-8 w-8 items-center justify-center rounded-lg text-guardian-muted transition hover:bg-guardian-elevated hover:text-white" aria-label="Close">×</button>
          </div>

          <div class="incident-details-scroll">
            <div class="mb-5 flex flex-wrap gap-2">
              <span appSeverityBadge [severity]="a.severity" [label]="a.severity_label"></span>
              <span appStatusBadge [status]="a.status" [label]="a.status_label"></span>
            </div>

            @if (actions().length > 0) {
              <div class="incident-actions">
                <p class="incident-actions-label">Operator actions</p>
                <div class="incident-action-grid">
                  @for (action of actions(); track action.status) {
                    <button type="button" [disabled]="acting()" (click)="onActionClick(action)" [class]="'incident-action-btn ' + buttonClass(action)">
                      {{ action.label }}
                    </button>
                  }
                </div>
              </div>
            }

            <dl class="space-y-3 rounded-lg border border-guardian-border-subtle bg-guardian-surface/50 p-4 text-sm">
              <ng-template #row let-label="label" let-value="value" let-mono="mono">
                <div class="flex items-start justify-between gap-4">
                  <dt class="shrink-0 text-guardian-muted">{{ label }}</dt>
                  <dd [class]="'text-right ' + (mono ? 'font-mono text-xs tabular-nums' : '')">{{ value }}</dd>
                </div>
              </ng-template>

              <ng-container *ngTemplateOutlet="row; context: { label: 'Event', value: a.event_label }" />
              <div class="flex items-start justify-between gap-4">
                <dt class="shrink-0 text-guardian-muted">Camera</dt>
                <dd class="text-right">
                  <app-camera-badge [camera]="a.camera" [cameraId]="cameraId()" [linkToMonitor]="true" />
                </dd>
              </div>
              <ng-container *ngTemplateOutlet="row; context: { label: 'Track ID', value: '#' + a.track_id, mono: true }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'Timestamp', value: a.time_label, mono: true }" />
              @if (a.video_time) {
                <ng-container *ngTemplateOutlet="row; context: { label: 'Video Time', value: a.video_time, mono: true }" />
              }
              @if (a.zone_label && a.zone_index >= 0) {
                <ng-container *ngTemplateOutlet="row; context: { label: 'Zone', value: a.zone_label }" />
              }
              <ng-container *ngTemplateOutlet="row; context: { label: 'Severity engine', value: a.severity_source === 'random_forest' ? 'Random Forest' : 'Rule-based' }" />
              @if (a.severity_source === 'random_forest' && a.rule_severity && a.rule_severity !== a.severity) {
                <ng-container *ngTemplateOutlet="row; context: { label: 'Rule baseline', value: upper(a.rule_severity) }" />
              }
              @if (a.event_type === 'watchlist_match' && a.watchlist_name) {
                <ng-container *ngTemplateOutlet="row; context: { label: 'Watchlist', value: a.watchlist_name }" />
                @if (a.watchlist_category) {
                  <ng-container *ngTemplateOutlet="row; context: { label: 'Category', value: underscoresToSpaces(a.watchlist_category) }" />
                }
                @if (a.match_distance != null) {
                  <ng-container *ngTemplateOutlet="row; context: { label: 'Match distance', value: a.match_distance.toFixed(3), mono: true }" />
                }
                @if (a.match_threshold != null) {
                  <ng-container *ngTemplateOutlet="row; context: { label: 'Threshold', value: a.match_threshold.toFixed(3), mono: true }" />
                }
              }
              @if (a.event_type === 'behavior_anomaly') {
                @if (a.anomaly_score != null) {
                  <ng-container *ngTemplateOutlet="row; context: { label: 'Anomaly score', value: a.anomaly_score.toFixed(5), mono: true }" />
                }
                @if (a.anomaly_threshold != null) {
                  <ng-container *ngTemplateOutlet="row; context: { label: 'Threshold', value: a.anomaly_threshold.toFixed(5), mono: true }" />
                }
              }
            </dl>

            <div class="mt-5"><app-incident-evidence-panel [alert]="a" /></div>

            @if (a.timeline.length > 0) {
              <div class="mt-5">
                <p class="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-guardian-muted">Status Timeline</p>
                <ol class="relative space-y-0 border-l border-guardian-border pl-4">
                  @for (entry of a.timeline; track $index) {
                    <li class="relative pb-4 last:pb-0">
                      <span class="absolute -left-[calc(1rem+5px)] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-guardian-panel bg-guardian-accent"></span>
                      <p class="text-sm font-medium text-white">{{ entry.status_label }}</p>
                      <p class="font-mono text-[11px] text-guardian-muted">{{ entry.time_label }}</p>
                    </li>
                  }
                </ol>
              </div>
            }

            @if (error()) {
              <p class="mt-3 text-xs text-red-400">{{ error() }}</p>
            }
          </div>
        </aside>

        <app-incident-action-dialog
          [open]="!!pendingAction()?.confirm"
          [heading]="pendingAction()?.confirm?.title ?? ''"
          [message]="pendingAction()?.confirm?.message ?? ''"
          [confirmLabel]="pendingAction()?.confirm?.confirmLabel ?? 'Confirm'"
          [variant]="pendingAction()?.variant === 'danger' ? 'danger' : 'primary'"
          [loading]="acting()"
          (cancel)="pendingAction.set(null)"
          (confirm)="confirmPending()"
        />
      }
    }
  `,
})
export class IncidentDetailsComponent {
  readonly alertId = input<string | null>(null)
  readonly closed = output<void>()
  readonly updated = output<void>()

  protected readonly alert = signal<Alert | null>(null)
  protected readonly loading = signal(false)
  protected readonly error = signal<string | null>(null)
  protected readonly acting = signal(false)
  protected readonly pendingAction = signal<AlertAction | null>(null)

  protected readonly actions = computed(() => {
    const a = this.alert()
    return a ? getAlertActions(a.status) : []
  })
  protected readonly cameraId = computed(() => {
    const a = this.alert()
    return a ? parseCameraIdFromAlert(a) : null
  })
  protected readonly buttonClass = actionButtonClass
  protected readonly upper = (v: unknown) => String(v).toUpperCase()
  protected readonly underscoresToSpaces = (v: unknown) => String(v).replace(/_/g, ' ')
  private readonly clipPending = computed(() => clipIsPending(this.alert()?.incident_clip_status))

  constructor() {
    effect(() => {
      const id = this.alertId()
      untracked(() => {
        if (id) void this.load(id)
        else this.alert.set(null)
      })
    })

    let timer: number | undefined
    effect(() => {
      const id = this.alertId()
      const pending = this.clipPending()
      window.clearInterval(timer)
      timer = undefined
      if (id && pending) timer = window.setInterval(() => void this.load(id), 1500)
    })
    inject(DestroyRef).onDestroy(() => window.clearInterval(timer))
  }

  private async load(id: string) {
    this.loading.set(true)
    this.error.set(null)
    try {
      this.alert.set(await api.getAlert(id))
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load alert')
      this.alert.set(null)
    } finally {
      this.loading.set(false)
    }
  }

  private async runAction(status: AlertStatus) {
    const a = this.alert()
    if (!a) return
    this.acting.set(true)
    try {
      this.alert.set(await api.updateAlertStatus(a.id, status))
      this.updated.emit()
      this.pendingAction.set(null)
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Action failed')
    } finally {
      this.acting.set(false)
    }
  }

  protected onActionClick(action: AlertAction) {
    if (action.confirm) {
      this.pendingAction.set(action)
      return
    }
    void this.runAction(action.status)
  }

  protected confirmPending() {
    const action = this.pendingAction()
    if (action) void this.runAction(action.status)
  }
}
