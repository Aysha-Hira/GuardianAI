import type { Alert } from './index'

export type MapAreaIconKind = 'building' | 'parking' | 'road' | 'perimeter' | 'remote'

export interface MapZone {
  id: string
  label: string
  cameraId: number
  zoneIndex: number
  points: string
  areaId: string
  yoloReady?: boolean
}

export interface MapArea {
  id: string
  label: string
  subtitle: string
  cameraId: number
  accent: string
  cardColor: string
  icon: MapAreaIconKind
  cardX: number
  cardY: number
  sceneX: number
  sceneY: number
  downMessage?: string
}

export interface MapBuilding {
  id: string
  label: string
  points: string
  areaId: string
  height: number
  accent: string
}

export interface MapGate {
  id: string
  label: string
  areaId: string
  cx: number
  y: number
  width: number
  scale?: number
}

export interface MapRoadConfig {
  y: number
  height: number
  cameraId: number
  label: string
}

export type MapZoneState = 'clear' | 'active' | 'critical'

export interface MapZoneAlertInfo {
  state: MapZoneState
  alerts: Alert[]
}

export interface MapTree {
  cx: number
  cy: number
  r: number
}

export interface MapPath {
  d: string
}
