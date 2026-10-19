import type { Alert } from '../types'
import type { ReportConfig } from '../types/reports'
import { parseCameraIdFromAlert } from './cameraLabels'

function dayStartMs(isoDate: string): number | null {
  if (!isoDate) return null
  const d = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function dayEndMs(isoDate: string): number | null {
  if (!isoDate) return null
  const d = new Date(`${isoDate}T23:59:59.999`)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

export function filterAlertsForReport(
  alerts: Alert[],
  config: ReportConfig,
): Alert[] {
  const fromMs = dayStartMs(config.dateFrom)
  const toMs = dayEndMs(config.dateTo)
  const cameraSet = new Set(config.cameras)
  const severitySet = new Set(config.severities)
  const statusSet = new Set(config.statuses)

  return alerts
    .filter((alert) => {
      const ts = alert.timestamp * 1000
      if (fromMs != null && ts < fromMs) return false
      if (toMs != null && ts > toMs) return false

      const camId = parseCameraIdFromAlert(alert)
      if (camId != null && !cameraSet.has(camId)) return false
      if (camId == null && config.cameras.length < 3) return false

      if (!severitySet.has(alert.severity)) return false
      if (!statusSet.has(alert.status)) return false
      return true
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function buildPeriodLabel(config: ReportConfig): string {
  if (config.dateFrom && config.dateTo) {
    return `${formatDisplayDate(config.dateFrom)} — ${formatDisplayDate(config.dateTo)}`
  }
  if (config.dateFrom) {
    return `From ${formatDisplayDate(config.dateFrom)}`
  }
  if (config.dateTo) {
    return `Through ${formatDisplayDate(config.dateTo)}`
  }
  return 'Current session (all recorded incidents)'
}

export function buildCameraLabel(config: ReportConfig): string {
  if (config.cameras.length === 0 || config.cameras.length === 3) {
    return 'All CCTV channels (01–04)'
  }
  return config.cameras.map((id) => `CCTV 0${id}`).join(', ')
}

function formatDisplayDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function suggestedReportTitle(template: ReportConfig['template']): string {
  switch (template) {
    case 'camera_activity':
      return 'CCTV Channel Activity Report'
    case 'clearance':
      return 'Security Clearance Report — No Incidents'
    default:
      return 'Guardian AI Incident Operations Report'
  }
}

export function filenameForReport(
  config: ReportConfig,
  generatedAt: Date,
): string {
  const stamp = generatedAt.toISOString().slice(0, 10)
  const slug = config.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const ext = config.format === 'docx' ? 'docx' : config.format
  return `guardian-ai-${slug || 'report'}-${stamp}.${ext}`
}
