import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ImageRun,
  AlignmentType,
} from 'docx'
import type { Alert } from '../types'
import type { ReportConfig } from '../types/reports'
import { api } from '../services/api'
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
  groupAlertsByZone,
} from './chartData'
import { fitInBox, loadImageDimensions } from './imageFit'
import { exportReportExcelStyled } from './reportExportExcel'
import { PDF_RGB, PDF_TABLE_STYLES } from './reportTheme'

export interface ReportChartImages {
  severity?: string
  timeline?: string
  byType?: string
}

export interface ExportReportInput {
  config: ReportConfig
  alerts: Alert[]
  chartImages?: ReportChartImages
  operatorName?: string
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function reportMeta(config: ReportConfig, alerts: Alert[], operatorName?: string) {
  const generatedAt = new Date()
  const summary = computeAnalyticsSummary(alerts)
  const period = buildPeriodLabel(config)
  const cameras = buildCameraLabel(config)
  const isEmpty = alerts.length === 0
  return { generatedAt, summary, period, cameras, isEmpty, operatorName }
}

function incidentRows(alerts: Alert[]): string[][] {
  return alerts.map((a) => [
    a.id.slice(0, 10),
    a.time_label,
    a.event_label,
    a.camera,
    a.zone_label || '—',
    `#${a.track_id}`,
    a.severity_label,
    a.status_label,
    a.full_snapshot || a.focus_snapshot ? 'Yes' : 'No',
  ])
}

type AutoTableDoc = jsPDF & { lastAutoTable: { finalY: number } }

export async function exportReportPdf(input: ExportReportInput): Promise<void> {
  const { config, alerts, chartImages, operatorName } = input
  const { generatedAt, summary, period, cameras, isEmpty } = reportMeta(
    config,
    alerts,
    operatorName,
  )

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 16
  let y = margin

  const addPageIfNeeded = (needed: number) => {
    const pageH = doc.internal.pageSize.getHeight()
    if (y + needed > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  const heading = (text: string, size = 13) => {
    addPageIfNeeded(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...PDF_RGB.text)
    doc.text(text, margin, y)
    y += size * 0.45 + 4
  }

  const body = (text: string, size = 10) => {
    addPageIfNeeded(8)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...PDF_RGB.muted)
    const lines = doc.splitTextToSize(text, pageW - margin * 2)
    doc.text(lines, margin, y)
    y += lines.length * (size * 0.42) + 3
  }

  // Header — light professional cover
  doc.setDrawColor(...PDF_RGB.border)
  doc.setLineWidth(0.4)
  doc.line(margin, 14, pageW - margin, 14)

  doc.setTextColor(...PDF_RGB.accent)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('GUARDIAN AI', margin, 11)

  doc.setTextColor(...PDF_RGB.text)
  doc.setFontSize(20)
  doc.text(config.title, margin, 24)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...PDF_RGB.muted)
  doc.text(`Generated ${generatedAt.toLocaleString()}`, margin, 31)
  y = 38

  // Meta panel — light grey box, dark text
  doc.setFillColor(...PDF_RGB.panelBg)
  doc.setDrawColor(...PDF_RGB.border)
  doc.roundedRect(margin, y, pageW - margin * 2, 26, 2, 2, 'FD')
  doc.setFontSize(8)
  doc.setTextColor(...PDF_RGB.muted)
  doc.setFont('helvetica', 'normal')
  doc.text('Reporting period', margin + 4, y + 7)
  doc.text('Cameras', margin + 4, y + 17)
  if (config.preparedBy || operatorName) {
    doc.text('Prepared by', pageW / 2, y + 7)
  }
  doc.setTextColor(...PDF_RGB.text)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(period, margin + 4, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.text(cameras, margin + 4, y + 22)
  if (config.preparedBy || operatorName) {
    doc.text(config.preparedBy || operatorName || '—', pageW / 2, y + 12)
  }
  y += 32

  if (config.includeExecutiveSummary) {
    heading('Executive Summary', 13)
    if (isEmpty) {
      body(
        'No security incidents were recorded during the selected reporting period. All monitored CCTV channels operated without triggering restricted-zone alerts or loitering violations. This report serves as a formal clearance record for the specified timeframe.',
      )
    } else {
      body(
        `${summary.totalIncidents} incident(s) recorded across ${cameras.toLowerCase()}. ` +
          `${summary.openIncidents} remain open; ${summary.resolvedCount} resolved and ${summary.falseAlarmCount} marked false alarm. ` +
          `Resolution rate: ${summary.resolutionRate}%. Evidence captured for ${summary.withEvidenceCount} incident(s).`,
      )
    }
    if (config.notes.trim()) {
      body(`Operator notes: ${config.notes.trim()}`)
    }
    y += 2
  }

  const kpis = [
    ['Incidents', String(summary.totalIncidents)],
    ['Open', String(summary.openIncidents)],
    ['Resolved', String(summary.resolvedCount)],
    ['High Sev.', `${summary.highSeverityRate}%`],
    ['Evidence', `${summary.withEvidenceCount}/${summary.totalIncidents || 0}`],
  ]
  const kpiW = (pageW - margin * 2) / kpis.length
  addPageIfNeeded(18)
  kpis.forEach(([label, val], i) => {
    const x = margin + i * kpiW
    doc.setFillColor(...PDF_RGB.panelBg)
    doc.setDrawColor(...PDF_RGB.border)
    doc.roundedRect(x + 1, y, kpiW - 2, 16, 1.5, 1.5, 'FD')
    doc.setFontSize(7)
    doc.setTextColor(...PDF_RGB.muted)
    doc.setFont('helvetica', 'normal')
    doc.text(label, x + 4, y + 6)
    doc.setFontSize(11)
    doc.setTextColor(...PDF_RGB.accent)
    doc.setFont('helvetica', 'bold')
    doc.text(val, x + 4, y + 13)
  })
  y += 22

  if (config.includeCharts && chartImages) {
    heading('Analytics Charts', 13)
    const chartMaxW = pageW - margin * 2
    for (const chart of [
      { label: 'Severity Distribution', img: chartImages.severity },
      { label: 'Incidents Over Time', img: chartImages.timeline },
      { label: 'Incidents by Type', img: chartImages.byType },
    ]) {
      if (!chart.img) continue
      try {
        const nat = await loadImageDimensions(chart.img)
        const dims = fitInBox(nat.width, nat.height, chartMaxW, 58)
        addPageIfNeeded(dims.height + 14)
        doc.setFontSize(8)
        doc.setTextColor(...PDF_RGB.muted)
        doc.text(chart.label, margin, y)
        y += 4
        const x = margin + (chartMaxW - dims.width) / 2
        doc.addImage(chart.img, 'PNG', x, y, dims.width, dims.height)
        y += dims.height + 10
      } catch {
        /* skip broken chart */
      }
    }
  }

  if (config.includeZoneBreakdown) {
    const zones = buildZoneBreakdown(alerts)
    heading('Zone Breakdown', 13)
    if (zones.length === 0) {
      body('No zone activity in the selected period.')
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Zone', 'Entries', 'Loitering', 'Total']],
        body: zones.map((z) => [z.zone, String(z.entries), String(z.loitering), String(z.total)]),
        ...PDF_TABLE_STYLES,
      })
      y = (doc as AutoTableDoc).lastAutoTable.finalY + 8
    }
  }

  if (config.includeIncidentTable) {
    heading(isEmpty ? 'Incident Log (Empty)' : 'Incident Log', 13)
    if (isEmpty) {
      body('No incidents match the selected filters. Monitoring channels reported normal operations.')
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['ID', 'Time', 'Event', 'Camera', 'Zone', 'Track', 'Severity', 'Status', 'Evidence']],
        body: incidentRows(alerts),
        ...PDF_TABLE_STYLES,
        styles: { ...PDF_TABLE_STYLES.styles, fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 28 } },
      })
      y = (doc as AutoTableDoc).lastAutoTable.finalY + 8
    }
  }

  if (config.includeSnapshots && !isEmpty) {
    heading('Evidence Snapshots', 13)
    const withShots = alerts.filter((a) => a.full_snapshot || a.focus_snapshot).slice(0, 12)
    if (withShots.length === 0) {
      body('No snapshot evidence available for incidents in this period.')
    } else {
      const imgMaxW = pageW - margin * 2
      const imgMaxH = 72
      for (const alert of withShots) {
        const filename = alert.focus_snapshot ?? alert.full_snapshot!
        const dataUrl = await fetchImageDataUrl(api.evidenceUrl(filename))
        if (!dataUrl) continue
        try {
          const nat = await loadImageDimensions(dataUrl)
          const dims = fitInBox(nat.width, nat.height, imgMaxW, imgMaxH)
          addPageIfNeeded(dims.height + 14)
          doc.setFontSize(8)
          doc.setTextColor(...PDF_RGB.muted)
          doc.text(
            `${alert.time_label} · ${alert.event_label} · ${alert.camera} · Track #${alert.track_id}`,
            margin,
            y,
          )
          y += 4
          const x = margin + (imgMaxW - dims.width) / 2
          doc.addImage(dataUrl, 'JPEG', x, y, dims.width, dims.height)
          y += dims.height + 10
        } catch {
          /* skip */
        }
      }
    }
  }

  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(...PDF_RGB.muted)
    doc.text(
      `Guardian AI · Confidential · Page ${i} of ${totalPages}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' },
    )
  }

  doc.save(filenameForReport(config, generatedAt))
}

export async function exportReportExcel(input: ExportReportInput): Promise<void> {
  await exportReportExcelStyled(input.config, input.alerts, input.operatorName)
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
}

export async function exportReportDocx(input: ExportReportInput): Promise<void> {
  const { config, alerts, chartImages, operatorName } = input
  const { generatedAt, summary, period, cameras, isEmpty } = reportMeta(
    config,
    alerts,
    operatorName,
  )

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'GUARDIAN AI', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: config.title, bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun({ text: `Generated: ${generatedAt.toLocaleString()}`, color: '666666' })] }),
    new Paragraph({ children: [new TextRun({ text: `Period: ${period} · Cameras: ${cameras}`, bold: true })] }),
  ]

  if (config.preparedBy || operatorName) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `Prepared by: ${config.preparedBy || operatorName}`, italics: true })] }),
    )
  }

  if (config.includeExecutiveSummary) {
    children.push(
      new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun(
            isEmpty
              ? 'No security incidents were recorded during the selected period. This document serves as a formal clearance record.'
              : `${summary.totalIncidents} incident(s). ${summary.openIncidents} open, ${summary.resolvedCount} resolved. Resolution rate ${summary.resolutionRate}%.`,
          ),
        ],
      }),
    )
  }

  children.push(
    new Paragraph({ text: 'Key Metrics', heading: HeadingLevel.HEADING_2 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ['Incidents', 'Open', 'Resolved', 'High Sev %', 'Evidence'].map(
            (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] }),
          ),
        }),
        new TableRow({
          children: [
            String(summary.totalIncidents),
            String(summary.openIncidents),
            String(summary.resolvedCount),
            `${summary.highSeverityRate}%`,
            `${summary.withEvidenceCount}/${summary.totalIncidents || 0}`,
          ].map((v) => new TableCell({ children: [new Paragraph({ children: [new TextRun(v)] })] })),
        }),
      ],
    }),
  )

  if (config.includeCharts && chartImages) {
    children.push(new Paragraph({ text: 'Analytics', heading: HeadingLevel.HEADING_1 }))
    for (const [label, img] of [
      ['Severity Distribution', chartImages.severity],
      ['Incidents Over Time', chartImages.timeline],
      ['Incidents by Type', chartImages.byType],
    ] as const) {
      if (!img) continue
      let w = 480
      let h = 180
      try {
        const nat = await loadImageDimensions(img)
        const dims = fitInBox(nat.width, nat.height, 520, 200)
        w = Math.round(dims.width * 2.6)
        h = Math.round(dims.height * 2.6)
      } catch {
        /* defaults */
      }
      children.push(
        new Paragraph({ children: [new TextRun({ text: label, bold: true })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: dataUrlToBytes(img),
              transformation: { width: w, height: h },
              type: 'png',
            }),
          ],
        }),
      )
    }
  }

  if (config.includeIncidentTable) {
    children.push(
      new Paragraph({ text: isEmpty ? 'Incident Log (Empty)' : 'Incident Log', heading: HeadingLevel.HEADING_1 }),
    )
    if (!isEmpty) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: ['Time', 'Event', 'Camera', 'Severity', 'Status'].map(
                (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] }),
              ),
            }),
            ...alerts.slice(0, 50).map(
              (a) =>
                new TableRow({
                  children: [a.time_label, a.event_label, a.camera, a.severity_label, a.status_label].map(
                    (v) => new TableCell({ children: [new Paragraph({ children: [new TextRun(v)] })] }),
                  ),
                }),
            ),
          ],
        }),
      )
    }
  }

  if (config.includeSnapshots && !isEmpty) {
    children.push(new Paragraph({ text: 'Evidence Snapshots', heading: HeadingLevel.HEADING_1 }))
    for (const alert of alerts.filter((a) => a.full_snapshot || a.focus_snapshot).slice(0, 8)) {
      const filename = alert.focus_snapshot ?? alert.full_snapshot!
      const bytes = await fetchImageBytes(api.evidenceUrl(filename))
      if (!bytes) continue
      let w = 420
      let h = 280
      try {
        const blob = new Blob([bytes.slice()])
        const url = URL.createObjectURL(blob)
        const nat = await loadImageDimensions(url)
        URL.revokeObjectURL(url)
        const dims = fitInBox(nat.width, nat.height, 480, 320)
        w = Math.round(dims.width * 2.2)
        h = Math.round(dims.height * 2.2)
      } catch {
        /* defaults */
      }
      children.push(
        new Paragraph({ children: [new TextRun({ text: `${alert.time_label} · ${alert.event_label}`, bold: true })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ data: bytes, transformation: { width: w, height: h }, type: 'jpg' })],
        }),
      )
    }
  }

  const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children }] }))
  downloadBlob(blob, filenameForReport(config, generatedAt))
}

export async function exportReport(input: ExportReportInput): Promise<void> {
  if (input.config.format === 'xlsx') await exportReportExcel(input)
  else if (input.config.format === 'docx') await exportReportDocx(input)
  else await exportReportPdf(input)
}

export async function captureChartElement(el: HTMLElement | null): Promise<string | undefined> {
  if (!el) return undefined
  const html2canvas = (await import('html2canvas')).default
  const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, logging: false })
  return canvas.toDataURL('image/png')
}

export function chartDataForReport(alerts: Alert[]) {
  return {
    severity: groupAlertsBySeverity(alerts),
    byType: groupAlertsByType(alerts),
    byZone: groupAlertsByZone(alerts),
    summary: computeAnalyticsSummary(alerts),
  }
}
