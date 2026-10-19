/** Site map zone linked to a CCTV channel + video zone index. */
import type { Alert } from './index'

export type MapAreaIconKind = 'building' | 'parking' | 'road' | 'perimeter' | 'remote'

export interface MapZone {
  id: string
  label: string
  cameraId: number
  zoneIndex: number
  /** SVG polygon points (viewBox coords). */
  points: string
  areaId: string
  /** Optional — road / YOLO detection lane. */
  yoloReady?: boolean
}

export interface MapArea {
  id: string
  label: string
  subtitle: string
  cameraId: number
  accent: string
  /** Floating card accent (reference-style tags). */
  cardColor: string
  icon: MapAreaIconKind
  /** Card anchor (% of map viewport). */
  cardX: number
  cardY: number
  /** Scene center for wireframe highlight. */
  sceneX: number
  sceneY: number
  /** Shown on map pin when the remote feed is unreachable. */
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

/** Site entrance gate — rendered as barrier posts, not a building mass. */
export interface MapGate {
  id: string
  label: string
  areaId: string
  /** Center of the gate opening (viewBox coords). */
  cx: number
  /** Ground line where posts meet the road. */
  y: number
  width: number
  /** Visual scale — default 1. */
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
