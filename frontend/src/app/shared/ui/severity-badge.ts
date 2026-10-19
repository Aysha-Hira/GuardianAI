import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import type { AlertSeverity } from '../types'

const STYLES: Record<AlertSeverity, string> = {
  low: 'bg-zinc-800/60 text-zinc-300 ring-zinc-700/50',
  medium: 'bg-amber-950/40 text-amber-300 ring-amber-800/40',
  high: 'bg-red-950/40 text-red-300 ring-red-800/40',
  critical: 'bg-red-950/60 text-red-200 ring-red-700/50',
}

@Component({
  selector: 'span[appSeverityBadge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: `{{ text() }}`,
})
export class SeverityBadgeComponent {
  readonly severity = input.required<AlertSeverity>()
  readonly label = input<string | undefined>()
  protected readonly text = computed(() => this.label() ?? this.severity().toUpperCase())
  protected readonly classes = computed(
    () =>
      `inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
        STYLES[this.severity()] ?? STYLES.low
      }`,
  )
}
