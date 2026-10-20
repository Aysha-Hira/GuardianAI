import { MAP_ZONES } from '../data/cctvMapLayout'
import type { Alert } from '../types'
import type { MapZone, MapZoneAlertInfo, MapZoneState } from '../types/cctvMap'
import { parseCameraIdFromAlert } from './cameraLabels'

const CLOSED_STATUSES = new Set(['resolved', 'false_alarm'])

const CRITICAL_SEVERITIES = new Set(['high', 'critical'])

export function isActiveAlert(alert: Alert): boolean {
  return !CLOSED_STATUSES.has(alert.status)
}

export function getActiveAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter(isActiveAlert)
}

export function getAlertsForCamera(alerts: Alert[], cameraId: number): Alert[] {
  return getActiveAlerts(alerts).filter(
    (a) => parseCameraIdFromAlert(a) === cameraId,
  )
}

export function getAlertsForZone(zone: MapZone, alerts: Alert[]): Alert[] {
  return getActiveAlerts(alerts).filter((a) => {
    const camId = parseCameraIdFromAlert(a)
    if (camId !== zone.cameraId) return false
    return a.zone_index === zone.zoneIndex
  })
}

function zoneStateFromAlerts(matched: Alert[]): MapZoneState {
  if (matched.length === 0) return 'clear'
  if (matched.some((a) => CRITICAL_SEVERITIES.has(a.severity))) return 'critical'
  return 'active'
}

export function getZoneAlertInfo(zone: MapZone, alerts: Alert[]): MapZoneAlertInfo {
  const matched = getAlertsForZone(zone, alerts)
  return { state: zoneStateFromAlerts(matched), alerts: matched }
}

export function getAllZoneStates(
  alerts: Alert[],
): Map<string, MapZoneAlertInfo> {
  const map = new Map<string, MapZoneAlertInfo>()
  for (const zone of MAP_ZONES) {
    map.set(zone.id, getZoneAlertInfo(zone, alerts))
  }
  return map
}

export function getCameraAlertCount(alerts: Alert[], cameraId: number): number {
  return getAlertsForCamera(alerts, cameraId).length
}

export function getAreaAlertCount(
  alerts: Alert[],
  areaId: string,
  areaCameraId: number,
): number {
  const zoneIds = MAP_ZONES.filter((z) => z.areaId === areaId).map((z) => z.id)
  let count = 0
  for (const alert of getActiveAlerts(alerts)) {
    const camId = parseCameraIdFromAlert(alert)
    if (camId !== areaCameraId) continue
    const zone = MAP_ZONES.find(
      (z) => z.cameraId === camId && z.zoneIndex === alert.zone_index,
    )
    if (zone && zoneIds.includes(zone.id)) count++
    else if (!zone && areaCameraId === camId) count++
  }
  return count
}
