import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/** Port of React's AuthAlert. Usage: <div appAuthAlert variant="error">…</div> */
@Component({
  selector: 'div[appAuthAlert]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"auth-alert auth-alert-" + variant()' },
  template: `<ng-content />`,
})
export class AuthAlertComponent {
  readonly variant = input<'error' | 'success' | 'info'>('info')
}

/** Port of React's AuthDemoBanner. Usage: <div appAuthDemoBanner bannerTitle="…">…</div> */
@Component({
  selector: 'div[appAuthDemoBanner]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'auth-demo-banner' },
  template: `
    <p class="auth-demo-title">{{ bannerTitle() }}</p>
    <div class="auth-demo-body"><ng-content /></div>
  `,
})
export class AuthDemoBannerComponent {
  readonly bannerTitle = input.required<string>()
}
