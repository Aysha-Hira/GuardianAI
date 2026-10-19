import type {
  Alert,
  AlertsResponse,
  CamerasResponse,
  Settings,
  SystemStatus,
  Track,
} from '../types'

import { getCsrfToken } from './authStorage'

const API_BASE = '/api'

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  const csrf = getCsrfToken()
  if (csrf) headers.set('X-CSRF-Token', csrf)
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  let response: Response
  try {
    response = await fetch(url, { ...init, headers: buildHeaders(init) })
  } catch {
    throw new ApiError('Unable to connect to Guardian AI services.', 0)
  }

  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.()
    let detail = response.statusText
    try {
      const body = (await response.json()) as { detail?: string | unknown[] }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
    }
    throw new ApiError(detail, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const api = {
  getStatus: () => request<SystemStatus>('/status'),

  getTracks: () => request<Track[]>('/tracks'),

  getAlerts: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : ''
    return request<AlertsResponse>(`/alerts${query}`)
  },

  getAlert: (id: string) => request<Alert>(`/alerts/${id}`),

  updateAlertStatus: (id: string, status: string) =>
    request<Alert>(`/alerts/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),

  getSettings: () => request<Settings>('/settings'),

  updateLoiteringThreshold: (loitering_threshold_seconds: number) =>
    request<{ ok: boolean; loitering_threshold_seconds: number }>(
      '/settings/loitering',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loitering_threshold_seconds }),
      },
    ),

  setTrails: (enabled: boolean) =>
    request<{ ok: boolean; show_trails: boolean }>('/settings/trails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),

  getCameras: () => request<CamerasResponse>('/cameras'),

  getCameraFrameUrl: (cameraId: number) =>
    `${API_BASE}/cameras/${cameraId}/frame?t=${Date.now()}`,

  getCameraRawFrameUrl: (cameraId: number) =>
    `${API_BASE}/cameras/${cameraId}/frame?raw=1&t=${Date.now()}`,

  getCameraFrameBlob: async (cameraId: number, raw = false) => {
    const url = `${API_BASE}/cameras/${cameraId}/frame?raw=${raw ? '1' : '0'}&t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 204) return null
    if (!res.ok) return null
    const blob = await res.blob()
    if (blob.size < 100) return null
    return blob
  },

  getFocusStatus: () => request<import('../types/monitor').FocusStatusResponse>('/focus/status'),

  getFrameBlob: async () => {
    const url = `${API_BASE}/frame?t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new ApiError('Frame unavailable', res.status)
    return res.blob()
  },

  getFocusFrameBlob: async (slot: string) => {
    const url = `${API_BASE}/focus/frame?slot=${encodeURIComponent(slot)}&t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 204) return null
    if (!res.ok) throw new ApiError('Focus frame unavailable', res.status)
    return res.blob()
  },

  getZone: () =>
    request<{
      restricted_zones: import('../types/monitor').ZoneRect[]
      restricted_zone: import('../types/monitor').ZoneRect | null
      restricted_zone_active: boolean
      restricted_zone_label: string
    }>('/zone'),

  setZones: (zones: import('../types/monitor').ZoneRect[], reset_states = true) =>
    request<{ ok: boolean; restricted_zones: import('../types/monitor').ZoneRect[] }>(
      '/zone',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones, reset_states }),
      },
    ),

  clearZones: () =>
    request<{ ok: boolean }>('/zone', { method: 'DELETE' }),

  setZoneEditing: (active: boolean) =>
    request<{ ok: boolean }>('/zone/editing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }),

  getZoneEvents: () =>
    request<import('../types/monitor').ZoneEvent[]>('/zone/events'),

  switchCamera: (cameraId: number) =>
    request<Record<string, unknown>>(`/source/camera/${cameraId}`, { method: 'POST' }),

  uploadVideo: async (file: File, cameraId = 2) => {
    const form = new FormData()
    form.append('file', file)
    const url = `${API_BASE}/upload/video?camera_id=${cameraId}`
    const res = await fetch(url, { method: 'POST', body: form, headers: buildHeaders() })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string }
      throw new ApiError(body.detail ?? 'Upload failed', res.status)
    }
    return res.json() as Promise<Record<string, unknown>>
  },

  deleteCamera: (cameraId: number) =>
    request<Record<string, unknown>>(`/cameras/${cameraId}`, { method: 'DELETE' }),

  deleteCamera2: () =>
    request<Record<string, unknown>>('/cameras/2', { method: 'DELETE' }),

  setCameraSettings: (
    cameraId: number,
    settings: { ai_enabled?: boolean; show_boxes?: boolean },
  ) =>
    request<Record<string, unknown>>(`/cameras/${cameraId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  pauseVideo: () => request<Record<string, unknown>>('/source/video/pause', { method: 'POST' }),
  resumeVideo: () => request<Record<string, unknown>>('/source/video/resume', { method: 'POST' }),

  takeSnapshot: async (viewport?: Blob) => {
    if (viewport) {
      const form = new FormData()
      form.append('viewport', viewport, 'snapshot.jpg')
      const url = `${API_BASE}/snapshot`
      const res = await fetch(url, { method: 'POST', body: form, headers: buildHeaders() })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new ApiError(body.detail ?? 'Snapshot failed', res.status)
      }
      return res.json() as Promise<{ ok: boolean; filename: string }>
    }
    return request<{ ok: boolean; filename: string }>('/snapshot', { method: 'POST' })
  },

  followTrack: (track_id: number) =>
    request<import('../types/monitor').FocusStatusResponse>('/focus/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id }),
    }),

  focusFromAlert: (alert_id: string) =>
    request<
      import('../types/monitor').FocusStatusResponse & {
        ok: boolean
        live?: boolean
        camera_id?: number
      }
    >('/focus/from-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_id }),
    }),

  autoFocusLock: (payload: {
    track_id: number
    event_type: string
    zone_index?: number
    camera_id?: number
  }) =>
    request<unknown>('/focus/auto-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  releaseFocus: (slot?: string) => {
    const q = slot ? `?slot=${encodeURIComponent(slot)}` : ''
    return request<unknown>(`/focus/release${q}`, { method: 'POST' })
  },

  getExtendedStatus: () =>
    request<import('../types/monitor').ExtendedStatus>('/status'),

  getTrackSummaries: () =>
    request<import('../types/monitor').TrackSummary[]>('/tracks'),

  evidenceUrl: (filename: string) => `${API_BASE}/alerts/evidence/${filename}`,

  recordingUrl: (filename: string) => `${API_BASE}/recordings/${filename}`,

  startRecording: () =>
    request<{ ok: boolean; filename?: string; already_recording?: boolean }>(
      '/record/start',
      { method: 'POST' },
    ),

  stopRecording: () =>
    request<{ ok: boolean; filename?: string }>('/record/stop', { method: 'POST' }),

  getWatchlistStatus: () =>
    request<import('../types/faceRecognition').WatchlistEngineStatus>('/watchlist/status'),

  getWatchlist: () =>
    request<{ entries: import('../types/faceRecognition').WatchlistEntry[] }>('/watchlist'),

  enrollWatchlist: (file: File, meta: { name: string; category: string; risk_level: string; notes: string }) => {
    const form = new FormData()
    form.append('image', file, file.name)
    form.append('name', meta.name)
    form.append('category', meta.category)
    form.append('risk_level', meta.risk_level)
    form.append('notes', meta.notes)
    return request<import('../types/faceRecognition').EnrollResponse>('/watchlist/enroll', {
      method: 'POST',
      body: form,
    })
  },

  deleteWatchlistEntry: (id: string) =>
    request<{ ok: boolean; id: string }>(`/watchlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  watchlistImageUrl: (filename: string) =>
    `${API_BASE}/watchlist/images/${encodeURIComponent(filename)}`,

  getMulticamStatus: () =>
    request<import('../types/multicam').MulticamStatus>('/experiments/multicam/status'),

  getMulticamPresets: () =>
    request<{ presets: import('../types/multicam').MulticamPresetInfo[]; active: import('../types/multicam').MulticamActivePreset }>(
      '/experiments/multicam/presets',
    ),

  activateMulticamPreset: (presetId: string) =>
    request<{ ok: boolean; preset_id: string; label: string; people_hint: string }>(
      `/experiments/multicam/preset/${encodeURIComponent(presetId)}`,
      { method: 'POST' },
    ),

  uploadMulticamVideo: async (cameraSlot: 1 | 2, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const url = `${API_BASE}/experiments/multicam/upload/${cameraSlot}`
    const res = await fetch(url, { method: 'POST', body: form, headers: buildHeaders() })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string }
      throw new ApiError(body.detail ?? 'Upload failed', res.status)
    }
    return res.json() as Promise<{
      ok: boolean
      camera_slot: number
      original_filename: string
      size_bytes: number
    }>
  },

  multicamSourceVideoUrl: (cameraSlot: 1 | 2) =>
    `${API_BASE}/experiments/multicam/source/${cameraSlot}`,

  runMulticamExperiment: (body: import('../types/multicam').MulticamRunRequest) =>
    request<{ ok: boolean; message: string }>('/experiments/multicam/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteAllAlerts: () =>
    request<{ ok: boolean; deleted: number; files_deleted: number }>('/alerts', { method: 'DELETE' }),

  getSubscription: () =>
    request<{
      current: import('../types/subscription').ApiSubscription | null
      history: import('../types/subscription').ApiSubscription[]
    }>('/subscription'),

  checkoutSubscription: (body: import('../types/subscription').CheckoutPayload) =>
    request<{ receipt: import('../types/subscription').ApiSubscription }>('/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelSubscription: () =>
    request<{ current: import('../types/subscription').ApiSubscription }>('/subscription/cancel', { method: 'POST' }),

  resumeSubscription: () =>
    request<{ current: import('../types/subscription').ApiSubscription }>('/subscription/resume', { method: 'POST' }),

  multicamVideoUrl: (filename: string, cacheBust?: number | string) => {
    const base = `${API_BASE}/experiments/multicam/video/${encodeURIComponent(filename)}`
    return cacheBust != null ? `${base}?v=${encodeURIComponent(String(cacheBust))}` : base
  },
}

export { ApiError }
