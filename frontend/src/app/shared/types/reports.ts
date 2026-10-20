import type { AlertSeverity, AlertStatus } from './index'

export type ReportFormat = 'pdf' | 'docx' | 'xlsx'

export type ReportTemplate =
  | 'incident_summary'
  | 'camera_activity'
  | 'clearance'

export interface ReportConfig {
  title: string
  template: ReportTemplate
  format: ReportFormat
  dateFrom: string
  dateTo: string
  cameras: number[]
  severities: AlertSeverity[]
  statuses: AlertStatus[]
  includeExecutiveSummary: boolean
  includeCharts: boolean
  includeIncidentTable: boolean
  includeSnapshots: boolean
  includeZoneBreakdown: boolean
  includeTimeline: boolean
  preparedBy: string
  notes: string
}

export interface ReportDataset {
  alerts: import('./index').Alert[]
  generatedAt: Date
  periodLabel: string
  cameraLabel: string
  isEmpty: boolean
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  title: 'Guardian AI Security Operations Report',
  template: 'incident_summary',
  format: 'pdf',
  dateFrom: '',
  dateTo: '',
  cameras: [1, 2, 3, 4],
  severities: ['low', 'medium', 'high', 'critical'],
  statuses: [
    'new',
    'acknowledged',
    'under_review',
    'escalated',
    'false_alarm',
    'resolved',
  ],
  includeExecutiveSummary: true,
  includeCharts: true,
  includeIncidentTable: true,
  includeSnapshots: true,
  includeZoneBreakdown: true,
  includeTimeline: true,
  preparedBy: '',
  notes: '',
}
