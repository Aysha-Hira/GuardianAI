import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import { api } from '../../shared/services/api'
import type { Alert } from '../../shared/types'
import { CameraBadgeComponent, EmptyStateComponent, StatusBadgeComponent } from '../../shared/ui/common'
import { SeverityBadgeComponent } from '../../shared/ui/severity-badge'
import { parseCameraIdFromAlert } from '../../shared/utils/cameraLabels'
import { ClipStatusBadgeComponent } from './clip-status'

@Component({
  selector: 'app-alert-card',
  imports: [RouterLink, CameraBadgeComponent, SeverityBadgeComponent, StatusBadgeComponent, ClipStatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <a
      routerLink="/incidents"
      [queryParams]="{ alert: alert().id }"
      class="group block rounded-lg border border-guardian-border-subtle bg-guardian-surface/40 p-3 transition hover:border-guardian-border hover:bg-guardian-panel-hover"
    >
    <div class="flex items-start gap-3">
      @if (thumb(); as thumb) {
        <img [src]="evidenceUrl(thumb)" alt="" class="h-12 w-12 shrink-0 rounded-md border border-guardian-border object-cover" />
      }
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-white group-hover:text-guardian-accent">
              {{ isWatchlist() ? 'Watchlist · ' + alert().watchlist_name : alert().event_label }}
            </p>
            @if (isWatchlist()) {
              <p class="mt-0.5 truncate text-xs text-guardian-muted">{{ alert().event_label }}</p>
            }
            @if (!compact()) {
              <p class="mt-1 flex flex-wrap items-center gap-2">
                <app-camera-badge [camera]="alert().camera" [cameraId]="cameraId()" [linkToMonitor]="true" [compact]="true" />
                @if (alert().track_id >= 0) {
                  <span class="text-xs text-guardian-muted">Track #{{ alert().track_id }}</span>
                }
                @if (alert().event_type === 'behavior_anomaly' && alert().anomaly_score != null) {
                  <span class="font-mono text-xs text-guardian-muted">Score {{ alert().anomaly_score!.toFixed(5) }}</span>
                }
              </p>
            }
          </div>
          <span appSeverityBadge [severity]="alert().severity" [label]="alert().severity_label"></span>
        </div>
        <div class="mt-2.5 flex items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span appStatusBadge [status]="alert().status" [label]="alert().status_label"></span>
            <app-clip-status-badge [status]="alert().incident_clip_status" [compact]="true" />
          </div>
          <span class="font-mono text-[11px] tabular-nums text-guardian-muted">{{ alert().time_label }}</span>
        </div>
      </div>
    </div>
    </a>
  `,
})
export class AlertCardComponent {
  readonly alert = input.required<Alert>()
  readonly compact = input(false)
  protected readonly evidenceUrl = api.evidenceUrl
  protected readonly cameraId = computed(() => parseCameraIdFromAlert(this.alert()))
  protected readonly thumb = computed(() => this.alert().focus_snapshot ?? this.alert().full_snapshot)
  protected readonly isWatchlist = computed(
    () => this.alert().event_type === 'watchlist_match' && !!this.alert().watchlist_name,
  )
}

@Component({
  selector: 'app-alert-list',
  imports: [AlertCardComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (items().length === 0) {
      <div appEmptyState message="NO INCIDENTS RECORDED THIS SESSION"></div>
    } @else {
      <div class="flex flex-col gap-2">
        @for (alert of items(); track alert.id) {
          <app-alert-card [alert]="alert" />
        }
      </div>
    }
  `,
})
export class AlertListComponent {
  readonly alerts = input.required<Alert[]>()
  readonly limit = input<number>()
  protected readonly items = computed(() => {
    const sorted = [...this.alerts()].sort((a, b) => b.timestamp - a.timestamp)
    const limit = this.limit()
    return limit ? sorted.slice(0, limit) : sorted
  })
}
