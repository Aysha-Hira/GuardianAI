import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { AuthAlertComponent } from '../../shared/ui/auth-alert'
import { PasswordMatchComponent, PasswordRulesComponent } from '../../shared/ui/password-rules'
import { allPasswordRulesMet } from '../../shared/utils/passwordValidation'

@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, AuthAlertComponent, PasswordRulesComponent, PasswordMatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (!token) {
      <div class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">Link expired</h2>
          <p class="auth-card-sub">This password reset link is invalid or has expired. Request a new one.</p>
        </div>
        <a class="auth-submit" routerLink="/forgot-password" style="display: block; text-align: center; text-decoration: none">
          Request new link
        </a>
        <p class="auth-footer">
          <a class="auth-link" routerLink="/login">← Back to sign in</a>
        </p>
      </div>
    } @else {
      <div class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">Set new password</h2>
          <p class="auth-card-sub">Choose a new password for your account.</p>
        </div>

        @if (error()) {
          <div appAuthAlert variant="error">{{ error() }}</div>
        }
        @if (done()) {
          <div appAuthAlert variant="success">Password updated! Redirecting to sign in…</div>
        } @else {
          <form class="auth-form" (submit)="onSubmit($event)">
            <label class="auth-field" for="password">
              <span class="auth-field-label">New password</span>
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
            <button type="submit" class="auth-submit" [disabled]="loading()">
              {{ loading() ? 'Updating…' : 'Update password' }}
            </button>
          </form>
        }

        <p class="auth-footer">
          <a class="auth-link" routerLink="/login">← Back to sign in</a>
        </p>
      </div>
    }
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? ''

  protected readonly password = signal('')
  protected readonly confirm = signal('')
  protected readonly error = signal('')
  protected readonly loading = signal(false)
  protected readonly done = signal(false)

  protected async onSubmit(event: Event) {
    event.preventDefault()
    this.error.set('')

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
      await this.auth.completePasswordReset(this.token, this.password())
      this.done.set(true)
      window.setTimeout(() => void this.router.navigate(['/login'], { replaceUrl: true }), 2000)
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Reset failed.')
    } finally {
      this.loading.set(false)
    }
  }
}
