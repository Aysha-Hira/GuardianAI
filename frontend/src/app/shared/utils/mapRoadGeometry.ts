import { MAP_ROAD_PATH } from '../data/cctvMapLayout'

type Point = readonly [number, number]

/** Quadratic segments parsed from MAP_ROAD_PATH. */
const ROAD_SEGMENTS: ReadonlyArray<{ p0: Point; p1: Point; p2: Point }> = (() => {
  const nums = MAP_ROAD_PATH.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  if (nums.length < 8) return []

  return [
    {
      p0: [nums[0], nums[1]],
      p1: [nums[2], nums[3]],
      p2: [nums[4], nums[5]],
    },
    {
      p0: [nums[4], nums[5]],
      p1: [nums[6], nums[7]],
      p2: [nums[8], nums[9]],
    },
  ]
})()

function quadPoint(p0: Point, p1: Point, p2: Point, t: number) {
  const u = 1 - t
  return {
    x: u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    y: u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  }
}

function quadTangent(p0: Point, p1: Point, p2: Point, t: number) {
  const u = 1 - t
  return {
    x: 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
    y: 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]),
  }
}

/** Position and heading on the access road, t ∈ [0, 1]. */
export function pointOnMapRoad(t: number) {
  const clamped = Math.min(1, Math.max(0, t))
  const segCount = ROAD_SEGMENTS.length || 1
  const scaled = clamped * segCount
  const segIndex = Math.min(segCount - 1, Math.floor(scaled))
  const localT = scaled - segIndex
  const { p0, p1, p2 } = ROAD_SEGMENTS[segIndex] ?? ROAD_SEGMENTS[0]

  const pt = quadPoint(p0, p1, p2, localT)
  const tan = quadTangent(p0, p1, p2, localT)
  const angle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI

  return { x: pt.x, y: pt.y, angle }
}
