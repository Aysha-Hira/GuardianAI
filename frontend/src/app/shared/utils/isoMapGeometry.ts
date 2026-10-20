const ISO_X = 0.8660254
const ISO_Y = 0.5

export function parsePoints(raw: string): [number, number][] {
  return raw.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return [x, y] as [number, number]
  })
}

export function pointsToString(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
}

export interface IsoExtrusion {
  floor: string
  roof: string
  walls: { points: string; shade: 'dark' | 'mid' | 'light' }[]
  depth: number
}

export const MAP_SITE_CENTER = { x: 500, y: 360 }

export function isoDepth(x: number, y: number): number {
  return x + y
}

export function rotateSitePoint(x: number, y: number, yawDeg: number): [number, number] {
  if (!yawDeg) return [x, y]
  const rad = (yawDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - MAP_SITE_CENTER.x
  const dy = y - MAP_SITE_CENTER.y
  return [
    MAP_SITE_CENTER.x + dx * cos - dy * sin,
    MAP_SITE_CENTER.y + dx * sin + dy * cos,
  ]
}

function wallShade(
  a: [number, number],
  b: [number, number],
): 'dark' | 'mid' | 'light' {
  const edgeDx = b[0] - a[0]
  if (edgeDx > 4) return 'light'
  if (edgeDx < -4) return 'dark'
  return 'mid'
}

function wallDepth(points: [number, number][]): number {
  const sx = points.reduce((s, [x]) => s + x, 0)
  const sy = points.reduce((s, [, y]) => s + y, 0)
  return isoDepth(sx / points.length, sy / points.length)
}

export function extrudePolygon(raw: string, height: number, yawDeg = 0): IsoExtrusion {
  const base = parsePoints(raw).map(([x, y]) => rotateSitePoint(x, y, yawDeg))
  const roof = base.map(([x, y]) => [x - height * ISO_X, y - height * ISO_Y] as [number, number])

  const walls: IsoExtrusion['walls'] = []
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length
    const quad: [number, number][] = [base[i], base[j], roof[j], roof[i]]
    walls.push({
      points: pointsToString(quad),
      shade: wallShade(base[i], base[j]),
    })
  }

  walls.sort((a, b) => wallDepth(parsePoints(a.points)) - wallDepth(parsePoints(b.points)))

  const floorCx = base.reduce((s, [x]) => s + x, 0) / base.length
  const floorCy = base.reduce((s, [, y]) => s + y, 0) / base.length

  return {
    floor: pointsToString(base),
    roof: pointsToString(roof),
    walls,
    depth: isoDepth(floorCx, floorCy),
  }
}

export function polygonCenter(raw: string, yawDeg = 0): [number, number] {
  const pts = parsePoints(raw).map(([x, y]) => rotateSitePoint(x, y, yawDeg))
  const sx = pts.reduce((s, [x]) => s + x, 0)
  const sy = pts.reduce((s, [, y]) => s + y, 0)
  return [sx / pts.length, sy / pts.length]
}

export function isoLift(x: number, y: number, height: number, yawDeg = 0): [number, number] {
  const [rx, ry] = rotateSitePoint(x, y, yawDeg)
  return [rx - height * ISO_X, ry - height * ISO_Y - 8]
}
