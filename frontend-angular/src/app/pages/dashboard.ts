import { ChangeDetectionStrategy, Component, computed } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { RouterLink } from '@angular/router'
import { createPoll, POLL_KEYS } from '../core/polling'
import { AlertListComponent } from '../features/alerts/alert-list'
import { areaOption, donutOption, EchartDirective, horizontalBarOption } from '../shared/charts/echart'
import { api } from '../shared/services/api'
import { CctvFeedStatusPanelComponent } from '../shared/ui/cctv-feed-status-panel'
import {
  ChartCardComponent,
  ErrorStateComponent,
  PageHeaderComponent,
  PanelComponent,
  SeverityLegendComponent,
  StatCardComponent,
} from '../shared/ui/common'
import { CCTV_FEED_COUNT, countLiveFeeds } from '../shared/utils/cameraLabels'
import {
  countHighSeverity,
  groupAlertsByHour,
  groupAlertsBySeverity,
  groupAlertsByType,
} from '../shared/utils/chartData'

/** Port of React's pages/Dashboard. */
@Component({
  selector: 'app-dashboard',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    AlertListComponent,
    EchartDirective,
    CctvFeedStatusPanelComponent,
    ChartCardComponent,
    ErrorStateComponent,
    PageHeaderComponent,
    PanelComponent,
    SeverityLegendComponent,
    StatCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (alertsPoll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      <div class="dashboard-page space-y-6">
        <div appPageHeader eyebrow="Operations" heading="Dashboard"
          description="Real-time security operations overview. Statistics refresh every 3 seconds from live backend data.">
          <div class="shrink-0 pt-1">
            @if (newCount() > 0) {
              <span class="inline-flex items-center gap-2 rounded border border-red-900/40 bg-red-950/25 px-3 py-1.5 text-xs font-medium text-red-400">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400"></span>
                {{ newCount() }} unacknowledged
              </span>
            } @else {
              <span class="inline-flex items-center gap-2 rounded border border-guardian-border-subtle bg-guardian-surface px-3 py-1.5 text-xs text-guardian-muted">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                Live data
              </span>
            }
          </div>
        </div>

        @if (newCount() > 0 && latestAlert(); as latest) {
          <div class="dashboard-incident-banner" role="status">
            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-400/90">Latest incident</p>
              <p class="mt-1 truncate text-sm font-medium text-white">{{ latest.event_label }}</p>
              <p class="mt-0.5 text-xs text-guardian-muted">{{ latest.camera }} · {{ latest.time_label }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <a routerLink="/incidents" [queryParams]="{ alert: latest.id }" class="btn-primary text-xs">Open incident</a>
              <a routerLink="/monitoring" class="btn-ghost text-xs">View live feed</a>
            </div>
          </div>
        }

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div appStatCard label="Total Incidents" [value]="alerts().length" [loading]="alertsPoll.loading()" tone="default" icon="activity" sub="This session"></div>
          <div appStatCard label="High Severity" [value]="highSeverity()" [loading]="alertsPoll.loading()" tone="danger" icon="alert-triangle" sub="High + critical"></div>
          <div appStatCard label="Active Tracks" [value]="statusPoll.data()?.active_tracks ?? 0" [loading]="statusPoll.loading()" tone="accent" icon="users" sub="Currently detected"></div>
          <div appStatCard label="CCTV Feeds Live" [value]="feedsLive() + ' / ' + feedCount" [loading]="statusPoll.loading() || camerasPoll.loading()" tone="info" icon="cameras" sub="Webcam + uploaded channels"></div>
        </div>

        <app-cctv-feed-status-panel [cameras]="cameras()" [loading]="camerasPoll.loading()" />

        <div class="grid gap-3 xl:grid-cols-2">
          <div appChartCard heading="Incidents Over Time" [empty]="timeData().length === 0" emptyMessage="No incidents recorded this session">
            <div appEchart [option]="timeOption()" style="height: 220px"></div>
          </div>
          <div appChartCard heading="Alerts by Type" [empty]="typeData().length === 0">
            <div appEchart [option]="typeOption()" style="height: 220px"></div>
          </div>
        </div>

        <div class="grid gap-3 lg:grid-cols-3">
          <div appChartCard heading="Severity Distribution" [empty]="severityData().length === 0">
            <div appEchart [option]="severityOption()" style="height: 180px"></div>
            @if (severityData().length) {
              <div appSeverityLegend [compact]="true" class="mt-2 justify-center"></div>
            }
          </div>

          <section appPanel heading="System Status">
            <dl class="space-y-0">
              <ng-template #row let-label="label" let-value="value" let-ok="ok" let-mono="mono" let-last="last">
                <div [class]="'flex items-center justify-between gap-4 py-2.5 ' + (last ? '' : 'border-b border-guardian-border-subtle')">
                  <dt class="text-sm text-guardian-muted">{{ label }}</dt>
                  <dd class="text-right">
                    @if (ok === true) {
                      <span class="status-pill status-pill-online"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>{{ value }}</span>
                    } @else if (ok === false) {
                      <span class="status-pill status-pill-offline"><span class="h-1.5 w-1.5 rounded-full bg-guardian-muted"></span>{{ value }}</span>
                    } @else {
                      <span [class]="'text-sm font-medium text-white ' + (mono ? 'font-mono text-xs tabular-nums' : '')">{{ value }}</span>
                    }
                  </dd>
                </div>
              </ng-template>
              <ng-container *ngTemplateOutlet="row; context: { label: 'AI Engine', value: 'ONLINE', ok: true }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'Monitor Feed', value: monitorFeed(), ok: !!status()?.camera_active }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'FPS', value: status()?.fps != null ? '' + status()?.fps : '—', mono: true }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'People Detected', value: '' + (status()?.people_count ?? 0) }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'Active Tracks', value: '' + (status()?.active_tracks ?? 0) }" />
              <ng-container *ngTemplateOutlet="row; context: { label: 'CCTV Channels', value: feedsLive() + ' / ' + feedCount + ' live', last: true }" />
            </dl>
          </section>

          <section appPanel heading="Recent Alerts" [subtitle]="alerts().length > 0 ? alerts().length + ' total this session' : undefined">
            @if (alerts().length > 0) {
              <a panelAction routerLink="/incidents" class="text-xs font-medium text-guardian-accent hover:underline">View all</a>
            }
            <app-alert-list [alerts]="alerts()" [limit]="2" />
          </section>
        </div>
      </div>
    }
  `,
})
export class DashboardPage {
  protected readonly alertsPoll = createPoll(() => api.getAlerts(), 3000, POLL_KEYS.alerts)
  protected readonly statusPoll = createPoll(() => api.getStatus(), 3000, POLL_KEYS.status)
  protected readonly camerasPoll = createPoll(() => api.getCameras(), 5000, POLL_KEYS.cameras)
  protected readonly feedCount = CCTV_FEED_COUNT

  protected readonly alerts = computed(() => this.alertsPoll.data()?.alerts ?? [])
  protected readonly cameras = computed(() => this.camerasPoll.data()?.cameras ?? [])
  protected readonly status = this.statusPoll.data
  protected readonly newCount = computed(() => this.alertsPoll.data()?.new_count ?? 0)
  protected readonly latestAlert = computed(() => this.alerts()[0] ?? null)
  protected readonly highSeverity = computed(() => countHighSeverity(this.alerts()))
  protected readonly feedsLive = computed(() => countLiveFeeds(this.cameras()))
  protected readonly monitorFeed = computed(() => {
    const s = this.status()
    return s?.camera_label ?? (s?.camera_active ? 'LIVE' : 'OFFLINE')
  })

  protected readonly timeData = computed(() => groupAlertsByHour(this.alerts()))
  protected readonly typeData = computed(() => groupAlertsByType(this.alerts()))
  protected readonly severityData = computed(() => groupAlertsBySeverity(this.alerts()))

  protected readonly timeOption = computed(() =>
    areaOption(
      this.timeData().map((d) => d.label),
      [{ name: 'Incidents', data: this.timeData().map((d) => d.count), color: '#34d399' }],
    ),
  )
  protected readonly typeOption = computed(() =>
    horizontalBarOption(
      this.typeData().map((d) => d.name),
      this.typeData().map((d) => d.count),
      { name: 'Alerts', color: '#34d399', labelWidth: 130, barSize: 18 },
    ),
  )
  protected readonly severityOption = computed(() =>
    donutOption(this.severityData().map((d) => ({ name: d.name, value: d.value, fill: d.fill }))),
  )
}
