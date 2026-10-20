export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  left: number
  top: number
}

export function getContainedImageRect(container: Size, image: Size): Rect {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  const containerAspect = container.width / container.height
  const imageAspect = image.width / image.height

  if (imageAspect > containerAspect) {
    const width = container.width
    const height = container.width / imageAspect
    return { left: 0, top: (container.height - height) / 2, width, height }
  }

  const height = container.height
  const width = container.height * imageAspect
  return { left: (container.width - width) / 2, top: 0, width, height }
}

export interface NormalizedPoint {
  x: number
  y: number
}

export function mapLandmarksToViewport(
  landmarks: NormalizedPoint[],
  imageRect: Rect,
): { x: number; y: number }[] {
  return landmarks.map((lm) => ({
    x: imageRect.left + lm.x * imageRect.width,
    y: imageRect.top + lm.y * imageRect.height,
  }))
}

export function boundsFromPoints(
  points: { x: number; y: number }[],
  padding = 0.12,
): Rect | null {
  if (points.length === 0) return null

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padX = (maxX - minX) * padding
  const padY = (maxY - minY) * padding

  return {
    left: minX - padX,
    top: minY - padY,
    width: maxX - minX + padX * 2,
    height: maxY - minY + padY * 2,
  }
}
