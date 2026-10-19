export interface MulticamTransition {
  global_id: number
  from_camera: string
  from_local_track: number
  to_camera: string
  to_local_track: number
  similarity: number
  time_gap_seconds: number
}

export interface MulticamReport {
  dataset?: string
  reid_model?: string
  embedding_dim?: number
  matching_metric?: string
  threshold?: number
  suggested_threshold?: number | null
  local_tracks_camera_1?: number
  local_tracks_camera_2?: number
  global_identities?: number
  cross_camera_transitions?: number
  shared_global_ids_across_cameras?: number
  transitions?: MulticamTransition[]
  evaluation?: Record<string, unknown>
  performance?: Record<string, number>
  videos?: Record<string, string | null>
}

export interface MulticamCameraSource {
  ready: boolean
  path: string
  original_filename: string | null
  size_bytes: number | null
}

export interface MulticamPresetInfo {
  id: string
  label: string
  description: string
  people_hint: string
  capture: number
}

export interface MulticamGtFrameSpan {
  people_count: number
  first_person_frame: number
  last_person_frame: number
  recommended_min_frames: number
  people: Array<{ person_id: number; start_frame: number; end_frame: number }>
}

export interface MulticamActivePreset {
  preset_id: string | null
  label: string | null
  description: string | null
  people_hint: string | null
  location?: string | null
  gt_path: string | null
  gt_frame_span?: MulticamGtFrameSpan
  revision?: number
  camera_1_bytes?: number
  camera_2_bytes?: number
}

export interface MulticamStatus {
  running: boolean
  phase: string
  message: string
  error: string | null
  dataset_ready: boolean
  camera_1: MulticamCameraSource
  camera_2: MulticamCameraSource
  camera_1_path: string
  camera_2_path: string
  report: MulticamReport | null
  videos: Record<string, string | null>
  presets?: MulticamPresetInfo[]
  active_preset?: MulticamActivePreset
}

export interface MulticamRunRequest {
  max_frames?: number | null
  threshold?: number
  sequential?: boolean
  side_by_side?: boolean
  fast_mode?: boolean
}
