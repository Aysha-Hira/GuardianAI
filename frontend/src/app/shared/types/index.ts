export type AlertStatus =
  | 'new'
  | 'acknowledged'
  | 'under_review'
  | 'escalated'
  | 'false_alarm'
  | 'resolved'

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'

export type AlertEventType =
  | 'restricted_entry'
  | 'loitering'
  | 'watchlist_match'
  | 'behavior_anomaly'
  | string

export interface AlertTimelineEntry {
  status: string
  status_label: string
  timestamp: number
  time_label: string
}

export interface Alert {
  id: string
  event_type: AlertEventType
  event_label: string
  track_id: number
  zone_index: number
  zone_label: string
  camera: string
  camera_id?: number
  source_type: string
  timestamp: number
  time_label: string
  video_filename: string | null
  video_time: string | null
  generated_at: number
  generated_label: string
  severity: AlertSeverity
  severity_label: string
  severity_source?: 'random_forest' | 'rules' | string
  rule_severity?: AlertSeverity | string | null
  severity_probs?: Record<string, number> | null
  status: AlertStatus
  status_label: string
  full_snapshot: string | null
  focus_snapshot: string | null
  incident_clip: string | null
  incident_clip_status?: 'none' | 'recording' | 'processing' | 'ready' | 'failed'
  security_event_id: number | null
  watchlist_id?: string | null
  watchlist_name?: string | null
  watchlist_category?: string | null
  match_distance?: number | null
  match_threshold?: number | null
  face_snapshot?: string | null
  anomaly_score?: number | null
  anomaly_threshold?: number | null
  timeline: AlertTimelineEntry[]
  created_at: number
  updated_at: number
  track_active?: boolean
}

export interface AlertsResponse {
  alerts: Alert[]
  new_count: number
  total: number
}

export interface SystemStatus {
  source_type: string
  camera_id: number
  camera_active: boolean
  people_count: number
  vehicle_count?: number
  active_tracks: number
  fps: number
  resolution: string
  error: string | null
  playback_state: string | null
  video_filename?: string
  camera_label?: string
  source_fps?: number
  video_duration?: number
  playback_position?: number
  playback_time?: string
  total_time?: string
  video_loop?: boolean
  camera_name?: string
  zone_source?: string
}

export interface Track {
  track_id: number
  display_id: number
  visible: boolean
  duration_seconds: number
  duration_label: string
  confidence: number
  following?: boolean
  identity?: string
  identity_matched?: boolean
  watchlist_id?: string | null
  watchlist_name?: string | null
  risk_level?: string | null
  match_distance?: number | null
  match_threshold?: number | null
}

export interface Settings {
  show_trails: boolean
  loitering_threshold_seconds: number
}

export interface CameraChannel {
  id: number
  label: string
  type?: 'webcam' | 'video' | 'searching'
  available: boolean
  filename?: string
  status?: 'online' | 'offline' | 'searching' | 'playback'
  active?: boolean
  ai_enabled?: boolean
  show_boxes?: boolean
  people_count?: number
  vehicle_count?: number
  active_tracks?: number
}

export interface CamerasResponse {
  cameras: CameraChannel[]
}

export type CameraSourceType = 'webcam' | 'rtsp' | 'http'

export interface CameraRecord {
  id: number
  camera_name: string
  source_type: CameraSourceType
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CameraCreatePayload {
  camera_name: string
  source_type: CameraSourceType
  url?: string | null
  is_active?: boolean
}

export type CameraUpdatePayload = Partial<CameraCreatePayload>

export interface FocusStatus {
  active: boolean
  slots?: Record<string, unknown>
}

export interface DashboardStats {
  totalIncidents: number
  highSeverity: number
  activeTracks: number
  camerasOnline: number
  camerasTotal: number
}
