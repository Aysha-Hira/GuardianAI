import type { CameraChannel } from '../types'

export function normalizeWallCameras(cameras: CameraChannel[]): CameraChannel[] {
  return [...cameras].sort((a, b) => a.id - b.id)
}

export function isSearchingChannel(camera: CameraChannel): boolean {
  return camera.type === 'searching' || camera.status === 'searching'
}
