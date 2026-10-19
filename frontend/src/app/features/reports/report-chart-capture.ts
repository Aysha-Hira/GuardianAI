import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { EchartDirective, type ChartOption } from '../../shared/charts/echart'
import type { Alert } from '../../shared/types'
import { groupAlertsByHour, groupAlertsBySeverity, groupAlertsByType } from '../../shared/utils/chartData'

/** Light-theme styling used only for the off-screen charts captured into exports. */
const AXIS = { color: '#64748b', fontSize: 11 }
const GRID = { lineStyle: { color: '#e2e8f0', type: [2, 4] as number[] } }
const TOOLTIP = {
  backgroundColor: '#fff',
  borderColor: '#cbd5e1',
  borderWidth: 1,
  textStyle: { color: '#1e293b', fontSize: 12 },
  extraCssText: 'border-radius: 8px;',
}
const axisBase = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: AXIS }

function cartesian(labels: string[], series: Record<string, unknown>): ChartOption {
  return {
    animation: false,
    grid: { top: 8, right: 8, left: 0, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis', ...TOOLTIP },
    xAxis: { type: 'category', data: labels, ...axisBase, splitLine: { show: false } },
    yAxis: { type: 'value', minInterval: 1, ...axisBase, splitLine: GRID },
    series: [series],
  }
}

/** Port of React's components/reports/ReportChartCapture (hidden charts for PDF/DOCX/XLSX). */
@Component({
  selector: 'app-report-chart-capture',
  imports: [EchartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="report-chart-capture" aria-hidden="true">
      <div class="report-capture-chart" data-chart="severity"><div appEchart [option]="severityOption()" style="height: 100%"></div></div>
      <div class="report-capture-chart" data-chart="timeline"><div appEchart [option]="timelineOption()" style="height: 100%"></div></div>
      <div class="report-capture-chart" data-chart="byType"><div appEchart [option]="typeOption()" style="height: 100%"></div></div>
    </div>
  `,
})
export class ReportChartCaptureComponent {
  readonly alerts = input<Alert[]>([])

  readonly severityOption = computed<ChartOption>(() => {
    const d = groupAlertsBySeverity(this.alerts())
    const data = d.length ? d : [{ name: 'None', value: 1, fill: '#2a3142' }]
    return {
      animation: false,
      tooltip: { trigger: 'item', ...TOOLTIP, formatter: '{b}: {c}' },
      series: [{
        type: 'pie',
        radius: [50, 80],
        center: ['50%', '50%'],
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0 },
        data: data.map((x) => ({ name: x.name, value: x.value, itemStyle: { color: x.fill } })),
      }],
    }
  })

  readonly timelineOption = computed<ChartOption>(() => {
    const d = groupAlertsByHour(this.alerts())
    const data = d.length ? d : [{ label: '—', count: 0 }]
    return cartesian(data.map((x) => x.label), {
      type: 'line',
      data: data.map((x) => x.count),
      smooth: true,
      smoothMonotone: 'x',
      symbol: 'none',
      lineStyle: { color: '#059669', width: 2 },
      areaStyle: { color: '#05966922' },
    })
  })

  readonly typeOption = computed<ChartOption>(() => {
    const d = groupAlertsByType(this.alerts())
    const data = d.length ? d : [{ name: 'No data', count: 0 }]
    return cartesian(data.map((x) => x.name), {
      type: 'bar',
      data: data.map((x) => x.count),
      barWidth: 36,
      itemStyle: { color: '#059669', borderRadius: [2, 2, 0, 0] },
    })
  })
}
