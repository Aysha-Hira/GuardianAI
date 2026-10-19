import { NgTemplateOutlet } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import {
  CCTV_MAP_VIEWBOX,
  MAP_AREAS,
  MAP_BUILDINGS,
  MAP_GATES,
  MAP_LAKE,
  MAP_PATHS,
  MAP_ROAD_PATH,
  MAP_ROAD_VEHICLES,
  MAP_TREES,
} from '../../shared/data/cctvMapLayout'
import type { MapGate } from '../../shared/types/cctvMap'
import { SvgAttrsDirective, type SvgGroup, type SvgShape } from '../../shared/ui/svg-attrs'
import { extrudePolygon, MAP_SITE_CENTER, polygonCenter, rotateSitePoint } from '../../shared/utils/isoMapGeometry'
import { pointOnMapRoad } from '../../shared/utils/mapRoadGeometry'

const STARS: [number, number][] = [
  [120, 80], [890, 120], [760, 55], [340, 45], [980, 280],
  [45, 320], [620, 90], [180, 420], [850, 380], [420, 520],
]

/** Dark isometric pine (React SceneTree). */
function treeGroup(cx: number, cy: number, r: number): SvgGroup {
  const s = r / 10
  return {
    a: { transform: `translate(${cx}, ${cy}) scale(${s})`, class: 'cctv-scene-tree' },
    shapes: [
      { t: 'ellipse', a: { cx: 0, cy: 14, rx: 9, ry: 3, fill: 'rgba(0,0,0,0.45)' } },
      { t: 'rect', a: { x: -1.5, y: 4, width: 3, height: 10, fill: '#1a2230' } },
      { t: 'polygon', a: { points: '0,-16 -11,2 11,2', fill: '#1e2838' } },
      { t: 'polygon', a: { points: '0,-10 -8,6 8,6', fill: '#263040' } },
      { t: 'polygon', a: { points: '0,-4 -6,10 6,10', fill: '#2f3a4d' } },
    ],
  }
}

/** Car marker on the access road (React SceneVehicle). */
function vehicleGroup(t: number): SvgGroup {
  const { x, y, angle } = pointOnMapRoad(t)
  return {
    a: { transform: `translate(${x}, ${y}) rotate(${angle})`, class: 'cctv-scene-vehicle-g' },
    shapes: [
      { t: 'ellipse', a: { cx: 0, cy: 7, rx: 12, ry: 3, fill: 'rgba(0,0,0,0.4)' } },
      { t: 'rect', a: { x: -12, y: -2, width: 24, height: 9, rx: 2.5, class: 'cctv-scene-vehicle-body' } },
      { t: 'rect', a: { x: -8, y: -6, width: 16, height: 5, rx: 1.5, class: 'cctv-scene-vehicle-cabin' } },
      { t: 'circle', a: { cx: -7, cy: 7, r: 2.5, class: 'cctv-scene-vehicle-wheel' } },
      { t: 'circle', a: { cx: 7, cy: 7, r: 2.5, class: 'cctv-scene-vehicle-wheel' } },
    ],
  }
}

/** Entrance gate — posts, barrier arm, fence wings (React SceneGate). */
function gateGroup(g: MapGate, selected: boolean): SvgGroup {
  const { cx, y, width } = g
  const scale = g.scale ?? 1
  const half = width / 2
  const lx = cx - half
  const rx = cx + half
  const postW = 8
  const postH = 24
  const armY = y - postH + 8
  const fenceReach = 34
  const shapes: SvgShape[] = [
    { t: 'ellipse', a: { cx, cy: y + 3, rx: half + 12, ry: 5, fill: 'rgba(0,0,0,0.35)' } },
    { t: 'path', a: { d: `M ${cx} ${y - 38} L ${cx - 11} ${y - 6} L ${cx + 11} ${y - 6} Z`, class: 'cctv-scene-gate-lane' } },
    { t: 'line', a: { x1: lx - fenceReach, y1: y, x2: lx - 2, y2: y, class: 'cctv-scene-gate-fence' } },
    { t: 'line', a: { x1: rx + 2, y1: y, x2: rx + fenceReach, y2: y, class: 'cctv-scene-gate-fence' } },
  ]
  for (let i = 0; i < 3; i++) {
    const x = lx - fenceReach + 6 + i * 10
    shapes.push({ t: 'line', a: { x1: x, y1: y - 10, x2: x, y2: y, class: 'cctv-scene-gate-fence-post' } })
  }
  for (let i = 0; i < 3; i++) {
    const x = rx + 6 + i * 10
    shapes.push({ t: 'line', a: { x1: x, y1: y - 10, x2: x, y2: y, class: 'cctv-scene-gate-fence-post' } })
  }
  for (const px of [lx, rx]) {
    shapes.push(
      {
        t: 'polygon',
        a: {
          points: `${px - postW / 2},${y} ${px + postW / 2},${y} ${px + postW / 2 + 3},${y - 3} ${px - postW / 2 + 3},${y - 3}`,
          class: 'cctv-scene-gate-post-face',
        },
      },
      { t: 'rect', a: { x: px - postW / 2, y: y - postH, width: postW, height: postH, class: 'cctv-scene-gate-post-front' } },
      {
        t: 'polygon',
        a: {
          points: `${px + postW / 2},${y - postH} ${px + postW / 2 + 3},${y - postH - 3} ${px + postW / 2 + 3},${y - 3} ${px + postW / 2},${y}`,
          class: 'cctv-scene-gate-post-side',
        },
      },
      { t: 'rect', a: { x: px - postW / 2 - 1, y: y - postH - 4, width: postW + 2, height: 4, rx: 1, class: 'cctv-scene-gate-cap' } },
    )
  }
  shapes.push({ t: 'rect', a: { x: lx + 5, y: armY, width: width - 10, height: 4, rx: 1, class: 'cctv-scene-gate-arm' } })
  for (let i = 0; i < 5; i++) {
    shapes.push({
      t: 'rect',
      a: { x: lx + 10 + i * 14, y: armY, width: 6, height: 4, class: i % 2 === 0 ? 'cctv-scene-gate-arm-mark' : 'cctv-scene-gate-arm-mark-alt' },
    })
  }
  if (selected) {
    shapes.push({
      t: 'rect',
      a: { x: lx - 6, y: y - postH - 8, width: width + 12, height: postH + 14, fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5, rx: 3, class: 'cctv-scene-gate-highlight' },
    })
  }
  return {
    a: {
      class: `cctv-scene-gate ${selected ? 'is-selected' : ''}`,
      transform: scale === 1 ? null : `translate(${cx} ${y}) scale(${scale}) translate(${-cx} ${-y})`,
    },
    shapes,
  }
}

/** Port of React's MapTwinScene (isometric site twin). */
@Component({
  selector: 'app-map-twin-scene',
  imports: [NgTemplateOutlet, SvgAttrsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <ng-template #shape let-s>
      @switch (s.t) {
        @case ('ellipse') { <svg:ellipse [appSvgAttrs]="s.a"></svg:ellipse> }
        @case ('rect') { <svg:rect [appSvgAttrs]="s.a"></svg:rect> }
        @case ('circle') { <svg:circle [appSvgAttrs]="s.a"></svg:circle> }
        @case ('line') { <svg:line [appSvgAttrs]="s.a"></svg:line> }
        @case ('path') { <svg:path [appSvgAttrs]="s.a"></svg:path> }
        @case ('polygon') { <svg:polygon [appSvgAttrs]="s.a"></svg:polygon> }
      }
    </ng-template>

    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" class="cctv-map-svg" aria-hidden="true">
      <defs>
        <radialGradient id="scene-bg" cx="50%" cy="38%" r="75%">
          <stop offset="0%" stop-color="#1a2436" />
          <stop offset="45%" stop-color="#0e141e" />
          <stop offset="100%" stop-color="#05070a" />
        </radialGradient>
        <radialGradient id="scene-lake" cx="45%" cy="40%" r="55%">
          <stop offset="0%" stop-color="rgba(34,211,238,0.55)" />
          <stop offset="100%" stop-color="rgba(6,40,54,0.12)" />
        </radialGradient>
        <radialGradient id="scene-spotlight" cx="50%" cy="45%" r="40%">
          <stop offset="0%" stop-color="rgba(34,211,238,0.08)" />
          <stop offset="100%" stop-color="transparent" />
        </radialGradient>
        <pattern id="scene-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.04)" stroke-width="0.5" />
        </pattern>
        <filter id="path-glow"><feGaussianBlur stdDeviation="5" /></filter>
        <clipPath id="terrain-clip"><ellipse cx="500" cy="360" rx="480" ry="290" /></clipPath>
      </defs>

      <rect [attr.width]="width" [attr.height]="height" fill="url(#scene-bg)" />
      <rect [attr.width]="width" [attr.height]="height" fill="url(#scene-grid)" opacity="0.6" />
      <ellipse cx="500" cy="340" rx="420" ry="260" fill="url(#scene-spotlight)" />

      @for (star of stars; track $index; let i = $index) {
        <circle [attr.cx]="star[0]" [attr.cy]="star[1]" [attr.r]="i % 3 === 0 ? 1.2 : 0.8" fill="rgba(148,163,184,0.25)" [attr.opacity]="0.4 + (i % 4) * 0.15" />
      }

      <g [attr.transform]="'rotate(' + orbitYaw() + ' ' + center.x + ' ' + center.y + ')'">
        <ellipse cx="500" cy="360" rx="480" ry="290" fill="#111820" opacity="0.9" />
        <ellipse cx="500" cy="360" rx="472" ry="282" fill="none" stroke="rgba(34,211,238,0.1)" stroke-width="1" stroke-dasharray="6 14" />

        @for (p of paths; track $index) {
          <g class="cctv-scene-paths">
            <path [attr.d]="p.d" fill="none" stroke="rgba(34,211,238,0.28)" stroke-width="8" stroke-linecap="round" filter="url(#path-glow)" opacity="0.55" />
            <path [attr.d]="p.d" fill="none" stroke="rgba(34,211,238,0.65)" stroke-width="2" stroke-linecap="round" class="cctv-scene-path-line" />
          </g>
        }

        <g class="cctv-scene-road" clip-path="url(#terrain-clip)">
          <path [attr.d]="roadPath" fill="none" stroke="#181e28" stroke-width="36" stroke-linecap="round" />
          <path [attr.d]="roadPath" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" stroke-dasharray="14 12" stroke-linecap="round" />
          @for (v of vehicles; track $index) {
            <g [appSvgAttrs]="v.a">
              @for (s of v.shapes; track $index) {
                <ng-container *ngTemplateOutlet="shape; context: { $implicit: s }" />
              }
            </g>
          }
        </g>

        <ellipse [attr.cx]="lake.cx" [attr.cy]="lake.cy" [attr.rx]="lake.rx" [attr.ry]="lake.ry" fill="url(#scene-lake)" stroke="rgba(34,211,238,0.3)" stroke-width="1" />

        @for (t of trees; track $index) {
          <g [appSvgAttrs]="t.a">
            @for (s of t.shapes; track $index) {
              <ng-container *ngTemplateOutlet="shape; context: { $implicit: s }" />
            }
          </g>
        }

        @for (g of gates(); track $index) {
          <g [appSvgAttrs]="g.a">
            @for (s of g.shapes; track $index) {
              <ng-container *ngTemplateOutlet="shape; context: { $implicit: s }" />
            }
          </g>
        }

        @for (a of areas; track a.id) {
          <circle [attr.cx]="a.sceneX" [attr.cy]="a.sceneY" [attr.r]="selectedAreaId() === a.id ? 14 : 8"
            [attr.class]="'cctv-scene-anchor ' + (selectedAreaId() === a.id ? 'is-active' : '')" />
        }
      </g>

      @for (b of buildings(); track b.id) {
        <g [appSvgAttrs]="b.a">
          @for (s of b.shapes; track $index) {
            <ng-container *ngTemplateOutlet="shape; context: { $implicit: s }" />
          }
        </g>
      }

      @if (view3d() && selectedAreaId() === 'main-building') {
        <ellipse [attr.cx]="glow()[0]" [attr.cy]="glow()[1]" rx="80" ry="36" fill="rgba(34,211,238,0.12)" filter="url(#path-glow)" />
      }
    </svg>
  `,
})
export class MapTwinSceneComponent {
  readonly selectedAreaId = input<string | null>(null)
  readonly orbitYaw = input(0)
  readonly view3d = input(true)

  protected readonly width = CCTV_MAP_VIEWBOX.width
  protected readonly height = CCTV_MAP_VIEWBOX.height
  protected readonly center = MAP_SITE_CENTER
  protected readonly stars = STARS
  protected readonly paths = MAP_PATHS
  protected readonly roadPath = MAP_ROAD_PATH
  protected readonly lake = MAP_LAKE
  protected readonly areas = MAP_AREAS
  protected readonly vehicles = MAP_ROAD_VEHICLES.map((v) => vehicleGroup(v.t))
  protected readonly trees = MAP_TREES.map((t) => treeGroup(t.cx, t.cy, t.r))
  protected readonly gates = computed(() => MAP_GATES.map((g) => gateGroup(g, this.selectedAreaId() === g.areaId)))
  protected readonly glow = computed(() => rotateSitePoint(500, 310, this.orbitYaw()))

  /** Buildings re-projected for the orbit angle and depth-sorted (React StructureMass). */
  protected readonly buildings = computed(() => {
    const yaw = this.orbitYaw()
    const view3d = this.view3d()
    const selectedArea = this.selectedAreaId()
    const depth = (pts: string) => {
      const [x, y] = polygonCenter(pts, yaw)
      return x + y
    }
    return [...MAP_BUILDINGS]
      .sort((a, b) => depth(a.points) - depth(b.points))
      .map((b) => {
        const iso = extrudePolygon(b.points, b.height, yaw)
        const selected = selectedArea === b.areaId
        const shapes: SvgShape[] = []
        if (!view3d) {
          shapes.push({ t: 'polygon', a: { points: iso.floor, fill: 'rgba(52,211,153,0.08)', stroke: 'rgba(52,211,153,0.35)', 'stroke-width': 1.5 } })
          if (selected) {
            shapes.push({ t: 'polygon', a: { points: iso.floor, fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5, class: 'cctv-structure-highlight' } })
          }
          return { id: b.id, a: { class: 'cctv-structure cctv-structure--flat', 'data-id': b.id }, shapes }
        }
        shapes.push({ t: 'polygon', a: { points: iso.floor, fill: 'rgba(0,0,0,0.35)', transform: 'translate(4 6)' } })
        for (const wall of iso.walls) {
          shapes.push({ t: 'polygon', a: { points: wall.points, class: `cctv-structure-wall cctv-structure-wall--${wall.shade}` } })
        }
        shapes.push({ t: 'polygon', a: { points: iso.floor, class: 'cctv-structure-base' } })
        shapes.push({ t: 'polygon', a: { points: iso.roof, class: 'cctv-structure-roof' } })
        if (selected) {
          shapes.push({ t: 'polygon', a: { points: iso.roof, fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5, class: 'cctv-structure-highlight' } })
        }
        return { id: b.id, a: { class: 'cctv-structure', 'data-id': b.id }, shapes }
      })
  })
}
