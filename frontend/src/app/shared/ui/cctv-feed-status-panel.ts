import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import type { CameraChannel } from '../types'
import { cameraBadgeLabel, CCTV_FEED_COUNT, feedStatusLabel, feedStatusTone } from '../utils/cameraLabels'
import { isSearchingChannel, normalizeWallCameras } from '../utils/wallCameras'
import { PanelComponent } from './common'

function feedDetail(camera: CameraChannel): string {
  if (isSearchingChannel(camera)) return 'North Gate · remote perimeter'
  if (camera.filename) return camera.filename
  if (camera.id === 1) return 'Laptop webcam'
  return 'No recording loaded'
}

@Component({
  selector: 'app-cctv-feed-status-panel',
  imports: [RouterLink, PanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  template: `
    <section appPanel heading="CCTV Feeds" subtitle="Webcam + uploaded recordings — all channels can track in parallel">
      <div class="cctv-feed-grid">
        @for (feed of feeds(); track feed.id) {
          <div [class]="'cctv-feed-card cctv-feed-card-' + feed.tone">
            <div class="cctv-feed-card-head">
              <span class="cctv-feed-id">{{ feed.label }}</span>
              <span [class]="'cctv-feed-dot ' + (feed.isDown ? 'cctv-feed-dot-down' : 'cctv-feed-dot-' + feed.tone)" aria-hidden="true"></span>
              <span [class]="'cctv-feed-status' + (feed.isDown ? ' cctv-feed-status-down' : '')">{{ loading() ? '…' : feed.status }}</span>
            </div>
            <p class="cctv-feed-detail">{{ feed.detail }}</p>
            @if (feed.isDown) {
              <a routerLink="/cameras" class="cctv-feed-link">View on camera wall →</a>
            } @else {
              <a routerLink="/monitoring" [queryParams]="{ camera: feed.id }" class="cctv-feed-link">View live →</a>
            }
          </div>
        }
      </div>
      <p class="mt-3 text-xs text-guardian-muted">{{ footer() }}</p>
    </section>
  `,
})
export class CctvFeedStatusPanelComponent {
  readonly cameras = input.required<CameraChannel[]>()
  readonly loading = input(false)

  protected readonly feeds = computed(() =>
    normalizeWallCameras(this.cameras()).map((camera) => ({
      id: camera.id,
      label: cameraBadgeLabel(camera.id),
      tone: feedStatusTone(camera),
      status: feedStatusLabel(camera),
      isDown: isSearchingChannel(camera),
      detail: feedDetail(camera),
      active: camera.status === 'online' || camera.status === 'playback',
    })),
  )
  protected readonly footer = computed(() => {
    const feeds = this.feeds()
    return feeds.length > 0
      ? `${feeds.filter((f) => f.active).length} of ${CCTV_FEED_COUNT} feeds active`
      : 'Connecting to camera service…'
  })
}
