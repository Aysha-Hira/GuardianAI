import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { authApi } from '../../shared/services/authApi'
import type { InviteLookup } from '../../shared/types/auth'
import { AuthAlertComponent } from '../../shared/ui/auth-alert'
import { PasswordMatchComponent, PasswordRulesComponent } from '../../shared/ui/password-rules'
import { allPasswordRulesMet } from '../../shared/utils/passwordValidation'

@Component({
  selector: 'app-accept-invite',
  imports: [RouterLink, AuthAlertComponent, PasswordRulesComponent, PasswordMatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-card">
      <div class="auth-card-head">
        <h2 class="auth-card-title">Join your team</h2>
        <p class="auth-card-sub">
          @if (invite(); as inv) {
            {{ inv.invitedBy || 'Your administrator' }} invited you to Guardian AI as
            <strong>{{ inv.role === 'admin' ? 'an Administrator' : 'an Operator' }}</strong>.
          } @else {
            Accept your invitation to Guardian AI.
          }
        </p>
      </div>

      @if (error()) {
        <div appAuthAlert variant="error">{{ error() }}</div>
      }

      @if (checking()) {
        <p class="auth-card-sub">Checking your invitation…</p>
      } @else if (invite(); as inv) {
        <form class="auth-form" (submit)="onSubmit($event)">
          <label class="auth-field" for="email">
            <span class="auth-field-label">Email</span>
            <input id="email" class="auth-input" type="email" [value]="inv.email" readonly />
          </label>
          <label class="auth-field" for="name">
            <span class="auth-field-label">Full name</span>
            <input id="name" class="auth-input" autocomplete="name" placeholder="Alex Operator"
              [value]="name()" (input)="name.set($any($event.target).value)" required />
          </label>
          <label class="auth-field" for="password">
            <span class="auth-field-label">Password</span>
            <input id="password" class="auth-input" type="password" autocomplete="new-password" placeholder="Min. 8 characters"
              [value]="password()" (input)="password.set($any($event.target).value)" required />
          </label>
          @if (password()) {
            <div appPasswordRules [password]="password()"></div>
          }
          <label class="auth-field" for="confirm">
            <span class="auth-field-label">Confirm password</span>
            <input id="confirm" class="auth-input" type="password" autocomplete="new-password" placeholder="Repeat password"
              [value]="confirm()" (input)="confirm.set($any($event.target).value)" required />
          </label>
          @if (confirm()) {
            <p appPasswordMatch [password]="password()" [confirm]="confirm()"></p>
          }
          <p class="auth-terms-note">
            By joining you agree to our
            <a class="auth-link" routerLink="/terms">Terms</a>
            and
            <a class="auth-link" routerLink="/privacy">Privacy Policy</a>.
          </p>
          <button type="submit" class="auth-submit" [disabled]="loading()">
            {{ loading() ? 'Joining…' : 'Accept invitation' }}
          </button>
        </form>
      }

      <p class="auth-footer">
        Already have an account?
        <a class="auth-link" routerLink="/login">Sign in</a>
      </p>
    </div>
  `,
})
export class AcceptInvitePage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? ''

  protected readonly invite = signal<InviteLookup | null>(null)
  protected readonly checking = signal(true)
  protected readonly name = signal('')
  protected readonly password = signal('')
  protected readonly confirm = signal('')
  protected readonly error = signal('')
  protected readonly loading = signal(false)

  constructor() {
    void this.load()
  }

  private async load() {
    if (!this.token) {
      this.error.set('This invitation link is incomplete. Open the link from your email again.')
      this.checking.set(false)
      return
    }
    try {
      const inv = await authApi.lookupInvitation(this.token)
      this.invite.set(inv)
      this.name.set(inv.name ?? '')
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'This invitation is not valid.')
    } finally {
      this.checking.set(false)
    }
  }

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
      await this.auth.acceptInvitation({ token: this.token, name: this.name(), password: this.password() })
      await this.router.navigate(['/'], { replaceUrl: true })
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not accept the invitation.')
    } finally {
      this.loading.set(false)
    }
  }
}
