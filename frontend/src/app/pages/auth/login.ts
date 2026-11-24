import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { AuthAlertComponent, AuthDemoBannerComponent } from '../../shared/ui/auth-alert'

@Component({
  selector: 'app-login',
  imports: [RouterLink, AuthAlertComponent, AuthDemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-card">
      <div class="auth-card-head">
        <h2 class="auth-card-title">Welcome back</h2>
        <p class="auth-card-sub">Sign in to access your Guardian AI operations center.</p>
      </div>

      @if (error()) {
        <div appAuthAlert variant="error">{{ error() }}</div>
      }

      <div appAuthDemoBanner bannerTitle="Test account">
        <strong>operator&#64;guardian.ai</strong> / <strong>Guardian1!</strong>
      </div>

      <form class="auth-form" (submit)="onSubmit($event)">
        <label class="auth-field" for="email">
          <span class="auth-field-label">Email</span>
          <input
            id="email"
            class="auth-input"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="you@company.com"
            [value]="email()"
            (input)="email.set($any($event.target).value)"
            required
          />
        </label>
        <label class="auth-field" for="password">
          <span class="auth-field-label">Password</span>
          <input
            id="password"
            class="auth-input"
            name="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            required
          />
        </label>

        <div class="auth-row">
          <label class="auth-check">
            <input
              type="checkbox"
              [checked]="remember()"
              (change)="remember.set($any($event.target).checked)"
            />
            Remember me
          </label>
          <a class="auth-link" routerLink="/forgot-password">Forgot password?</a>
        </div>

        <button type="submit" class="auth-submit" [disabled]="loading()">
          {{ loading() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="auth-footer">
        Don't have an account?
        <a class="auth-link" routerLink="/signup">Create one</a>
      </p>
      <p class="auth-footer">
        <a class="auth-link" routerLink="/terms">Terms</a>
        ·
        <a class="auth-link" routerLink="/privacy">Privacy</a>
      </p>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  private readonly from: string = (history.state as { from?: string } | null)?.from ?? '/'

  protected readonly email = signal('')
  protected readonly password = signal('')
  protected readonly remember = signal(true)
  protected readonly error = signal('')
  protected readonly loading = signal(false)

  protected async onSubmit(event: Event) {
    event.preventDefault()
    if (this.loading()) return

    this.error.set('')
    this.loading.set(true)
    try {
      const challenge = await this.auth.login({
        email: this.email(),
        password: this.password(),
        remember: this.remember(),
      })
      if (challenge) {
        this.password.set('')
        await this.router.navigateByUrl('/authenticator', {
          replaceUrl: true,
          state: { from: this.from },
        })
        return
      }
      await this.router.navigateByUrl(this.from, { replaceUrl: true })
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      this.loading.set(false)
    }
  }
}
