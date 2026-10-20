import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { CameraViewComponent } from '../features/monitor/camera-view'
import { MonitorService } from '../features/monitor/monitor.service'
import {
  AlertDetailModalComponent,
  IncidentFocusPanelComponent,
  MonitorAlertsPanelComponent,
  MonitorToastComponent,
} from '../features/monitor/side-panels'

@Component({
  selector: 'app-monitoring',
  imports: [
    CameraViewComponent,
    IncidentFocusPanelComponent,
    MonitorAlertsPanelComponent,
    MonitorToastComponent,
    AlertDetailModalComponent,
  ],
  providers: [MonitorService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="monitor-root">
      <div class="monitor-layout">
        <div class="monitor-main-col">
          <app-camera-view />
        </div>
        <div [class]="'monitor-side-col' + (alertsOpen() ? '' : ' monitor-side-col-collapsed')">
          <button type="button" class="monitor-alerts-toggle lg:hidden" (click)="alertsOpen.set(!alertsOpen())" [attr.aria-expanded]="alertsOpen()">
            {{ alertsOpen() ? 'Hide alerts panel' : 'Show alerts panel' }}
          </button>
          @if (alertsOpen()) {
            @if (m.focusActive()) {
              <app-incident-focus-panel />
            }
            <app-monitor-alerts-panel />
          }
        </div>
      </div>
      <app-alert-detail-modal />
      <app-monitor-toast />
    </div>
  `,
})
export class MonitoringPage {
  protected readonly m = inject(MonitorService)
  protected readonly alertsOpen = signal(true)
}
