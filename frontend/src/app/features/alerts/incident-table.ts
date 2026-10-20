import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core'
import { Router } from '@angular/router'
import type { Alert } from '../../shared/types'
import { CameraBadgeComponent, EmptyStateComponent, StatusBadgeComponent } from '../../shared/ui/common'
import { IconComponent } from '../../shared/ui/icon'
import { SeverityBadgeComponent } from '../../shared/ui/severity-badge'
import { parseCameraIdFromAlert } from '../../shared/utils/cameraLabels'
import { ClipStatusBadgeComponent } from './clip-status'
import { IncidentEvidenceThumbComponent } from './evidence'

@Component({
  selector: 'app-incident-table',
  imports: [
    CameraBadgeComponent,
    EmptyStateComponent,
    StatusBadgeComponent,
    IconComponent,
    SeverityBadgeComponent,
    ClipStatusBadgeComponent,
    IncidentEvidenceThumbComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (alerts().length === 0) {
      <div appEmptyState message="NO INCIDENTS RECORDED THIS SESSION"></div>
    } @else {
      <div class="panel overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr class="border-b border-guardian-border bg-guardian-surface/80 text-[10px] uppercase tracking-[0.12em] text-guardian-muted">
                <th class="w-14 px-4 py-3.5 font-semibold">Preview</th>
                <th class="px-4 py-3.5 font-semibold">Incident ID</th>
                <th class="px-4 py-3.5 font-semibold">Event</th>
                <th class="px-4 py-3.5 font-semibold">Severity</th>
                <th class="px-4 py-3.5 font-semibold">Camera</th>
                <th class="px-4 py-3.5 font-semibold">Track</th>
                <th class="px-4 py-3.5 font-semibold">Timestamp</th>
                <th class="px-4 py-3.5 font-semibold">Video</th>
                <th class="px-4 py-3.5 font-semibold">Status</th>
                <th class="w-8 px-2 py-3.5" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              @for (alert of alerts(); track alert.id; let i = $index) {
                <tr
                  role="button"
                  tabindex="0"
                  (click)="openAlert(alert.id)"
                  (keydown)="onKey($event, alert.id)"
                  [class]="
                    'group cursor-pointer border-b border-guardian-border-subtle transition last:border-0 ' +
                    (selectedId() === alert.id ? 'bg-guardian-accent/5' : i % 2 === 0 ? 'bg-transparent' : 'bg-guardian-surface/30') +
                    ' hover:bg-guardian-panel-hover/80'
                  "
                >
                  <td class="px-4 py-3"><app-incident-evidence-thumb [alert]="alert" /></td>
                  <td class="px-4 py-3.5">
                    <span class="font-mono text-xs text-guardian-accent">{{ alert.id.slice(0, 8) }}…</span>
                  </td>
                  <td class="px-4 py-3.5">
                    <div class="font-medium text-white">{{ alert.event_label }}</div>
                    @if (alert.event_type === 'watchlist_match' && alert.watchlist_name) {
                      <div class="mt-0.5 text-xs font-medium text-guardian-accent">Watchlist · {{ alert.watchlist_name }}</div>
                    }
                    @if (alert.event_type === 'behavior_anomaly' && alert.anomaly_score != null) {
                      <div class="mt-0.5 font-mono text-xs text-guardian-muted">Score {{ alert.anomaly_score.toFixed(5) }}</div>
                    }
                  </td>
                  <td class="px-4 py-3.5"><span appSeverityBadge [severity]="alert.severity" [label]="alert.severity_label"></span></td>
                  <td class="px-4 py-3.5">
                    <app-camera-badge [camera]="alert.camera" [cameraId]="cameraId(alert)" [linkToMonitor]="true" [compact]="true" />
                  </td>
                  <td class="px-4 py-3.5 font-mono text-xs tabular-nums">{{ alert.track_id >= 0 ? '#' + alert.track_id : '—' }}</td>
                  <td class="px-4 py-3.5 font-mono text-xs tabular-nums text-guardian-muted">{{ alert.time_label }}</td>
                  <td class="px-4 py-3.5"><app-clip-status-badge [status]="alert.incident_clip_status" [compact]="true" /></td>
                  <td class="px-4 py-3.5"><span appStatusBadge [status]="alert.status" [label]="alert.status_label"></span></td>
                  <td class="px-2 py-3.5">
                    <span
                      [class]="
                        'flex h-7 w-7 items-center justify-center rounded-md text-guardian-muted transition ' +
                        (selectedId() === alert.id ? 'text-guardian-accent opacity-100' : 'opacity-40 group-hover:opacity-100 group-hover:text-white')
                      "
                      aria-hidden="true"
                    >
                      <svg appIcon="chevron-right" class="h-4 w-4"></svg>
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class IncidentTableComponent {
  readonly alerts = input.required<Alert[]>()
  readonly selectedId = input<string | null>(null)
  private readonly router = inject(Router)
  protected readonly cameraId = parseCameraIdFromAlert

  protected openAlert(id: string) {
    void this.router.navigate(['/incidents'], { queryParams: { alert: id } })
  }

  protected onKey(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.openAlert(id)
    }
  }
}
