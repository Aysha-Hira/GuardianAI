import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { AuthAlertComponent, AuthDemoBannerComponent } from '../../shared/ui/auth-alert'
import { PasswordMatchComponent, PasswordRulesComponent } from '../../shared/ui/password-rules'
import { allPasswordRulesMet } from '../../shared/utils/passwordValidation'

@Component({
  selector: 'app-signup',
  imports: [
    RouterLink,
    AuthAlertComponent,
    AuthDemoBannerComponent,
    PasswordRulesComponent,
    PasswordMatchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-card">
      <div class="auth-card-head">
        <h2 class="auth-card-title">Create account</h2>
        <p class="auth-card-sub">Set up operator access for your Guardian AI workspace.</p>
      </div>

      @if (error()) {
        <div appAuthAlert variant="error">{{ error() }}</div>
      }

      <form class="auth-form" (submit)="onSubmit($event)">
        <label class="auth-field" for="name">
          <span class="auth-field-label">Full name</span>
          <input id="name" class="auth-input" name="name" autocomplete="name" placeholder="Alex Operator"
            [value]="name()" (input)="name.set($any($event.target).value)" required />
        </label>
        <label class="auth-field" for="email">
          <span class="auth-field-label">Work email</span>
          <input id="email" class="auth-input" name="email" type="email" autocomplete="email" placeholder="you@company.com"
            [value]="email()" (input)="email.set($any($event.target).value)" required />
        </label>
        <label class="auth-field" for="password">
          <span class="auth-field-label">Password</span>
          <input id="password" class="auth-input" name="password" type="password" autocomplete="new-password" placeholder="Min. 8 characters"
            [value]="password()" (input)="password.set($any($event.target).value)" required />
        </label>
        @if (password()) {
          <div appPasswordRules [password]="password()"></div>
        }
        <label class="auth-field" for="confirm">
          <span class="auth-field-label">Confirm password</span>
          <input id="confirm" class="auth-input" name="confirm" type="password" autocomplete="new-password" placeholder="Repeat password"
            [value]="confirm()" (input)="confirm.set($any($event.target).value)" required />
        </label>
        @if (confirm()) {
          <p appPasswordMatch [password]="password()" [confirm]="confirm()"></p>
        }

        <p class="auth-terms-note">
          By creating an account you agree to our
          <a class="auth-link" routerLink="/terms">Terms</a>
          and
          <a class="auth-link" routerLink="/privacy">Privacy Policy</a>.
        </p>

        <button type="submit" class="auth-submit" [disabled]="loading()">
          {{ loading() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      @if (demoCode()) {
        <div appAuthDemoBanner bannerTitle="Email fallback — verification code">
          Could not send email. Your code:
          <span class="auth-demo-code">{{ demoCode() }}</span>
        </div>
      }

      <p class="auth-footer">
        Already have an account?
        <a class="auth-link" routerLink="/login">Sign in</a>
      </p>
    </div>
  `,
})
export class SignupPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  protected readonly name = signal('')
  protected readonly email = signal('')
  protected readonly password = signal('')
  protected readonly confirm = signal('')
  protected readonly error = signal('')
  protected readonly loading = signal(false)
  protected readonly demoCode = signal<string | null>(null)

  protected async onSubmit(event: Event) {
    event.preventDefault()
    this.error.set('')
    this.demoCode.set(null)

    if (!allPasswordRulesMet(this.password())) {
      this.error.set('Please meet all password requirements.')
      return
    }
    if (this.password() !== this.confirm()) {
      this.error.set('Passwords do not match.')
      return
    }

    this.loading.set(true)
    try {
      const { demoVerificationCode } = await this.auth.signup({
        name: this.name(),
        email: this.email(),
        password: this.password(),
      })
      this.demoCode.set(demoVerificationCode)
      await this.router.navigate(['/verify-email'], {
        queryParams: { email: this.email() },
        state: { demoVerificationCode },
      })
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Sign up failed.')
    } finally {
      this.loading.set(false)
    }
  }
}
