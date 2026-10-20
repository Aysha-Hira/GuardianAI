import type { Alert } from '../types'

export interface TimeBucket {
  label: string
  count: number
}

export interface TypeBucket {
  name: string
  count: number
  fill?: string
}

export interface SeverityBucket {
  name: string
  value: number
  fill: string
}

const SEVERITY_COLORS: Record<string, string> = {
  LOW: '#6b7280',
  MEDIUM: '#f59e0b',
  HIGH: '#ef4444',
  CRITICAL: '#dc2626',
}

export function groupAlertsByHour(alerts: Alert[]): TimeBucket[] {
  if (alerts.length === 0) return []

  const buckets = new Map<string, number>()

  for (const alert of alerts) {
    const date = new Date(alert.timestamp * 1000)
    const hour = date.getHours().toString().padStart(2, '0')
    const label = `${hour}:00`
    buckets.set(label, (buckets.get(label) ?? 0) + 1)
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count }))
}

export function groupAlertsByType(alerts: Alert[]): TypeBucket[] {
  const buckets = new Map<string, number>()

  for (const alert of alerts) {
    const name = alert.event_label || alert.event_type
    buckets.set(name, (buckets.get(name) ?? 0) + 1)
  }

  return Array.from(buckets.entries()).map(([name, count]) => ({ name, count }))
}

export function groupAlertsBySeverity(alerts: Alert[]): SeverityBucket[] {
  const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  const buckets = new Map<string, number>()

  for (const alert of alerts) {
    const key = (alert.severity_label || alert.severity).toUpperCase()
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return order
    .filter((name) => buckets.has(name))
    .map((name) => ({
      name,
      value: buckets.get(name) ?? 0,
      fill: SEVERITY_COLORS[name] ?? '#6b7280',
    }))
}

export function countHighSeverity(alerts: Alert[]): number {
  return alerts.filter(
    (a) => a.severity === 'high' || a.severity === 'critical',
  ).length
}

export interface AnalyticsSummary {
  totalIncidents: number
  openIncidents: number
  resolvedCount: number
  falseAlarmCount: number
  resolutionRate: number
  falseAlarmRate: number
  avgResponseMinutes: number | null
  highSeverityRate: number
  withEvidenceCount: number
}

const OPEN_STATUSES = new Set([
  'new',
  'acknowledged',
  'under_review',
  'escalated',
])

const CLOSED_STATUSES = new Set(['resolved', 'false_alarm'])

export function computeAnalyticsSummary(alerts: Alert[]): AnalyticsSummary {
  const total = alerts.length
  if (total === 0) {
    return {
      totalIncidents: 0,
      openIncidents: 0,
      resolvedCount: 0,
      falseAlarmCount: 0,
      resolutionRate: 0,
      falseAlarmRate: 0,
      avgResponseMinutes: null,
      highSeverityRate: 0,
      withEvidenceCount: 0,
    }
  }

  const openIncidents = alerts.filter((a) => OPEN_STATUSES.has(a.status)).length
  const resolvedCount = alerts.filter((a) => a.status === 'resolved').length
  const falseAlarmCount = alerts.filter((a) => a.status === 'false_alarm').length
  const closedCount = alerts.filter((a) => CLOSED_STATUSES.has(a.status)).length
  const highCount = countHighSeverity(alerts)
  const withEvidenceCount = alerts.filter(
    (a) => a.full_snapshot || a.focus_snapshot,
  ).length

  const responseDeltas = alerts
    .filter((a) => CLOSED_STATUSES.has(a.status) || a.status === 'acknowledged')
    .map((a) => Math.max(0, a.updated_at - a.created_at))
    .filter((d) => d > 0)

  const avgResponseMinutes =
    responseDeltas.length > 0
      ? Math.round(
          responseDeltas.reduce((sum, d) => sum + d, 0) /
            responseDeltas.length /
            60,
        )
      : null

  return {
    totalIncidents: total,
    openIncidents,
    resolvedCount,
    falseAlarmCount,
    resolutionRate: Math.round((closedCount / total) * 100),
    falseAlarmRate: Math.round((falseAlarmCount / total) * 100),
    avgResponseMinutes,
    highSeverityRate: Math.round((highCount / total) * 100),
    withEvidenceCount,
  }
}

const ZONE_COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c']

export function groupAlertsByZone(alerts: Alert[]): TypeBucket[] {
  const buckets = new Map<string, number>()

  for (const alert of alerts) {
    const name = alert.zone_label || `Zone ${alert.zone_index + 1}`
    buckets.set(name, (buckets.get(name) ?? 0) + 1)
  }

  return Array.from(buckets.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      ...item,
      fill: ZONE_COLORS[index % ZONE_COLORS.length],
    }))
}

const STATUS_ORDER = [
  'new',
  'acknowledged',
  'under_review',
  'escalated',
  'false_alarm',
  'resolved',
] as const

const STATUS_COLORS: Record<string, string> = {
  new: '#6ee7b7',
  acknowledged: '#93c5fd',
  under_review: '#fcd34d',
  escalated: '#fca5a5',
  false_alarm: '#a1a1aa',
  resolved: '#86efac',
}

export interface StatusBucket extends TypeBucket {
  fill: string
}

export function groupAlertsByStatus(alerts: Alert[]): StatusBucket[] {
  const buckets = new Map<string, number>()

  for (const alert of alerts) {
    buckets.set(alert.status, (buckets.get(alert.status) ?? 0) + 1)
  }

  return STATUS_ORDER.filter((status) => buckets.has(status)).map((status) => ({
    name: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    count: buckets.get(status) ?? 0,
    fill: STATUS_COLORS[status] ?? '#6b7280',
  }))
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  'Restricted Entry': '#60a5fa',
  Loitering: '#fbbf24',
}

export function groupEventsByType(
  events: { event_type: string }[],
): TypeBucket[] {
  const labels: Record<string, string> = {
    entry: 'Restricted Entry',
    loitering: 'Loitering',
  }
  const buckets = new Map<string, number>()

  for (const event of events) {
    const name = labels[event.event_type] ?? event.event_type
    buckets.set(name, (buckets.get(name) ?? 0) + 1)
  }

  return Array.from(buckets.entries()).map(([name, count]) => ({
    name,
    count,
    fill: EVENT_TYPE_COLORS[name] ?? '#34d399',
  }))
}

export interface ZoneBreakdownRow {
  zone: string
  entries: number
  loitering: number
  total: number
}

export function buildZoneBreakdown(alerts: Alert[]): ZoneBreakdownRow[] {
  const rows = new Map<string, ZoneBreakdownRow>()

  for (const alert of alerts) {
    const zone = alert.zone_label || `Zone ${alert.zone_index + 1}`
    const row = rows.get(zone) ?? { zone, entries: 0, loitering: 0, total: 0 }
    row.total += 1
    if (alert.event_type === 'loitering') {
      row.loitering += 1
    } else {
      row.entries += 1
    }
    rows.set(zone, row)
  }

  return Array.from(rows.values()).sort((a, b) => b.total - a.total)
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`
}

export interface OperationalPoint {
  label: string
  people: number
  tracks: number
  fps: number
}
