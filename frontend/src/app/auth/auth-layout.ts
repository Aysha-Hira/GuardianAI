import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink, RouterOutlet } from '@angular/router'
import { PageTransitionDirective } from '../shared/ui/page-transition'

@Component({
  selector: 'app-auth-layout',
  imports: [RouterLink, RouterOutlet, PageTransitionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-shell">
      <aside class="auth-brand">
        <div class="auth-brand-inner">
          <div class="auth-logo-mark" aria-hidden="true">
            <span class="auth-logo-ring"></span>
            <span class="auth-logo-core">G</span>
          </div>
          <h1 class="auth-brand-title">Guardian AI</h1>
          <p class="auth-brand-tagline">
            Intelligent CCTV monitoring, incident detection, and operator control — secured
            for your team.
          </p>
          <ul class="auth-brand-features">
            <li>Real-time person tracking &amp; zone alerts</li>
            <li>Incident focus &amp; evidence capture</li>
            <li>Multi-camera operations dashboard</li>
          </ul>
          <p class="auth-brand-foot">
            Secure operator accounts with email verification and JWT session protection.
          </p>
        </div>
        <div class="auth-brand-grid" aria-hidden="true"></div>
      </aside>

      <main class="auth-main">
        <div class="auth-main-inner">
          <a routerLink="/" class="auth-mobile-logo">Guardian AI</a>
          <div appPageTransition><router-outlet /></div>
        </div>
      </main>
    </div>
  `,
})
export class AuthLayoutComponent {}
