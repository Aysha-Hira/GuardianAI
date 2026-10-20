import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { AuthAlertComponent, AuthDemoBannerComponent } from '../../shared/ui/auth-alert'

@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink, AuthAlertComponent, AuthDemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-card">
      <div class="auth-card-head">
        <h2 class="auth-card-title">Reset password</h2>
        <p class="auth-card-sub">Enter your email and we'll send a link to reset your password.</p>
      </div>

      @if (error()) {
        <div appAuthAlert variant="error">{{ error() }}</div>
      }

      @if (sent()) {
        <div appAuthAlert variant="success">
          If an account exists for <strong>{{ email() }}</strong>, reset instructions have been
          sent. Check your inbox.
        </div>
        @if (demoResetPath(); as path) {
          <div appAuthDemoBanner bannerTitle="Email fallback — reset link">
            Could not send email. Use this link:
            <a class="auth-link" [routerLink]="router.parseUrl(path)">{{ origin }}{{ path }}</a>
          </div>
        }
        <p class="auth-footer">
          <a class="auth-link" routerLink="/login">← Back to sign in</a>
        </p>
      } @else {
        <form class="auth-form" (submit)="onSubmit($event)">
          <label class="auth-field" for="email">
            <span class="auth-field-label">Email</span>
            <input id="email" class="auth-input" name="email" type="email" autocomplete="email" placeholder="you@company.com"
              [value]="email()" (input)="email.set($any($event.target).value)" required />
          </label>
          <button type="submit" class="auth-submit" [disabled]="loading()">
            {{ loading() ? 'Sending…' : 'Send reset link' }}
          </button>
        </form>
        <p class="auth-footer">
          <a class="auth-link" routerLink="/login">← Back to sign in</a>
        </p>
      }
    </div>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService)
  protected readonly router = inject(Router)
  protected readonly origin = window.location.origin

  protected readonly email = signal('')
  protected readonly error = signal('')
  protected readonly loading = signal(false)
  protected readonly sent = signal(false)
  protected readonly demoResetPath = signal<string | null>(null)

  protected async onSubmit(event: Event) {
    event.preventDefault()
    this.error.set('')
    this.loading.set(true)
    try {
      const { demoResetPath } = await this.auth.forgotPassword(this.email())
      this.demoResetPath.set(demoResetPath)
      this.sent.set(true)
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      this.loading.set(false)
    }
  }
}
