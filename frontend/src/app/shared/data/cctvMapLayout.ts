import type { MapArea, MapBuilding, MapGate, MapPath, MapRoadConfig, MapTree, MapZone } from '../types/cctvMap'

export const CCTV_MAP_VIEWBOX = { width: 1000, height: 720 }

export const MAP_AREAS: MapArea[] = [
  {
    id: 'main-building',
    label: 'Operations Center',
    subtitle: '1 active camera',
    cameraId: 1,
    accent: '#34d399',
    cardColor: '#22c55e',
    icon: 'building',
    cardX: 46,
    cardY: 24,
    sceneX: 500,
    sceneY: 280,
  },
  {
    id: 'west-parking',
    label: 'West Parking',
    subtitle: 'Parking & access road',
    cameraId: 2,
    accent: '#a78bfa',
    cardColor: '#a855f7',
    icon: 'parking',
    cardX: 22,
    cardY: 30,
    sceneX: 190,
    sceneY: 340,
  },
  {
    id: 'access-road',
    label: 'Access Road',
    subtitle: 'Vehicle detection lane',
    cameraId: 4,
    accent: '#34d399',
    cardColor: '#22c55e',
    icon: 'road',
    cardX: 44,
    cardY: 62,
    sceneX: 500,
    sceneY: 512,
  },
  {
    id: 'east-perimeter',
    label: 'East Perimeter',
    subtitle: 'Fence line coverage',
    cameraId: 3,
    accent: '#38bdf8',
    cardColor: '#eab308',
    icon: 'perimeter',
    cardX: 74,
    cardY: 28,
    sceneX: 820,
    sceneY: 320,
  },
  {
    id: 'north-gate',
    label: 'North Gate',
    subtitle: 'Remote perimeter camera',
    cameraId: 5,
    accent: '#fb923c',
    cardColor: '#f97316',
    icon: 'remote',
    cardX: 50,
    cardY: 6,
    sceneX: 500,
    sceneY: 132,
    downMessage: 'Camera down — please check',
  },
]

export const MAP_BUILDINGS: MapBuilding[] = [
  {
    id: 'building-main',
    label: 'Operations Center',
    areaId: 'main-building',
    points: '380,200 620,200 650,260 650,380 350,380 350,260',
    height: 36,
    accent: '#64748b',
  },
  {
    id: 'building-west',
    label: 'West Parking',
    areaId: 'west-parking',
    points: '100,280 280,280 280,430 100,430',
    height: 14,
    accent: '#64748b',
  },
  {
    id: 'building-east',
    label: 'East Perimeter',
    areaId: 'east-perimeter',
    points: '740,260 900,260 900,410 740,410',
    height: 22,
    accent: '#64748b',
  },
]

export const MAP_GATES: MapGate[] = [
  {
    id: 'gate-north',
    label: 'North Gate',
    areaId: 'north-gate',
    cx: 500,
    y: 162,
    width: 92,
    scale: 0.78,
  },
]

export const MAP_LAKE = { cx: 520, cy: 330, rx: 120, ry: 65 }

export const MAP_PATHS: MapPath[] = [
  { d: 'M 500 92 Q 500 118 500 162 Q 500 210 500 268' },
  { d: 'M 280 400 Q 360 330 430 300 T 500 285' },
  { d: 'M 520 285 Q 640 275 760 295 T 880 330' },
  { d: 'M 300 410 Q 500 470 700 410' },
]

export const MAP_ROAD_PATH =
  'M 140,445 Q 310,535 500,518 Q 690,500 860,442'

export const MAP_ROAD_VEHICLES = [
  { id: 'v1', t: 0.14 },
  { id: 'v2', t: 0.36 },
  { id: 'v3', t: 0.58 },
  { id: 'v4', t: 0.8 },
]

export const MAP_TREES: MapTree[] = [
  { cx: 130, cy: 165, r: 11 },
  { cx: 200, cy: 135, r: 10 },
  { cx: 270, cy: 185, r: 12 },
  { cx: 340, cy: 155, r: 9 },
  { cx: 660, cy: 155, r: 10 },
  { cx: 730, cy: 175, r: 12 },
  { cx: 820, cy: 160, r: 11 },
  { cx: 900, cy: 200, r: 9 },
  { cx: 95, cy: 360, r: 10 },
  { cx: 310, cy: 395, r: 11 },
  { cx: 680, cy: 385, r: 10 },
  { cx: 880, cy: 370, r: 11 },
  { cx: 170, cy: 560, r: 9 },
  { cx: 830, cy: 545, r: 10 },
  { cx: 460, cy: 200, r: 8 },
  { cx: 560, cy: 195, r: 8 },
  { cx: 420, cy: 580, r: 9 },
  { cx: 600, cy: 575, r: 9 },
]

export const SIDEBAR_AREAS: MapArea[] = MAP_AREAS

export const MAP_ZONES: MapZone[] = [
  {
    id: 'lobby-entry',
    label: 'Lobby / Entry',
    cameraId: 1,
    zoneIndex: 0,
    areaId: 'main-building',
    points: '430,220 570,220 570,330 430,330',
  },
  {
    id: 'parking-lot',
    label: 'Parking Lot',
    cameraId: 2,
    zoneIndex: 0,
    areaId: 'west-parking',
    points: '100,240 260,240 260,400 100,400',
  },
  {
    id: 'perimeter-fence',
    label: 'Perimeter Fence',
    cameraId: 3,
    zoneIndex: 0,
    areaId: 'east-perimeter',
    points: '740,220 900,220 900,390 740,390',
  },
  {
    id: 'access-road',
    label: 'Access Road',
    cameraId: 4,
    zoneIndex: 0,
    areaId: 'access-road',
    yoloReady: true,
    points: '260,470 740,470 760,540 240,540',
  },
]

export const MAP_ROAD: MapRoadConfig = {
  y: 512,
  height: 48,
  cameraId: 4,
  label: 'Access Road',
}
