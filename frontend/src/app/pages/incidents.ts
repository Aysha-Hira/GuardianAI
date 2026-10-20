import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { map } from 'rxjs'
import { createPoll, POLL_KEYS } from '../core/polling'
import { IncidentDetailsComponent } from '../features/alerts/incident-details'
import { IncidentTableComponent } from '../features/alerts/incident-table'
import { api } from '../shared/services/api'
import {
  ErrorStateComponent,
  LoadingStateComponent,
  PageHeaderComponent,
  PanelComponent,
  SeverityLegendComponent,
} from '../shared/ui/common'
import { IconComponent } from '../shared/ui/icon'

const STATUS_OPTIONS: [string, string][] = [
  ['all', 'All Statuses'],
  ['new', 'New'],
  ['acknowledged', 'Acknowledged'],
  ['under_review', 'Under Review'],
  ['escalated', 'Escalated'],
  ['false_alarm', 'False Alarm'],
  ['resolved', 'Resolved'],
]
const SEVERITY_OPTIONS: [string, string][] = [
  ['all', 'All Severities'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['critical', 'Critical'],
]
const EVENT_OPTIONS: [string, string][] = [
  ['all', 'All Events'],
  ['restricted_entry', 'Restricted Entry'],
  ['loitering', 'Loitering'],
  ['watchlist_match', 'Watchlist Match'],
  ['behavior_anomaly', 'Behavior Anomaly'],
]

@Component({
  selector: 'app-incidents',
  imports: [
    NgTemplateOutlet,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
    PanelComponent,
    SeverityLegendComponent,
    IconComponent,
    IncidentTableComponent,
    IncidentDetailsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (poll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      <div class="space-y-6">
        <div appPageHeader heading="Incidents" description="Search, filter, and manage security alerts. Operator actions sync with the backend in real time.">
          <div class="shrink-0 pt-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-guardian-border bg-guardian-panel px-3 py-1.5 font-mono text-xs text-guardian-muted">
                {{ filtered().length }} of {{ total() }} shown
              </span>
              @if (confirmingDelete()) {
                <span class="text-xs text-guardian-muted">Delete all {{ total() }} incidents and their snapshots?</span>
                <button type="button" class="btn-ghost text-xs" (click)="confirmingDelete.set(false)" [disabled]="deleting()">Keep them</button>
                <button type="button" class="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                  (click)="deleteAll()" [disabled]="deleting()">{{ deleting() ? 'Deleting…' : 'Delete all' }}</button>
              } @else {
                <button type="button" class="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-40"
                  (click)="confirmingDelete.set(true)" [disabled]="total() === 0">Delete all incidents</button>
              }
            </div>
            @if (deleteMessage(); as msg) {
              <p class="mt-2 text-right text-xs text-guardian-muted">{{ msg }}</p>
            }
          </div>
        </div>

        <div appSeverityLegend class="px-1"></div>

        <section appPanel [noPadding]="true">
          <div class="filter-toolbar p-4">
            <label class="flex min-w-[240px] flex-1 flex-col">
              <span class="field-label">Search</span>
              <div class="relative">
                <svg appIcon="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-guardian-muted"></svg>
                <input
                  type="search"
                  placeholder="Search ID, event, track, camera…"
                  [value]="search()"
                  (input)="search.set($any($event.target).value)"
                  class="input-field w-full pl-9"
                />
              </div>
            </label>
            <ng-template #filterSelect let-label="label" let-value="value" let-options="options" let-set="set">
              <label class="flex min-w-[148px] flex-col">
                <span class="field-label">{{ label }}</span>
                <select [attr.aria-label]="label" (change)="set($any($event.target).value)" class="input-field w-full">
                  @for (opt of options; track opt[0]) {
                    <option [value]="opt[0]" [selected]="opt[0] === value">{{ opt[1] }}</option>
                  }
                </select>
              </label>
            </ng-template>
            <ng-container *ngTemplateOutlet="filterSelect; context: { label: 'Status', value: statusFilter(), options: statusOptions, set: setStatus }" />
            <ng-container *ngTemplateOutlet="filterSelect; context: { label: 'Severity', value: severityFilter(), options: severityOptions, set: setSeverity }" />
            <ng-container *ngTemplateOutlet="filterSelect; context: { label: 'Event', value: eventFilter(), options: eventOptions, set: setEvent }" />
          </div>
        </section>

        <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            @if (poll.loading() && !poll.data()) {
              <div appLoadingState [compact]="true"></div>
            } @else {
              <app-incident-table [alerts]="filtered()" [selectedId]="selectedId()" />
            }
          </div>
          @if (selectedId()) {
            <app-incident-details [alertId]="selectedId()" (closed)="closeDetails()" (updated)="poll.refresh()" />
          }
        </div>
      </div>
    }
  `,
})
export class IncidentsPage {
  protected async deleteAll() {
    this.deleting.set(true)
    this.deleteMessage.set(null)
    try {
      const r = await api.deleteAllAlerts()
      this.deleteMessage.set(`Deleted ${r.deleted} incident${r.deleted === 1 ? '' : 's'}.`)
      this.confirmingDelete.set(false)
      if (this.selectedId()) this.closeDetails()
      await this.poll.refresh()
    } catch (err) {
      this.deleteMessage.set(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed.')
    } finally {
      this.deleting.set(false)
    }
  }

  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)

  protected readonly poll = createPoll(() => api.getAlerts(), 2000, POLL_KEYS.alerts)
  protected readonly selectedId = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('alert'))), {
    initialValue: null,
  })

  protected readonly search = signal('')
  protected readonly confirmingDelete = signal(false)
  protected readonly deleting = signal(false)
  protected readonly deleteMessage = signal<string | null>(null)
  protected readonly statusFilter = signal('all')
  protected readonly severityFilter = signal('all')
  protected readonly eventFilter = signal('all')
  protected readonly statusOptions = STATUS_OPTIONS
  protected readonly severityOptions = SEVERITY_OPTIONS
  protected readonly eventOptions = EVENT_OPTIONS
  protected readonly setStatus = (v: string) => this.statusFilter.set(v)
  protected readonly setSeverity = (v: string) => this.severityFilter.set(v)
  protected readonly setEvent = (v: string) => this.eventFilter.set(v)

  protected readonly total = computed(() => this.poll.data()?.alerts.length ?? 0)
  protected readonly filtered = computed(() => {
    let list = [...(this.poll.data()?.alerts ?? [])]
    const q = this.search().trim().toLowerCase()
    if (q) {
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(q) ||
          a.event_label.toLowerCase().includes(q) ||
          (a.watchlist_name ?? '').toLowerCase().includes(q) ||
          a.event_type.toLowerCase().includes(q) ||
          String(a.track_id).includes(q) ||
          a.camera.toLowerCase().includes(q),
      )
    }
    const status = this.statusFilter()
    const severity = this.severityFilter()
    const event = this.eventFilter()
    if (status !== 'all') list = list.filter((a) => a.status === status)
    if (severity !== 'all') list = list.filter((a) => a.severity === severity)
    if (event !== 'all') list = list.filter((a) => a.event_type === event)
    return list.sort((a, b) => b.timestamp - a.timestamp)
  })

  protected closeDetails() {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { alert: null }, queryParamsHandling: 'merge' })
  }
}
