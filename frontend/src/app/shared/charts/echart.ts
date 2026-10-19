import { afterNextRender, DestroyRef, Directive, effect, ElementRef, inject, input } from '@angular/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export type ChartOption = echarts.EChartsCoreOption

@Directive({ selector: '[appEchart]', host: { style: 'width: 100%' } })
export class EchartDirective {
  readonly option = input.required<ChartOption>()

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
    let chart: echarts.ECharts | null = null
    let observer: ResizeObserver | null = null

    afterNextRender(() => {
      chart = echarts.init(el, undefined, { renderer: 'canvas' })
      chart.setOption(this.option(), true)
      observer = new ResizeObserver(() => chart?.resize())
      observer.observe(el)
    })
    effect(() => {
      const option = this.option()
      chart?.setOption(option, true)
    })
    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect()
      chart?.dispose()
    })
  }
}

export const AXIS_TICK = { color: '#7a8499', fontSize: 11 }
const GRID_LINE = { lineStyle: { color: '#1a2030', type: [2, 4] as number[] } }

export const TOOLTIP = {
  backgroundColor: '#131820',
  borderColor: '#2a3142',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#e8ecf4', fontSize: 12 },
  extraCssText: 'border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.4);',
}

const SHADOW_POINTER = { type: 'shadow', shadowStyle: { color: 'rgba(42, 49, 66, 0.45)' } }

function valueAxis(extra: Record<string, unknown> = {}) {
  return {
    type: 'value',
    minInterval: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: AXIS_TICK,
    splitLine: GRID_LINE,
    ...extra,
  }
}

function categoryAxis(data: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    data,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: AXIS_TICK,
    splitLine: { show: false },
    ...extra,
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function areaOption(
  labels: string[],
  series: { name: string; data: number[]; color: string; fillOpacity?: number }[],
): ChartOption {
  return {
    grid: { top: 8, right: 8, left: 0, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis', ...TOOLTIP, axisPointer: { type: 'line', lineStyle: { color: '#2a3142' } } },
    xAxis: categoryAxis(labels, { boundaryGap: false }),
    yAxis: valueAxis(),
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      smooth: true,
      smoothMonotone: 'x',
      symbol: 'none',
      lineStyle: { color: s.color, width: 2 },
      itemStyle: { color: s.color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: hexToRgba(s.color, s.fillOpacity ?? 0.25) },
          { offset: 1, color: hexToRgba(s.color, 0) },
        ]),
      },
    })),
  }
}

export function lineOption(
  labels: string[],
  series: { name: string; data: number[]; color: string; dashed?: boolean }[],
  opts: { legend?: boolean; decimals?: boolean } = {},
): ChartOption {
  return {
    grid: { top: opts.legend ? 28 : 8, right: 8, left: 0, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis', ...TOOLTIP, axisPointer: { type: 'line', lineStyle: { color: '#2a3142' } } },
    legend: opts.legend ? { top: 0, textStyle: AXIS_TICK, icon: 'roundRect', itemWidth: 10, itemHeight: 3 } : undefined,
    xAxis: categoryAxis(labels, { boundaryGap: false }),
    yAxis: valueAxis(opts.decimals ? { minInterval: undefined } : {}),
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      smooth: true,
      smoothMonotone: 'x',
      symbol: 'none',
      lineStyle: { color: s.color, width: 2, type: s.dashed ? 'dashed' : 'solid' },
      itemStyle: { color: s.color },
    })),
  }
}

export function horizontalBarOption(
  labels: string[],
  values: number[],
  opts: { name?: string; color?: string | string[]; labelWidth?: number; barSize?: number } = {},
): ChartOption {
  const colors = Array.isArray(opts.color) ? opts.color : null
  return {
    grid: { top: 0, right: 16, left: 0, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis', ...TOOLTIP, axisPointer: SHADOW_POINTER },
    xAxis: valueAxis({ splitLine: GRID_LINE }),
    yAxis: categoryAxis(labels, {
      inverse: true,
      axisLabel: { ...AXIS_TICK, width: opts.labelWidth ?? 130, overflow: 'truncate' },
    }),
    series: [
      {
        type: 'bar',
        name: opts.name ?? 'Count',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: colors ? colors[i % colors.length] : (opts.color ?? '#34d399'), borderRadius: [0, 2, 2, 0] },
        })),
        barWidth: opts.barSize ?? 18,
      },
    ],
  }
}

export function barOption(
  labels: string[],
  series: { name: string; data: number[]; color: string | string[]; stack?: string }[],
  opts: { barSize?: number; legend?: boolean } = {},
): ChartOption {
  return {
    grid: { top: opts.legend ? 28 : 8, right: 8, left: 0, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis', ...TOOLTIP, axisPointer: SHADOW_POINTER },
    legend: opts.legend ? { top: 0, textStyle: AXIS_TICK, itemWidth: 10, itemHeight: 10 } : undefined,
    xAxis: categoryAxis(labels),
    yAxis: valueAxis(),
    series: series.map((s) => ({
      type: 'bar',
      name: s.name,
      stack: s.stack,
      barMaxWidth: opts.barSize ?? 32,
      data: s.data.map((v, i) => ({
        value: v,
        itemStyle: {
          color: Array.isArray(s.color) ? s.color[i % s.color.length] : s.color,
          borderRadius: [2, 2, 0, 0],
        },
      })),
    })),
  }
}

export function donutOption(
  data: { name: string; value: number; fill: string }[],
  opts: { inner?: number; outer?: number; padAngle?: number } = {},
): ChartOption {
  return {
    tooltip: { trigger: 'item', ...TOOLTIP, formatter: '{b}: {c}' },
    series: [
      {
        type: 'pie',
        radius: [opts.inner ?? 52, opts.outer ?? 78],
        center: ['50%', '50%'],
        padAngle: opts.padAngle ?? 3,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0 },
        emphasis: { scale: false },
        data: data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.fill } })),
      },
    ],
  }
}
