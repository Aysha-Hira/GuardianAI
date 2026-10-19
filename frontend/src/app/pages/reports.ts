import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core'
import { AuthService } from '../core/auth.service'
import { createPoll, POLL_KEYS } from '../core/polling'
import { ReportChartCaptureComponent } from '../features/reports/report-chart-capture'
import { donutOption, EchartDirective } from '../shared/charts/echart'
import { api } from '../shared/services/api'
import type { AlertSeverity } from '../shared/types'
import {
  DEFAULT_REPORT_CONFIG,
  type ReportConfig,
  type ReportFormat,
  type ReportTemplate,
} from '../shared/types/reports'
import { ErrorStateComponent, PageHeaderComponent, PanelComponent, StatCardComponent } from '../shared/ui/common'
import { IconComponent, type IconName } from '../shared/ui/icon'
import { computeAnalyticsSummary } from '../shared/utils/chartData'
import { captureChartElement, chartDataForReport, exportReport } from '../shared/utils/reportExport'
import {
  buildCameraLabel,
  buildPeriodLabel,
  filterAlertsForReport,
  suggestedReportTitle,
} from '../shared/utils/reportFilters'

const TEMPLATES: { id: ReportTemplate; label: string; desc: string; icon: IconName }[] = [
  { id: 'incident_summary', label: 'Incident Summary', desc: 'Analytics, evidence, workflow stats', icon: 'incidents' },
  { id: 'camera_activity', label: 'Camera Activity', desc: 'Per-channel breakdown', icon: 'cameras' },
  { id: 'clearance', label: 'Clearance', desc: 'No-incident formal report', icon: 'check-circle' },
]

const FORMATS: { id: ReportFormat; label: string; ext: string }[] = [
  { id: 'pdf', label: 'PDF', ext: '.pdf' },
  { id: 'docx', label: 'Word', ext: '.docx' },
  { id: 'xlsx', label: 'Excel', ext: '.xlsx' },
]

type ToggleKey = 'includeExecutiveSummary' | 'includeCharts' | 'includeIncidentTable' | 'includeSnapshots' | 'includeZoneBreakdown'
const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'includeExecutiveSummary', label: 'Executive summary' },
  { key: 'includeCharts', label: 'Analytics charts' },
  { key: 'includeIncidentTable', label: 'Incident table' },
  { key: 'includeSnapshots', label: 'Evidence snapshots' },
  { key: 'includeZoneBreakdown', label: 'Zone breakdown' },
]

@Component({
  selector: 'app-reports',
  imports: [
    EchartDirective,
    ErrorStateComponent,
    IconComponent,
    PageHeaderComponent,
    PanelComponent,
    ReportChartCaptureComponent,
    StatCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (poll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      @let c = config();
      @let s = summary();
      @let initialLoading = poll.loading() && !poll.data();
      <div class="reports-page space-y-6">
        <div appPageHeader eyebrow="Intelligence" heading="Reports"
          description="Build and export incident reports for any period, camera, or clearance window.">
          <div class="shrink-0 pt-1">
            <span class="inline-flex items-center gap-2 rounded-full border border-guardian-border-subtle bg-guardian-panel px-3 py-1.5 text-xs text-guardian-muted">
              <svg appIcon="reports" class="h-3.5 w-3.5 text-guardian-accent"></svg>
              {{ initialLoading ? 'Loading…' : filtered().length + ' incident' + (filtered().length === 1 ? '' : 's') + ' in scope' }}
            </span>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <div appStatCard label="In scope" [value]="initialLoading ? '—' : filtered().length" [sub]="periodLabel()" tone="accent" icon="reports"></div>
          <div appStatCard label="Open" [value]="s.openIncidents" [loading]="initialLoading" [tone]="s.openIncidents > 0 ? 'warning' : 'default'"></div>
          <div appStatCard label="Resolution rate" [value]="s.resolutionRate + '%'" [loading]="initialLoading" [sub]="s.resolvedCount + ' closed'" tone="accent"></div>
        </div>

        <div class="reports-layout">
          <aside class="reports-sidebar">
            <section appPanel heading="Report setup" [noPadding]="true">
              <div class="reports-sidebar-inner">
                <div class="reports-block">
                  <p class="reports-block-label">Template</p>
                  <div class="reports-template-grid">
                    @for (t of templates; track t.id) {
                      <button type="button" [class]="'reports-template-card' + (c.template === t.id ? ' is-active' : '')" (click)="applyTemplate(t.id)">
                        <span class="reports-template-icon"><svg [appIcon]="t.icon" class="h-4 w-4" aria-hidden="true"></svg></span>
                        <span class="reports-template-name">{{ t.label }}</span>
                      </button>
                    }
                  </div>
                  <p class="reports-block-hint">{{ templateDesc() }}</p>
                </div>

                <div class="reports-block">
                  <p class="reports-block-label">Export as</p>
                  <div class="segment-control">
                    @for (f of formats; track f.id) {
                      <button type="button" [class]="'segment-btn' + (c.format === f.id ? ' is-active' : '')" (click)="patch({ format: f.id })">
                        <span>{{ f.label }}</span>
                        <span class="segment-btn-ext">{{ f.ext }}</span>
                      </button>
                    }
                  </div>
                </div>

                <div class="reports-block reports-fields">
                  <label class="reports-field">
                    <span class="field-label">Report title</span>
                    <input class="input-field w-full" [value]="c.title" (input)="patch({ title: val($event) })" />
                  </label>
                  <div class="reports-field-pair">
                    <label class="reports-field">
                      <span class="field-label">From</span>
                      <input type="date" class="input-field w-full" [value]="c.dateFrom" (input)="patch({ dateFrom: val($event) })" />
                    </label>
                    <label class="reports-field">
                      <span class="field-label">To</span>
                      <input type="date" class="input-field w-full" [value]="c.dateTo" (input)="patch({ dateTo: val($event) })" />
                    </label>
                  </div>
                </div>

                <button type="button" class="reports-advanced-toggle" (click)="showAdvanced.set(!showAdvanced())" [attr.aria-expanded]="showAdvanced()">
                  {{ showAdvanced() ? 'Hide filters & sections' : 'Filters & sections' }}
                </button>

                @if (showAdvanced()) {
                  <div class="reports-advanced">
                    <div class="reports-block">
                      <p class="reports-block-label">Cameras</p>
                      <div class="choice-chips">
                        @for (id of cameraOptions; track id) {
                          <button type="button" [class]="'choice-chip' + (c.cameras.includes(id) ? ' is-active' : '')" (click)="toggleCamera(id)">CCTV 0{{ id }}</button>
                        }
                      </div>
                    </div>
                    <div class="reports-block">
                      <p class="reports-block-label">Severity</p>
                      <div class="choice-chips">
                        @for (sev of severityOptions; track sev) {
                          <button type="button" [class]="'choice-chip choice-chip--' + sev + (c.severities.includes(sev) ? ' is-active' : '')" (click)="toggleSeverity(sev)">{{ sev }}</button>
                        }
                      </div>
                    </div>
                    <label class="reports-field">
                      <span class="field-label">Prepared by</span>
                      <input class="input-field w-full" [value]="c.preparedBy" (input)="patch({ preparedBy: val($event) })"
                        [placeholder]="auth.user()?.name ?? 'Operator name'" />
                    </label>
                    <div class="reports-toggles">
                      @for (t of toggles; track t.key) {
                        @let on = c[t.key];
                        @let off = t.key === 'includeSnapshots' && isEmpty();
                        <label [class]="'reports-toggle' + (on ? ' is-on' : '') + (off ? ' is-disabled' : '')">
                          <span>{{ t.label }}</span>
                          <button type="button" role="switch" [attr.aria-checked]="on" [attr.aria-label]="t.label" [disabled]="off"
                            (click)="setToggle(t.key, !on)" [class]="'reports-switch' + (on ? ' on' : '')">
                            <span class="reports-switch-dot"></span>
                          </button>
                        </label>
                      }
                    </div>
                  </div>
                }

                <div class="reports-generate">
                  <button type="button" class="reports-generate-btn" [disabled]="generating()" (click)="handleGenerate()">
                    @if (generating()) {
                      <span class="reports-spinner" aria-hidden="true"></span>
                      Generating…
                    } @else {
                      Download {{ c.format.toUpperCase() }}
                    }
                  </button>
                  @if (genError()) {
                    <p class="reports-msg error">{{ genError() }}</p>
                  }
                  @if (genSuccess()) {
                    <p class="reports-msg success">{{ genSuccess() }}</p>
                  }
                </div>
              </div>
            </section>
          </aside>

          <div class="reports-preview-wrap">
            <p class="reports-preview-eyebrow">Live preview</p>
            <div [class]="'reports-preview' + (isEmpty() ? ' is-clearance' : '')">
              <header class="reports-preview-cover">
                <div class="reports-preview-brand">
                  <svg appIcon="shield" class="h-4 w-4"></svg>
                  GUARDIAN AI
                </div>
                <h2 class="reports-preview-heading">{{ c.title }}</h2>
                <dl class="reports-preview-meta">
                  <div><dt>Period</dt><dd>{{ periodLabel() }}</dd></div>
                  <div><dt>Cameras</dt><dd>{{ cameraLabel() }}</dd></div>
                  <div><dt>Format</dt><dd>{{ c.format.toUpperCase() }}</dd></div>
                  <div><dt>Prepared by</dt><dd>{{ c.preparedBy || auth.user()?.name || '—' }}</dd></div>
                </dl>
              </header>

              @if (isEmpty()) {
                <div class="reports-clearance">
                  <span class="reports-clearance-mark">✓</span>
                  <div>
                    <p class="reports-clearance-title">Clearance period</p>
                    <p class="reports-clearance-body">No incidents match your filters. Export will document normal operations.</p>
                  </div>
                </div>
              } @else {
                <div class="reports-kpi-row">
                  @for (k of kpis(); track k[0]) {
                    <div class="reports-kpi"><span>{{ k[0] }}</span><strong>{{ k[1] }}</strong></div>
                  }
                </div>
              }

              @if (c.includeExecutiveSummary) {
                <section class="reports-preview-block">
                  <h3>Executive summary</h3>
                  <p>{{ isEmpty() ? 'No security incidents recorded for this scope.' : s.totalIncidents + ' incident(s) · ' + s.resolutionRate + '% resolution · ' + s.highSeverityRate + '% high severity.' }}</p>
                </section>
              }

              @if (c.includeCharts && !isEmpty()) {
                <section class="reports-preview-block">
                  <h3>Severity breakdown</h3>
                  <div class="reports-chart"><div appEchart [option]="pieOption()" style="height: 160px"></div></div>
                </section>
              }

              @if (c.includeIncidentTable) {
                <section class="reports-preview-block">
                  <h3>Incident log</h3>
                  @if (isEmpty()) {
                    <p class="reports-empty">No rows for this scope.</p>
                  } @else {
                    <div class="reports-table-scroll">
                      <table class="reports-table">
                        <thead><tr><th>Time</th><th>Event</th><th>Camera</th><th>Severity</th></tr></thead>
                        <tbody>
                          @for (a of filtered().slice(0, 6); track a.id) {
                            <tr><td>{{ a.time_label }}</td><td>{{ a.event_label }}</td><td>{{ a.camera }}</td><td>{{ a.severity_label }}</td></tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    @if (filtered().length > 6) {
                      <p class="reports-table-more">+{{ filtered().length - 6 }} more in export</p>
                    }
                  }
                </section>
              }

              @if (c.includeSnapshots && !isEmpty()) {
                <section class="reports-preview-block">
                  <h3>Evidence</h3>
                  <div class="reports-thumbs">
                    @for (a of evidence().slice(0, 3); track a.id) {
                      <figure class="reports-thumb">
                        <img [src]="evidenceUrl(a.focus_snapshot ?? a.full_snapshot!)" alt="" />
                        <figcaption>{{ a.event_label }}</figcaption>
                      </figure>
                    }
                    @if (evidence().length === 0) {
                      <p class="reports-empty">No snapshots in scope.</p>
                    }
                  </div>
                </section>
              }

              <footer class="reports-preview-foot">Guardian AI · Confidential · Session data</footer>
            </div>
          </div>
        </div>

        <app-report-chart-capture [alerts]="filtered()" />
      </div>
    }
  `,
})
export class ReportsPage {
  readonly auth = inject(AuthService)
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  readonly poll = createPoll(() => api.getAlerts(), 4000, POLL_KEYS.alerts)

  readonly config = signal<ReportConfig>({ ...DEFAULT_REPORT_CONFIG, preparedBy: this.auth.user()?.name ?? '' })
  readonly generating = signal(false)
  readonly genError = signal<string | null>(null)
  readonly genSuccess = signal<string | null>(null)
  readonly showAdvanced = signal(false)

  readonly templates = TEMPLATES
  readonly formats = FORMATS
  readonly toggles = TOGGLES
  readonly cameraOptions = [1, 2, 3, 4]
  readonly severityOptions: AlertSeverity[] = ['low', 'medium', 'high', 'critical']

  readonly filtered = computed(() => filterAlertsForReport(this.poll.data()?.alerts ?? [], this.config()))
  readonly summary = computed(() => computeAnalyticsSummary(this.filtered()))
  readonly chartPreview = computed(() => chartDataForReport(this.filtered()))
  readonly periodLabel = computed(() => buildPeriodLabel(this.config()))
  readonly cameraLabel = computed(() => buildCameraLabel(this.config()))
  readonly isEmpty = computed(() => this.filtered().length === 0)
  readonly templateDesc = computed(() => TEMPLATES.find((t) => t.id === this.config().template)?.desc)
  readonly evidence = computed(() => this.filtered().filter((a) => a.full_snapshot || a.focus_snapshot))
  readonly pieOption = computed(() => donutOption(this.chartPreview().severity, { inner: 44, outer: 68, padAngle: 0 }))
  readonly kpis = computed(() => {
    const s = this.summary()
    return [
      ['Incidents', s.totalIncidents],
      ['Open', s.openIncidents],
      ['Resolved', s.resolvedCount],
      ['Evidence', `${s.withEvidenceCount}/${s.totalIncidents}`],
    ] as const
  })

  val(e: Event) {
    return (e.target as HTMLInputElement).value
  }

  evidenceUrl(file: string) {
    return api.evidenceUrl(file)
  }

  patch(partial: Partial<ReportConfig>) {
    this.config.update((prev) => ({ ...prev, ...partial }))
    this.genSuccess.set(null)
    this.genError.set(null)
  }

  setToggle(key: ToggleKey, value: boolean) {
    this.patch({ [key]: value } as Partial<ReportConfig>)
  }

  applyTemplate(template: ReportTemplate) {
    this.config.update((prev) => ({
      ...prev,
      template,
      title: suggestedReportTitle(template),
      includeSnapshots: template !== 'clearance',
      includeCharts: true,
      includeIncidentTable: true,
      includeExecutiveSummary: true,
      includeZoneBreakdown: template !== 'clearance',
    }))
  }

  toggleCamera(id: number) {
    this.config.update((prev) => {
      const set = new Set(prev.cameras)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      const cameras = [...set].sort()
      return { ...prev, cameras: cameras.length ? cameras : [1, 2, 3, 4] }
    })
  }

  toggleSeverity(s: AlertSeverity) {
    this.config.update((prev) => {
      const set = new Set(prev.severities)
      if (set.has(s)) set.delete(s)
      else set.add(s)
      const severities = [...set] as AlertSeverity[]
      return { ...prev, severities: severities.length ? severities : DEFAULT_REPORT_CONFIG.severities }
    })
  }

  async handleGenerate() {
    this.generating.set(true)
    this.genError.set(null)
    this.genSuccess.set(null)
    const config = this.config()
    try {
      let chartImages: { severity?: string; timeline?: string; byType?: string } | undefined
      const root = this.host.nativeElement.querySelector<HTMLElement>('.report-chart-capture')
      if (config.includeCharts && root) {
        const [severity, timeline, byType] = await Promise.all([
          captureChartElement(root.querySelector('[data-chart="severity"]') as HTMLElement),
          captureChartElement(root.querySelector('[data-chart="timeline"]') as HTMLElement),
          captureChartElement(root.querySelector('[data-chart="byType"]') as HTMLElement),
        ])
        chartImages = { severity, timeline, byType }
      }
      await exportReport({ config, alerts: this.filtered(), chartImages, operatorName: this.auth.user()?.name })
      this.genSuccess.set(`Report downloaded as ${config.format.toUpperCase()}.`)
    } catch (err) {
      this.genError.set(err instanceof Error ? err.message : 'Report generation failed')
    } finally {
      this.generating.set(false)
    }
  }
}
