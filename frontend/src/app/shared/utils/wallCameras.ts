import type { CameraChannel } from '../types'

const SLOT_LABELS: Record<number, string> = {
  1: 'CCTV 01 — Laptop Camera',
  2: 'CCTV 02 — Upload Slot',
  3: 'CCTV 03 — Upload Slot',
  4: 'CCTV 04 — Access Road',
  5: 'CCTV 05 — Remote Perimeter',
}

function placeholderForSlot(id: number): CameraChannel {
  if (id === 5) {
    return {
      id: 5,
      label: SLOT_LABELS[5]!,
      type: 'searching',
      available: false,
      filename: undefined,
      status: 'searching',
      active: false,
      ai_enabled: false,
      show_boxes: false,
      people_count: 0,
      vehicle_count: 0,
      active_tracks: 0,
    }
  }

  return {
    id,
    label: SLOT_LABELS[id] ?? `CCTV 0${id}`,
    type: id === 1 ? 'webcam' : 'video',
    available: false,
    filename: undefined,
    status: 'offline',
    active: false,
    ai_enabled: true,
    show_boxes: true,
    people_count: 0,
    vehicle_count: 0,
    active_tracks: 0,
  }
}

/** Always return CCTV 01–05, filling gaps from the API with placeholders. */
export function normalizeWallCameras(cameras: CameraChannel[]): CameraChannel[] {
  return [1, 2, 3, 4, 5].map((id) => cameras.find((c) => c.id === id) ?? placeholderForSlot(id))
}

export function isSearchingChannel(camera: CameraChannel): boolean {
  return camera.type === 'searching' || camera.status === 'searching'
}
