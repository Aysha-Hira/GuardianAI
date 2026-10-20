export interface TrackSummary {
  track_id: number
  status: string
  visible_duration: number
  confidence: number
  in_zone?: boolean
  inside_zone_duration?: number
  loitering_threshold_seconds?: number
  loitering_detected?: boolean
  zone_status?: string
  identity?: string
  identity_matched?: boolean
  watchlist_id?: string | null
  watchlist_name?: string | null
  risk_level?: string | null
  match_distance?: number | null
  match_threshold?: number | null
}

export interface ZoneRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ZoneEvent {
  event_id: number
  event_type: string
  track_id: number
  zone_index?: number
  zone_label?: string
  time_label?: string
  title?: string
  duration_seconds?: number
  camera_id?: number
}

export interface FocusItem {
  slot_id: string
  track_id: number
  zone_index: number
  zone_label: string
  mode?: string
  event?: string
  event_label: string
  tracking_status: string
  tracking_label: string
  zoom: number
  camera_id?: number
}

export interface FocusStatusResponse {
  active: boolean
  focuses: FocusItem[]
  slot_id?: string
  track_id?: number
  evidence_saved?: string[]
}

export interface ExtendedStatus {
  source_type: string
  camera_id: number
  camera2_available: boolean
  camera3_available?: boolean
  camera4_available?: boolean
  camera_active: boolean
  people_count: number
  vehicle_count?: number
  active_tracks: number
  fps: number
  resolution: string
  error: string | null
  playback_state: string | null
  video_filename?: string | null
  camera_label?: string
  source_fps?: number | null
  playback_time?: string
  total_time?: string
  restricted_zones?: ZoneRect[]
  restricted_zone?: ZoneRect | null
  restricted_zone_active?: boolean
  restricted_zone_label?: string
  zone_source?: string
  loitering_threshold_seconds?: number
  show_trails?: boolean
  incident_focus?: FocusStatusResponse
  manual_recording?: boolean
  manual_filename?: string | null
  manual_duration_sec?: number
  active_incident_clips?: number
  cameras?: { id: number; label: string; available: boolean; filename?: string }[]
}

export type AlertFilter = 'all' | 'new' | 'high' | 'resolved'

export const MONITOR_CAMERA_ORDER = [1, 2, 3, 4] as const
export type VideoSlotId = 2 | 3 | 4

export function isVideoSlot(cameraId: number): cameraId is VideoSlotId {
  return cameraId === 2 || cameraId === 3 || cameraId === 4
}

export function adjacentCameraId(current: number, direction: 'prev' | 'next'): number {
  const order = MONITOR_CAMERA_ORDER
  const idx = order.indexOf(current as (typeof order)[number])
  const base = idx >= 0 ? idx : 0
  const nextIdx =
    direction === 'next'
      ? (base + 1) % order.length
      : (base - 1 + order.length) % order.length
  return order[nextIdx]
}

export const ZOOM_LEVELS = [1.0, 1.25, 1.5, 2.0] as const
export const PAN_STEP = 36
export const LOITERING_MIN = 5
export const LOITERING_MAX = 300
export const MAX_ZONES = 5
