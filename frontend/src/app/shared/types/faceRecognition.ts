export type ScanState = 'idle' | 'ready' | 'scanning' | 'complete' | 'error'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type WatchlistCategory =
  | 'general'
  | 'restricted'
  | 'high_priority'
  | 'test_demo'

export interface FaceImageMeta {
  fileName: string
  width: number
  height: number
  objectUrl: string
  file: File
}

export interface WatchlistEntry {
  id: string
  name: string
  category: WatchlistCategory | string
  risk_level: RiskLevel | string
  notes: string
  model: string
  distance_metric?: string
  match_threshold?: number
  image_file?: string | null
  created_at?: number
  updated_at?: number
}

export interface EnrollProcessingInfo {
  face_detected: boolean
  embedding_created: boolean
  model?: string
  distance_metric?: string
  threshold?: number
}

export interface EnrollResponse {
  ok: boolean
  entry: WatchlistEntry
  processing: EnrollProcessingInfo
}

export interface WatchlistEngineStatus {
  enabled: boolean
  engine: {
    ok: boolean
    model?: string
    distance_metric?: string
    threshold?: number
    error?: string
    code?: string
  }
  weights?: {
    ready: boolean
    model?: string | null
    setup_hint?: string
  }
  watchlist_count: number
  match_threshold: number
}

export interface ScanPhase {
  minProgress: number
  label: string
}

export const SCAN_PHASES: ScanPhase[] = [
  { minProgress: 0, label: 'SCANNING' },
  { minProgress: 25, label: 'FACE DETECTED' },
  { minProgress: 55, label: 'EMBEDDING CREATED' },
  { minProgress: 85, label: 'WATCHLIST ENTRY SAVED' },
]

export const WATCHLIST_CATEGORY_LABELS: Record<WatchlistCategory, string> = {
  general: 'General Watchlist',
  restricted: 'Restricted Person',
  high_priority: 'High Priority',
  test_demo: 'Test / Demo Entry',
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export interface EnrollmentResult {
  success: boolean
  entry?: WatchlistEntry
  processing?: EnrollProcessingInfo
  error?: string
}
