import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { createPoll, POLL_KEYS } from '../core/polling'
import { CctvMapCanvasComponent, MapCommandBarComponent, MapLocationPanelComponent } from '../features/cctv-map/map-ui'
import { MAP_AREAS } from '../shared/data/cctvMapLayout'
import { api } from '../shared/services/api'
import { ErrorStateComponent, LoadingStateComponent } from '../shared/ui/common'
import { CCTV_FEED_COUNT, countLiveFeeds } from '../shared/utils/cameraLabels'
import { getActiveAlerts } from '../shared/utils/cctvMapAlerts'

/** Port of React's pages/CctvMap. */
@Component({
  selector: 'app-cctv-map',
  imports: [CctvMapCanvasComponent, MapCommandBarComponent, MapLocationPanelComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (camerasPoll.offline() && !camerasPoll.data()) {
      <div appErrorState message="Cannot reach Guardian AI backend."></div>
    } @else {
      <div class="cctv-map-page">
        <app-map-command-bar [liveCount]="liveCount()" [totalFeeds]="feedCount" [activeIncidents]="activeAlerts().length" />

        <div class="cctv-map-layout">
          <app-map-location-panel
            [alerts]="alerts()"
            [cameras]="cameras()"
            [selectedAreaId]="selectedAreaId()"
            [selectedCameraId]="selectedCameraId()"
            (selectArea)="onSelectAreaId($event)"
            (selectCamera)="onSelectCamera($event)"
          />

          <div class="cctv-map-main">
            @if (camerasPoll.loading() && !camerasPoll.data()) {
              <div appLoadingState message="Loading site map…" [compact]="true"></div>
            } @else {
              <app-cctv-map-canvas
                [alerts]="alerts()"
                [cameras]="cameras()"
                [selectedAreaId]="selectedAreaId()"
                [selectedCameraId]="selectedCameraId()"
                (selectArea)="select($event.areaId, $event.cameraId)"
                (closePreview)="selectedCameraId.set(null); selectedAreaId.set(null)"
              />
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CctvMapPage {
  protected readonly camerasPoll = createPoll(() => api.getCameras(), 8000, POLL_KEYS.cameras)
  private readonly alertsPoll = createPoll(() => api.getAlerts(), 5000, POLL_KEYS.alerts)
  protected readonly feedCount = CCTV_FEED_COUNT

  protected readonly selectedAreaId = signal<string | null>(null)
  protected readonly selectedCameraId = signal<number | null>(null)

  protected readonly cameras = computed(() => this.camerasPoll.data()?.cameras ?? [])
  protected readonly alerts = computed(() => this.alertsPoll.data()?.alerts ?? [])
  protected readonly activeAlerts = computed(() => getActiveAlerts(this.alerts()))
  protected readonly liveCount = computed(() => countLiveFeeds(this.cameras()))

  protected select(areaId: string, cameraId: number) {
    this.selectedAreaId.set(areaId)
    this.selectedCameraId.set(cameraId)
  }

  protected onSelectAreaId(id: string) {
    const area = MAP_AREAS.find((a) => a.id === id)
    if (area) this.select(id, area.cameraId)
  }

  protected onSelectCamera(cameraId: number) {
    const area =
      MAP_AREAS.find((a) => a.cameraId === cameraId && a.id === this.selectedAreaId()) ??
      MAP_AREAS.find((a) => a.cameraId === cameraId && a.id !== 'access-road') ??
      MAP_AREAS.find((a) => a.cameraId === cameraId)
    if (area) this.select(area.id, cameraId)
  }
}
