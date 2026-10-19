import type { CameraChannel } from '../types'

export function parseCameraIdFromAlert(alert: {
  camera_id?: number
  camera: string
}): number | null {
  if (alert.camera_id != null && alert.camera_id >= 1 && alert.camera_id <= 5) {
    return alert.camera_id
  }
  const match = alert.camera.match(/(?:CCTV|Camera|cam)\s*0?(\d)/i)
  if (!match) return null
  const id = Number(match[1])
  return id >= 1 && id <= 5 ? id : null
}

export function cameraBadgeLabel(id: number): string {
  return `CCTV 0${id}`
}

export function feedStatusLabel(camera: CameraChannel): string {
  if (camera.status === 'online') return 'Online'
  if (camera.status === 'playback') return 'Playback'
  if (camera.status === 'searching' || camera.type === 'searching') return 'Down'
  if (camera.type === 'video' && !camera.available) return 'No recording'
  return 'Offline'
}

export function feedStatusTone(
  camera: CameraChannel,
): 'online' | 'playback' | 'empty' | 'offline' {
  if (camera.status === 'searching' || camera.type === 'searching') return 'offline'
  if (camera.status === 'online') return 'online'
  if (camera.status === 'playback') return 'playback'
  if (camera.type === 'video' && !camera.available) return 'empty'
  return 'offline'
}

export function countLiveFeeds(cameras: CameraChannel[]): number {
  return cameras
    .filter((c) => c.id >= 1 && c.id <= 5)
    .filter(
      (c) =>
        c.type !== 'searching' &&
        c.status !== 'searching' &&
        (c.status === 'online' ||
          c.status === 'playback' ||
          (c.id === 1 && c.available && c.status !== 'offline')),
    ).length
}

export const CCTV_FEED_COUNT = 5
