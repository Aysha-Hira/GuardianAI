import ExcelJS from 'exceljs'
import type { Alert } from '../types'
import type { ReportConfig } from '../types/reports'
import {
  buildCameraLabel,
  buildPeriodLabel,
  filenameForReport,
} from './reportFilters'
import {
  buildZoneBreakdown,
  computeAnalyticsSummary,
  groupAlertsBySeverity,
  groupAlertsByType,
} from './chartData'
import { EXPORT_THEME as C } from './reportTheme'

const THIN = { style: 'thin' as const, color: { argb: C.border } }
const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
}

function applyHeaderRow(row: ExcelJS.Row, colCount?: number) {
  const count = colCount ?? Math.max(row.cellCount, 1)
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } }
    cell.font = { bold: true, color: { argb: C.headerText }, size: 10 }
    cell.border = CELL_BORDER
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  }
  row.height = 22
}

function applyDataRow(row: ExcelJS.Row, alt: boolean, colCount?: number) {
  const count = colCount ?? Math.max(row.cellCount, 1)
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c)
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: alt ? C.rowAlt : C.row },
    }
    cell.font = { color: { argb: C.text }, size: 10 }
    cell.border = CELL_BORDER
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left', indent: 1 }
  }
}

function applyDetailRow(row: ExcelJS.Row, label: string, value: string) {
  const labelCell = row.getCell(1)
  labelCell.value = label
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.rowAlt } }
  labelCell.font = { bold: true, color: { argb: C.muted }, size: 10 }
  labelCell.border = CELL_BORDER
  labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  const valueCell = row.getCell(2)
  valueCell.value = value
  valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.row } }
  valueCell.font = { color: { argb: C.text }, size: 10 }
  valueCell.border = CELL_BORDER
  valueCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 }
  row.height = 20
}

function autoWidth(sheet: ExcelJS.Worksheet, min = 10, max = 44) {
  sheet.columns.forEach((col) => {
    if (!col || !col.eachCell) return
    let maxLen = min
    col.eachCell({ includeEmpty: false }, (cell) => {
      const val = cell.value != null ? String(cell.value) : ''
      maxLen = Math.max(maxLen, Math.min(max, val.length + 2))
    })
    col.width = maxLen
  })
}

export async function exportReportExcelStyled(
  config: ReportConfig,
  alerts: Alert[],
  operatorName?: string,
): Promise<void> {
  const generatedAt = new Date()
  const summary = computeAnalyticsSummary(alerts)
  const period = buildPeriodLabel(config)
  const cameras = buildCameraLabel(config)
  const isEmpty = alerts.length === 0

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Guardian AI'
  wb.created = generatedAt
  wb.modified = generatedAt

  const ws = wb.addWorksheet('Summary', {
    views: [{ showGridLines: true }],
    properties: { defaultRowHeight: 18 },
  })

  // Title block
  ws.mergeCells('A1:F1')
  const brand = ws.getCell('A1')
  brand.value = 'GUARDIAN AI'
  brand.font = { bold: true, size: 11, color: { argb: C.accent } }
  ws.getRow(1).height = 20

  ws.mergeCells('A2:F2')
  ws.getCell('A2').value = 'Security Operations Report'
  ws.getCell('A2').font = { bold: true, size: 10, color: { argb: C.muted } }

  ws.mergeCells('A3:F3')
  const titleCell = ws.getCell('A3')
  titleCell.value = config.title
  titleCell.font = { bold: true, size: 14, color: { argb: C.text } }
  ws.getRow(3).height = 24

  ws.getCell('A5').value = 'REPORT DETAILS'
  ws.getCell('A5').font = { bold: true, size: 9, color: { argb: C.muted } }

  const details: [string, string][] = [
    ['Generated', generatedAt.toLocaleString()],
    ['Reporting period', period],
    ['Cameras', cameras],
    ['Prepared by', config.preparedBy || operatorName || '—'],
    ['Format', 'Excel workbook (.xlsx)'],
  ]
  if (config.notes.trim()) details.push(['Notes', config.notes.trim()])

  let r = 6
  for (const [label, value] of details) {
    applyDetailRow(ws.getRow(r), label, value)
    r++
  }

  r += 1
  ws.getCell(`A${r}`).value = 'KEY METRICS'
  ws.getCell(`A${r}`).font = { bold: true, size: 9, color: { argb: C.muted } }
  r++

  const metricHeader = ws.getRow(r)
  metricHeader.values = ['Metric', 'Value']
  applyHeaderRow(metricHeader, 2)
  r++

  const metrics: { label: string; value: string | number; accent?: boolean; percent?: boolean }[] = [
    { label: 'Total incidents', value: summary.totalIncidents },
    { label: 'Open incidents', value: summary.openIncidents },
    { label: 'Resolved', value: summary.resolvedCount },
    { label: 'False alarms', value: summary.falseAlarmCount },
    { label: 'Resolution rate', value: summary.resolutionRate / 100, accent: true, percent: true },
    { label: 'High severity share', value: summary.highSeverityRate / 100, accent: true, percent: true },
    { label: 'Evidence captured', value: summary.withEvidenceCount },
  ]
  metrics.forEach(({ label, value, accent, percent }, i) => {
    const row = ws.getRow(r)
    row.values = [label, value]
    applyDataRow(row, i % 2 === 1, 2)
    const valueCell = row.getCell(2)
    if (percent) valueCell.numFmt = '0%'
    valueCell.font = {
      color: { argb: accent ? C.accent : C.text },
      size: 10,
      bold: Boolean(accent),
    }
    valueCell.alignment = { vertical: 'middle', horizontal: percent ? 'right' : 'left', indent: 1 }
    r++
  })

  r += 1
  ws.mergeCells(`A${r}:B${r}`)
  const statusCell = ws.getCell(`A${r}`)
  statusCell.value = isEmpty
    ? '✓ CLEARANCE — No incidents recorded for the selected scope.'
    : `${summary.totalIncidents} incident(s) recorded for the selected scope.`
  statusCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: isEmpty ? C.clearanceBg : C.infoBg },
  }
  statusCell.font = {
    bold: true,
    color: { argb: isEmpty ? C.clearanceText : C.infoText },
    size: 10,
  }
  statusCell.border = {
    top: { style: 'thin', color: { argb: isEmpty ? C.clearanceBorder : C.infoBorder } },
    bottom: { style: 'thin', color: { argb: isEmpty ? C.clearanceBorder : C.infoBorder } },
    left: { style: 'thin', color: { argb: isEmpty ? C.clearanceBorder : C.infoBorder } },
    right: { style: 'thin', color: { argb: isEmpty ? C.clearanceBorder : C.infoBorder } },
  }
  statusCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(r).height = 26

  ws.getColumn(1).width = 24
  ws.getColumn(2).width = 40

  // Incidents sheet
  const inc = wb.addWorksheet('Incidents', { views: [{ showGridLines: true }] })
  const incHeaders = [
    'Incident ID', 'Timestamp', 'Event', 'Event Type', 'Camera', 'Zone',
    'Track ID', 'Severity', 'Status', 'Video Time',
    'Focus Snapshot', 'Full Snapshot', 'Incident Clip', 'Clip Status',
  ]
  const headerRow = inc.getRow(1)
  headerRow.values = incHeaders
  applyHeaderRow(headerRow, incHeaders.length)

  if (alerts.length === 0) {
    const emptyRow = inc.getRow(2)
    emptyRow.getCell(1).value = 'No incidents match the selected filters.'
    emptyRow.getCell(1).font = { italic: true, color: { argb: C.muted } }
    inc.mergeCells('A2:N2')
  } else {
    alerts.forEach((a, i) => {
      const row = inc.getRow(i + 2)
      row.values = [
        a.id, a.time_label, a.event_label, a.event_type, a.camera,
        a.zone_label || '—', a.track_id, a.severity_label, a.status_label,
        a.video_time ?? '—', a.focus_snapshot ?? '—', a.full_snapshot ?? '—',
        a.incident_clip ?? '—', a.incident_clip_status ?? '—',
      ]
      applyDataRow(row, i % 2 === 1, incHeaders.length)
    })
  }

  inc.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: true }]
  inc.autoFilter = { from: 'A1', to: `N${Math.max(1, alerts.length + 1)}` }
  autoWidth(inc)

  addBreakdownSheet(wb, 'By Camera', ['Camera', 'Incidents'], buildCameraCounts(alerts), isEmpty)
  addBreakdownSheet(
    wb, 'By Severity', ['Severity', 'Count'],
    groupAlertsBySeverity(alerts).map((s) => [s.name, s.value]), isEmpty,
  )
  addBreakdownSheet(
    wb, 'By Event Type', ['Event Type', 'Count'],
    groupAlertsByType(alerts).map((t) => [t.name, t.count]), isEmpty,
  )
  addBreakdownSheet(
    wb, 'Zone Breakdown', ['Zone', 'Entries', 'Loitering', 'Total'],
    buildZoneBreakdown(alerts).map((z) => [z.zone, z.entries, z.loitering, z.total]), isEmpty,
  )

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filenameForReport(config, generatedAt)
  a.click()
  URL.revokeObjectURL(url)
}

function buildCameraCounts(alerts: Alert[]): (string | number)[][] {
  const map = new Map<string, number>()
  for (const a of alerts) map.set(a.camera, (map.get(a.camera) ?? 0) + 1)
  if (map.size === 0) return []
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function addBreakdownSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number)[][],
  isEmpty: boolean,
) {
  const sheet = wb.addWorksheet(name, { views: [{ showGridLines: true }] })
  const h = sheet.getRow(1)
  h.values = headers
  applyHeaderRow(h, headers.length)

  if (rows.length === 0) {
    const row = sheet.getRow(2)
    row.getCell(1).value = isEmpty ? 'No data for selected period' : 'No rows'
    row.getCell(1).font = { italic: true, color: { argb: C.muted } }
    sheet.mergeCells(2, 1, 2, headers.length)
  } else {
    rows.forEach((vals, i) => {
      const row = sheet.getRow(i + 2)
      row.values = vals
      applyDataRow(row, i % 2 === 1, headers.length)
      for (let c = 2; c <= headers.length; c++) {
        row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' }
      }
    })
  }

  autoWidth(sheet)
}
