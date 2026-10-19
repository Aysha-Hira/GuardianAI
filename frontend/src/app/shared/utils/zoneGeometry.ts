import type { ZoneRect } from '../types/monitor'

export interface VideoLayout {
  vpW: number
  vpH: number
  nw: number
  nh: number
  dw: number
  dh: number
  dx: number
  dy: number
}

export function getVideoLayout(
  vpW: number,
  vpH: number,
  nw: number,
  nh: number,
): VideoLayout {
  const imgRatio = nw / nh
  const vpRatio = vpW / vpH
  let dw: number
  let dh: number
  let dx: number
  let dy: number
  if (imgRatio > vpRatio) {
    dw = vpW
    dh = vpW / imgRatio
    dx = 0
    dy = (vpH - dh) / 2
  } else {
    dh = vpH
    dw = vpH * imgRatio
    dx = (vpW - dw) / 2
    dy = 0
  }
  return { vpW, vpH, nw, nh, dw, dh, dx, dy }
}

export function viewportPointToNormalized(
  vx: number,
  vy: number,
  layout: VideoLayout,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  const { vpW, vpH, dw, dh, dx, dy } = layout
  const cx = vpW / 2
  const cy = vpH / 2
  const px = (vx - cx - panX) / zoom + cx
  const py = (vy - cy - panY) / zoom + cy
  return {
    x: Math.max(0, Math.min(1, (px - dx) / dw)),
    y: Math.max(0, Math.min(1, (py - dy) / dh)),
  }
}

export function normalizedRectToViewport(
  norm: ZoneRect,
  layout: VideoLayout,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number; w: number; h: number } {
  const { dw, dh, dx, dy, vpW, vpH } = layout
  const cx = vpW / 2
  const cy = vpH / 2
  const toVp = (nx: number, ny: number) => {
    let px = dx + nx * dw
    let py = dy + ny * dh
    px = (px - cx) * zoom + cx + panX
    py = (py - cy) * zoom + cy + panY
    return { x: px, y: py }
  }
  const p1 = toVp(norm.x, norm.y)
  const p2 = toVp(norm.x + norm.width, norm.y + norm.height)
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  }
}

export function clampNormZone(z: ZoneRect): ZoneRect {
  const x = Math.max(0, Math.min(1, z.x))
  const y = Math.max(0, Math.min(1, z.y))
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, z.width)),
    height: Math.max(0.01, Math.min(1 - y, z.height)),
  }
}

export function normRectFromPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): ZoneRect | null {
  const x = Math.min(p1.x, p2.x)
  const y = Math.min(p1.y, p2.y)
  const width = Math.abs(p2.x - p1.x)
  const height = Math.abs(p2.y - p1.y)
  if (width < 0.008 || height < 0.008) return null
  return { x, y, width, height }
}

const ZONE_HANDLE = 10

export function zoneHandles(r: { x: number; y: number; w: number; h: number }) {
  const h = ZONE_HANDLE
  return {
    nw: { x: r.x - h / 2, y: r.y - h / 2, w: h, h: h },
    ne: { x: r.x + r.w - h / 2, y: r.y - h / 2, w: h, h: h },
    sw: { x: r.x - h / 2, y: r.y + r.h - h / 2, w: h, h: h },
    se: { x: r.x + r.w - h / 2, y: r.y + r.h - h / 2, w: h, h: h },
  }
}

export function pointInBox(
  px: number,
  py: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return px >= bx && px <= bx + bw && py >= by && py <= by + bh
}

export function hitTestZoneEdit(
  px: number,
  py: number,
  zones: ZoneRect[],
  layout: VideoLayout,
  zoom: number,
  panX: number,
  panY: number,
): { mode: string; index: number } {
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const r = normalizedRectToViewport(zones[i], layout, zoom, panX, panY)
    const handles = zoneHandles(r)
    for (const [name, h] of Object.entries(handles)) {
      if (pointInBox(px, py, h.x, h.y, h.w, h.h)) {
        return { mode: `resize-${name}`, index: i }
      }
    }
    if (pointInBox(px, py, r.x, r.y, r.w, r.h)) {
      return { mode: 'move', index: i }
    }
  }
  return { mode: 'draw', index: -1 }
}

export function applyZoneResize(
  origin: ZoneRect,
  handle: string,
  currentNorm: { x: number; y: number },
): ZoneRect {
  let { x, y, width, height } = { ...origin }
  const cx = currentNorm.x
  const cy = currentNorm.y
  if (handle === 'se') {
    width = cx - x
    height = cy - y
  } else if (handle === 'sw') {
    const x2 = x + width
    x = cx
    width = x2 - x
    height = cy - y
  } else if (handle === 'ne') {
    const y2 = y + height
    width = cx - x
    y = cy
    height = y2 - y
  } else if (handle === 'nw') {
    const x2 = x + width
    const y2 = y + height
    x = cx
    y = cy
    width = x2 - x
    height = y2 - y
  }
  if (width < 0) {
    x += width
    width = Math.abs(width)
  }
  if (height < 0) {
    y += height
    height = Math.abs(height)
  }
  return clampNormZone({ x, y, width, height })
}
