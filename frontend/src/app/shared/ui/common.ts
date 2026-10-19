import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core'
import { RouterLink } from '@angular/router'
import type { AlertStatus } from '../types'
import { cameraBadgeLabel, parseCameraIdFromAlert } from '../utils/cameraLabels'
import { IconComponent, type IconName } from './icon'

@Component({
  selector: 'div[appPageHeader]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-start justify-between gap-4 border-b border-guardian-border-subtle pb-5' },
  template: `
    <div>
      @if (eyebrow()) {
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-guardian-accent/70">{{ eyebrow() }}</p>
      }
      <h1 [class]="(eyebrow() ? 'mt-1' : '') + ' text-2xl font-semibold tracking-tight text-white'">{{ heading() }}</h1>
      @if (description()) {
        <p class="mt-1.5 max-w-2xl text-sm leading-relaxed text-guardian-muted">{{ description() }}</p>
      }
    </div>
    <ng-content />
  `,
})
export class PageHeaderComponent {
  readonly heading = input.required<string>()
  readonly description = input<string>()
  readonly eyebrow = input<string>()
}

@Component({
  selector: 'section[appPanel]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel overflow-hidden' },
  template: `
    @if (heading()) {
      <div class="panel-header flex items-center justify-between gap-3">
        <div>
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">{{ heading() }}</h3>
          @if (subtitle()) {
            <p class="mt-0.5 text-xs text-guardian-muted/80">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[panelAction]" />
      </div>
    }
    <div [class]="noPadding() ? '' : 'p-5'"><ng-content /></div>
  `,
})
export class PanelComponent {
  readonly heading = input<string>()
  readonly subtitle = input<string>()
  readonly noPadding = input(false)
}

type StatTone = 'default' | 'accent' | 'warning' | 'danger' | 'info'
const TONE_DOT: Record<StatTone, string> = {
  default: 'bg-guardian-muted/60',
  accent: 'bg-guardian-accent',
  warning: 'bg-guardian-warning',
  danger: 'bg-guardian-danger',
  info: 'bg-guardian-info',
}
const TONE_ICON: Record<StatTone, string> = {
  default: 'text-guardian-muted',
  accent: 'text-guardian-accent/80',
  warning: 'text-guardian-warning/80',
  danger: 'text-guardian-danger/80',
  info: 'text-guardian-info/80',
}

@Component({
  selector: 'div[appStatCard]',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stat-card group' },
  template: `
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p class="stat-card-label">
          <span [class]="'stat-card-dot ' + toneDot()" aria-hidden="true"></span>
          {{ label() }}
        </p>
        <p class="stat-card-value">
          @if (loading()) {
            <span class="inline-block h-8 w-16 animate-pulse rounded bg-guardian-elevated"></span>
          } @else {
            {{ value() }}
          }
        </p>
        @if (sub()) {
          <p class="stat-card-sub">{{ sub() }}</p>
        }
      </div>
      @if (icon(); as icon) {
        <span [class]="'stat-card-icon ' + toneIcon()"><svg [appIcon]="icon" class="h-4 w-4"></svg></span>
      }
    </div>
  `,
})
export class StatCardComponent {
  readonly label = input.required<string>()
  readonly value = input.required<string | number>()
  readonly sub = input<string>()
  readonly loading = input(false)
  readonly icon = input<IconName>()
  readonly tone = input<StatTone>('default')
  protected readonly toneDot = computed(() => TONE_DOT[this.tone()])
  protected readonly toneIcon = computed(() => TONE_ICON[this.tone()])
}

@Component({
  selector: 'div[appChartCard]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel flex h-full flex-col' },
  template: `
    <div class="panel-header">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">{{ heading() }}</h3>
    </div>
    <div class="flex flex-1 flex-col p-5 pt-4">
      @if (empty()) {
        <div class="flex flex-1 flex-col items-center justify-center gap-2 py-10">
          <div class="h-px w-12 bg-guardian-border"></div>
          <p class="text-xs text-guardian-muted">{{ emptyMessage() }}</p>
        </div>
      } @else {
        <ng-content />
      }
    </div>
  `,
})
export class ChartCardComponent {
  readonly heading = input.required<string>()
  readonly empty = input(false)
  readonly emptyMessage = input('No data this session')
}

@Component({
  selector: 'div[appErrorState]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel mx-auto max-w-lg p-8 text-center' },
  template: `
    <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-950/40 text-red-400">
      <span class="text-lg">!</span>
    </div>
    <p class="text-sm font-semibold uppercase tracking-wider text-red-400">{{ heading() }}</p>
    <p class="mt-2 text-sm leading-relaxed text-guardian-muted">{{ message() }}</p>
    <p class="mt-4 font-mono text-xs text-guardian-muted/70">Start backend: python main.py</p>
  `,
})
export class ErrorStateComponent {
  readonly heading = input('Backend Offline')
  readonly message = input.required<string>()
}

@Component({
  selector: 'div[appEmptyState]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel flex flex-col items-center justify-center px-8 py-16 text-center' },
  template: `
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-guardian-border bg-guardian-surface">
      <span class="text-xl text-guardian-muted">—</span>
    </div>
    <p class="max-w-sm text-sm leading-relaxed text-guardian-muted">{{ message() }}</p>
  `,
})
export class EmptyStateComponent {
  readonly message = input.required<string>()
}

const LEGEND_ITEMS = [
  { key: 'critical', label: 'Critical', fill: '#f87171' },
  { key: 'high', label: 'High', fill: '#fb923c' },
  { key: 'medium', label: 'Medium', fill: '#fbbf24' },
  { key: 'low', label: 'Low', fill: '#34d399' },
] as const

@Component({
  selector: 'div[appSeverityLegend]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'severity-legend',
    '[class.severity-legend-compact]': 'compact()',
    'aria-label': 'Severity color legend',
  },
  template: `
    @for (item of items; track item.key) {
      <span class="severity-legend-item">
        <span class="severity-legend-swatch" [style.background]="item.fill" aria-hidden="true"></span>
        {{ item.label }}
      </span>
    }
  `,
})
export class SeverityLegendComponent {
  readonly compact = input(false)
  protected readonly items = LEGEND_ITEMS
}

const STATUS_CLASS: Record<AlertStatus, string> = {
  new: 'status-badge--new',
  acknowledged: 'status-badge--acknowledged',
  under_review: 'status-badge--review',
  escalated: 'status-badge--escalated',
  false_alarm: 'status-badge--false-alarm',
  resolved: 'status-badge--resolved',
}

@Component({
  selector: 'span[appStatusBadge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"status-badge " + (statusClass[status()] ?? statusClass.new)' },
  template: `
    @if (status() === 'resolved') {
      <span class="status-badge-icon" aria-hidden="true">✓</span>
    } @else if (status() === 'escalated') {
      <span class="status-badge-icon" aria-hidden="true">!</span>
    }
    {{ label() ?? status().replace('_', ' ').toUpperCase() }}
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<AlertStatus>()
  readonly label = input<string>()
  protected readonly statusClass = STATUS_CLASS
}

@Component({
  selector: 'app-camera-badge',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (linkToMonitor() && id() != null) {
      <a
        routerLink="/monitoring"
        [queryParams]="{ camera: id() }"
        [class]="cls() + ' camera-badge-link'"
        [attr.title]="'Open ' + label() + ' in Monitoring'"
        (click)="$event.stopPropagation()"
      >{{ label() }}</a>
    } @else {
      <span [class]="cls()">{{ label() }}</span>
    }
  `,
})
export class CameraBadgeComponent {
  readonly camera = input('')
  readonly cameraId = input<number | null | undefined>()
  readonly linkToMonitor = input(false)
  readonly compact = input(false)
  protected readonly id = computed(
    () => this.cameraId() ?? parseCameraIdFromAlert({ camera_id: undefined, camera: this.camera() }) ?? null,
  )
  protected readonly label = computed(() => {
    const id = this.id()
    return id != null ? cameraBadgeLabel(id) : this.camera() || 'Unknown'
  })
  protected readonly cls = computed(() => `camera-badge ${this.compact() ? 'camera-badge-compact' : ''}`)
}

@Component({
  selector: 'div[appLoadingState]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'rootClass()',
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
  },
  template: `
    <div class="guardian-loader__visual" aria-hidden="true">
      <span class="guardian-loader__ring"></span>
      <span class="guardian-loader__ring guardian-loader__ring--inner"></span>
      <span class="guardian-loader__core">
        <svg viewBox="0 0 24 24" fill="none" class="guardian-loader__shield">
          <path d="M12 2L4 5.5V11.5C4 16.5 7.5 20.5 12 22C16.5 20.5 20 16.5 20 11.5V5.5L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="guardian-loader__scan"></span>
    </div>
    @if (!compact()) {
      <p class="guardian-loader__text">{{ message() }}</p>
    }
  `,
})
export class LoadingStateComponent {
  readonly message = input('Loading…')
  readonly fullScreen = input(false)
  readonly compact = input(false)
  protected readonly rootClass = computed(() =>
    this.fullScreen()
      ? 'guardian-loader guardian-loader--fullscreen'
      : this.compact()
        ? 'guardian-loader guardian-loader--compact'
        : 'guardian-loader',
  )
}

@Directive({ selector: '[appPortalToBody]' })
export class PortalToBodyDirective {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
    afterNextRender(() => document.body.appendChild(el))
    inject(DestroyRef).onDestroy(() => el.remove())
  }
}

@Component({
  selector: 'label[appToggle]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-guardian-border-subtle bg-guardian-surface/40 p-4 transition hover:bg-guardian-surface/70',
  },
  template: `
    <div>
      <span class="text-sm font-medium text-white">{{ label() }}</span>
      @if (description()) {
        <p class="mt-0.5 text-xs text-guardian-muted">{{ description() }}</p>
      }
    </div>
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      (click)="checkedChange.emit(!checked())"
      [class]="'relative h-6 w-11 shrink-0 rounded-full transition ' + (checked() ? 'bg-guardian-accent/80' : 'bg-guardian-elevated')"
    >
      <span [class]="'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ' + (checked() ? 'left-[calc(100%-1.375rem)]' : 'left-0.5')"></span>
    </button>
  `,
})
export class ToggleComponent {
  readonly label = input.required<string>()
  readonly description = input<string>()
  readonly checked = input(false)
  readonly checkedChange = output<boolean>()
}
