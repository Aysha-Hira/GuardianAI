import { DestroyRef, inject, signal } from '@angular/core'
import { ApiError } from '../shared/services/api'

/** Shared cache keys so navigation reuses the last API response instantly. */
export const POLL_KEYS = {
  alerts: 'poll:alerts',
  status: 'poll:status',
  cameras: 'poll:cameras',
  settings: 'poll:settings',
  zoneEvents: 'poll:zone-events',
  tracks: 'poll:tracks',
  multicam: 'poll:multicam',
} as const

const pollCache = new Map<string, unknown>()

/**
 * Port of React's usePolling hook. Call from a field initializer (injection context);
 * polling stops automatically when the component is destroyed.
 */
export function createPoll<T>(fetcher: () => Promise<T>, intervalMs = 3000, cacheKey?: string) {
  const destroyRef = inject(DestroyRef)
  const hasCached = cacheKey ? pollCache.has(cacheKey) : false

  const data = signal<T | null>(hasCached ? (pollCache.get(cacheKey!) as T) : null)
  const loading = signal(!hasCached)
  const error = signal<string | null>(null)
  const offline = signal(false)

  const refresh = async () => {
    try {
      const result = await fetcher()
      data.set(result)
      if (cacheKey) pollCache.set(cacheKey, result)
      error.set(null)
      offline.set(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        offline.set(true)
        error.set('Unable to connect to Guardian AI services.')
      } else {
        error.set(err instanceof Error ? err.message : 'Request failed')
      }
    } finally {
      loading.set(false)
    }
  }

  void refresh()
  let currentMs = intervalMs
  let id = window.setInterval(() => void refresh(), currentMs)
  destroyRef.onDestroy(() => window.clearInterval(id))

  /** React's usePolling restarted its timer when intervalMs changed; same here. */
  const setIntervalMs = (ms: number) => {
    if (ms === currentMs) return
    currentMs = ms
    window.clearInterval(id)
    id = window.setInterval(() => void refresh(), ms)
  }

  return {
    data: data.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    offline: offline.asReadonly(),
    refresh,
    setIntervalMs,
  }
}
