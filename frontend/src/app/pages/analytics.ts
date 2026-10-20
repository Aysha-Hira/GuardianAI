import { ChangeDetectionStrategy, Component, computed, effect, signal, untracked } from '@angular/core'
import { createPoll, POLL_KEYS } from '../core/polling'
import { barOption, EchartDirective, horizontalBarOption, lineOption } from '../shared/charts/echart'
import { api } from '../shared/services/api'
import type { TrackSummary } from '../shared/types/monitor'
import { IconComponent } from '../shared/ui/icon'
import {
  ChartCardComponent,
  ErrorStateComponent,
  PageHeaderComponent,
  PanelComponent,
  StatCardComponent,
} from '../shared/ui/common'
import {
  buildZoneBreakdown,
  computeAnalyticsSummary,
  formatDuration,
  groupAlertsByStatus,
  groupAlertsByZone,
  groupEventsByType,
  type OperationalPoint,
} from '../shared/utils/chartData'

function summarizeTracks(tracks: TrackSummary[]) {
  const inZoneCount = tracks.filter((t) => t.in_zone).length
  const loiteringCount = tracks.filter((t) => t.loitering_detected).length
  const durations = tracks.map((t) => t.visible_duration).filter((d) => d > 0)
  const avgDuration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0
  return { inZoneCount, loiteringCount, avgDuration }
}

@Component({
  selector: 'app-analytics',
  imports: [
    ChartCardComponent,
    EchartDirective,
    ErrorStateComponent,
    IconComponent,
    PageHeaderComponent,
    PanelComponent,
    StatCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (alertsPoll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      @let s = summary();
      @let ti = trackInsights();
      <div class="analytics-page space-y-6">
        <div appPageHeader eyebrow="Intelligence" heading="Analytics"
          description="Session metrics, incident workflow analysis, and live operational trends. Data reflects the current backend session and resets when the server restarts.">
          <div class="shrink-0 pt-1">
            <span class="inline-flex items-center gap-2 rounded border border-guardian-border-subtle bg-guardian-surface px-3 py-1.5 text-xs text-guardian-muted">
              <svg appIcon="analytics" class="h-3.5 w-3.5 text-guardian-accent"></svg>
              {{ alerts().length }} incidents · {{ zoneEvents().length }} zone events
            </span>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div appStatCard label="Resolution Rate" [value]="s.resolutionRate + '%'" [loading]="alertsPoll.loading()" tone="accent" icon="shield"
            [sub]="(s.resolvedCount + s.falseAlarmCount) + ' closed of ' + s.totalIncidents"></div>
          <div appStatCard label="Open Incidents" [value]="s.openIncidents" [loading]="alertsPoll.loading()"
            [tone]="s.openIncidents > 0 ? 'warning' : 'default'" icon="alert-triangle" sub="Awaiting closure"></div>
          <div appStatCard label="False Alarm Rate" [value]="s.falseAlarmRate + '%'" [loading]="alertsPoll.loading()" tone="default" icon="activity"
            [sub]="s.falseAlarmCount + ' marked false alarm'"></div>
          <div appStatCard label="Avg Response" [value]="s.avgResponseMinutes != null ? s.avgResponseMinutes + 'm' : '—'"
            [loading]="alertsPoll.loading()" tone="info" icon="users" sub="Time to first status change"></div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div appStatCard label="Zone Events" [value]="zoneEvents().length" [loading]="eventsPoll.loading()" tone="default" sub="Raw security detections"></div>
          <div appStatCard label="Tracks in Zone" [value]="ti.inZoneCount" [loading]="tracksPoll.loading()" tone="accent"
            [sub]="ti.loiteringCount + ' loitering flagged'"></div>
          <div appStatCard label="Evidence Captured" [value]="s.withEvidenceCount + '/' + (s.totalIncidents || 0)" [loading]="alertsPoll.loading()"
            tone="info" sub="Incidents with snapshots"></div>
          <div appStatCard label="High Severity Share" [value]="s.highSeverityRate + '%'" [loading]="alertsPoll.loading()" tone="danger"
            sub="High + critical incidents"></div>
        </div>

        <div class="grid gap-3 xl:grid-cols-2">
          <div appChartCard heading="Incidents by Zone" [empty]="zoneData().length === 0" emptyMessage="No zone incidents recorded this session">
            <div appEchart [option]="zoneOption()" style="height: 240px"></div>
          </div>
          <div appChartCard heading="Incident Workflow" [empty]="statusData().length === 0" emptyMessage="No workflow data yet">
            <div appEchart [option]="statusOption()" style="height: 240px"></div>
          </div>
        </div>

        <div class="grid gap-3 xl:grid-cols-2">
          <div appChartCard heading="Zone Event Types" [empty]="eventTypeData().length === 0" emptyMessage="No zone events this session">
            <div appEchart [option]="eventTypeOption()" style="height: 220px"></div>
          </div>
          <div appChartCard heading="Live Operational Activity" [empty]="series().length === 0" emptyMessage="Waiting for live telemetry…">
            <div appEchart [option]="operationalOption()" style="height: 220px"></div>
            @if (statusPoll.data(); as st) {
              <p class="mt-2 text-center text-xs text-guardian-muted">
                Current: {{ st.people_count }} people · {{ st.active_tracks }} tracks · {{ st.fps?.toFixed?.(1) ?? st.fps }} FPS
              </p>
            }
          </div>
        </div>

        <div class="grid gap-3 lg:grid-cols-3">
          <section appPanel heading="Zone Breakdown" subtitle="Entry vs loitering by restricted zone" class="lg:col-span-2">
            @if (zoneBreakdown().length === 0) {
              <p class="text-sm text-guardian-muted">No zone activity recorded yet.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="analytics-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th class="text-right">Entries</th>
                      <th class="text-right">Loitering</th>
                      <th class="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of zoneBreakdown(); track row.zone) {
                      <tr>
                        <td>{{ row.zone }}</td>
                        <td class="text-right tabular-nums text-guardian-muted">{{ row.entries }}</td>
                        <td class="text-right tabular-nums text-guardian-muted">{{ row.loitering }}</td>
                        <td class="text-right tabular-nums font-medium text-white">{{ row.total }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <section appPanel heading="Track Insights" subtitle="Live detection summary">
            <dl class="space-y-0">
              @for (row of insightRows(); track row.label; let last = $last) {
                <div [class]="'flex items-center justify-between gap-4 py-2.5 ' + (last ? '' : 'border-b border-guardian-border-subtle')">
                  <dt class="text-sm text-guardian-muted">{{ row.label }}</dt>
                  <dd class="text-sm font-medium tabular-nums text-white">{{ row.value }}</dd>
                </div>
              }
            </dl>
          </section>
        </div>

        <section appPanel heading="Recent Incident Timeline" subtitle="Latest alerts with workflow status">
          @if (alerts().length === 0) {
            <p class="text-sm text-guardian-muted">No incidents to analyze yet.</p>
          } @else {
            <div class="overflow-x-auto">
              <table class="analytics-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Zone</th>
                    <th>Track</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th class="text-right">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  @for (alert of recentAlerts(); track alert.id) {
                    <tr>
                      <td class="whitespace-nowrap text-guardian-muted">{{ alert.time_label }}</td>
                      <td>{{ alert.event_label }}</td>
                      <td class="text-guardian-muted">{{ alert.zone_label }}</td>
                      <td class="tabular-nums text-guardian-muted">#{{ alert.track_id }}</td>
                      <td><span [class]="'analytics-severity analytics-severity-' + alert.severity">{{ alert.severity_label }}</span></td>
                      <td><span [class]="'analytics-status analytics-status-' + alert.status">{{ alert.status_label }}</span></td>
                      <td class="text-right">
                        @if (alert.full_snapshot || alert.focus_snapshot) {
                          <span class="text-xs text-emerald-400">Captured</span>
                        } @else {
                          <span class="text-xs text-guardian-muted">—</span>
                        }
                      </td>
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
export class AnalyticsPage {
  readonly alertsPoll = createPoll(() => api.getAlerts(), 4000, POLL_KEYS.alerts)
  readonly eventsPoll = createPoll(api.getZoneEvents, 4000, POLL_KEYS.zoneEvents)
  readonly tracksPoll = createPoll(api.getTrackSummaries, 4000, POLL_KEYS.tracks)
  readonly settingsPoll = createPoll(api.getSettings, 10000, POLL_KEYS.settings)
  readonly statusPoll = createPoll(api.getStatus, 3000, POLL_KEYS.status)

  readonly series = signal<OperationalPoint[]>([])

  constructor() {
    effect(() => {
      const status = this.statusPoll.data()
      if (!status) return
      untracked(() => {
        const label = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        this.series.update((prev) => {
          const next = [...prev, {
            label,
            people: status.people_count,
            tracks: status.active_tracks,
            fps: Math.round(status.fps * 10) / 10,
          }]
          return next.length > 48 ? next.slice(-48) : next
        })
      })
    })
  }

  readonly alerts = computed(() => this.alertsPoll.data()?.alerts ?? [])
  readonly zoneEvents = computed(() => this.eventsPoll.data() ?? [])
  readonly summary = computed(() => computeAnalyticsSummary(this.alerts()))
  readonly zoneData = computed(() => groupAlertsByZone(this.alerts()))
  readonly statusData = computed(() => groupAlertsByStatus(this.alerts()))
  readonly eventTypeData = computed(() => groupEventsByType(this.zoneEvents()))
  readonly zoneBreakdown = computed(() => buildZoneBreakdown(this.alerts()))
  readonly trackInsights = computed(() => summarizeTracks(this.tracksPoll.data() ?? []))
  readonly recentAlerts = computed(() => [...this.alerts()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8))

  readonly insightRows = computed(() => {
    const ti = this.trackInsights()
    const threshold = this.settingsPoll.data()?.loitering_threshold_seconds
    return [
      { label: 'Active tracks', value: String(this.tracksPoll.data()?.length ?? 0) },
      { label: 'In restricted zone', value: String(ti.inZoneCount) },
      { label: 'Loitering flagged', value: String(ti.loiteringCount) },
      { label: 'Avg track duration', value: ti.avgDuration > 0 ? formatDuration(ti.avgDuration) : '—' },
      { label: 'Loitering threshold', value: threshold != null ? `${threshold}s` : '—' },
    ]
  })

  readonly zoneOption = computed(() => {
    const d = this.zoneData()
    return horizontalBarOption(d.map((x) => x.name), d.map((x) => x.count), {
      name: 'Incidents', color: d.map((x) => x.fill ?? '#34d399'), labelWidth: 120, barSize: 20,
    })
  })

  readonly statusOption = computed(() => {
    const d = this.statusData()
    return horizontalBarOption(d.map((x) => x.name), d.map((x) => x.count), {
      name: 'Incidents', color: d.map((x) => x.fill), labelWidth: 120, barSize: 20,
    })
  })

  readonly eventTypeOption = computed(() => {
    const d = this.eventTypeData()
    return barOption(d.map((x) => x.name), [
      { name: 'Events', data: d.map((x) => x.count), color: d.map((x) => x.fill ?? '#60a5fa') },
    ], { barSize: 36 })
  })

  readonly operationalOption = computed(() => {
    const s = this.series()
    const opt = lineOption(s.map((p) => p.label), [
      { name: 'People', data: s.map((p) => p.people), color: '#34d399' },
      { name: 'Tracks', data: s.map((p) => p.tracks), color: '#60a5fa' },
    ], { legend: true })
    return {
      ...opt,
      grid: { top: 8, right: 8, left: 0, bottom: 28, containLabel: true },
      legend: { bottom: 0, textStyle: { color: '#7a8499', fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 3 },
    }
  })
}
