import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChildren,
} from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import type { MfaChallenge } from '../../shared/types/auth'
import { AuthAlertComponent, AuthDemoBannerComponent } from '../../shared/ui/auth-alert'

/** Port of React's pages/auth/Login. */
@Component({
  selector: 'app-login',
  imports: [RouterLink, AuthAlertComponent, AuthDemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (challenge(); as ch) {
      <div class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">Check your email</h2>
          <p class="auth-card-sub">
            Two-step sign-in is on. Enter the 6-digit code we sent to <strong>{{ ch.sentTo }}</strong>.
          </p>
        </div>

        @if (error()) {
          <div appAuthAlert variant="error">{{ error() }}</div>
        }

        <form class="auth-form" (submit)="onCodeSubmit($event)">
          <div class="auth-code-inputs">
            @for (digit of digits(); track $index; let i = $index) {
              <input
                #digitInput
                class="auth-code-digit"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="1"
                [value]="digit"
                [attr.aria-label]="'Digit ' + (i + 1)"
                (input)="onDigitInput(i, $event)"
                (keydown)="onKeyDown(i, $event)"
                (paste)="i === 0 ? onPaste($event) : null"
              />
            }
          </div>
          <button type="submit" class="auth-submit" [disabled]="loading() || code().length !== 6">
            {{ loading() ? 'Checking…' : 'Sign in' }}
          </button>
        </form>

        @if (devCode()) {
          <div appAuthDemoBanner bannerTitle="Dev fallback: sign-in code">
            Email could not be sent. Your code:
            <span class="auth-demo-code">{{ devCode() }}</span>
          </div>
        }

        <p class="auth-resend">
          Didn't receive it?
          <button type="button" (click)="resend()" [disabled]="resending() || cooldown() > 0">
            {{ resending() ? 'Sending…' : cooldown() > 0 ? 'Resend in ' + cooldown() + 's' : 'Resend code' }}
          </button>
        </p>
        <p class="auth-footer">
          <button type="button" class="auth-link" (click)="backToPassword()">Use a different account</button>
        </p>
      </div>
    } @else {
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
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  // Where the guard sent us from (React: location.state.from)
  private readonly from: string = (history.state as { from?: string } | null)?.from ?? '/'

  protected readonly email = signal('')
  protected readonly password = signal('')
  protected readonly remember = signal(true)
  protected readonly error = signal('')
  protected readonly loading = signal(false)

  // Two-step sign-in (emailed code)
  protected readonly challenge = signal<MfaChallenge | null>(null)
  protected readonly digits = signal<string[]>(Array(6).fill(''))
  protected readonly code = computed(() => this.digits().join(''))
  protected readonly devCode = signal<string | null>(null)
  protected readonly resending = signal(false)
  protected readonly cooldown = signal(0)
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput')

  constructor() {
    const id = window.setInterval(() => {
      if (this.cooldown() > 0) this.cooldown.update((c) => Math.max(0, c - 1))
    }, 1000)
    inject(DestroyRef).onDestroy(() => window.clearInterval(id))
  }

  private focus(index: number) {
    this.inputs()[index]?.nativeElement.focus()
  }

  private async submitCode(value: string) {
    const ch = this.challenge()
    if (!ch || value.length !== 6 || this.loading()) return
    this.error.set('')
    this.loading.set(true)
    try {
      await this.auth.completeMfaLogin(ch, value)
      await this.router.navigateByUrl(this.from, { replaceUrl: true })
    } catch (err) {
      const status = (err as { status?: number }).status
      this.error.set(err instanceof Error ? err.message : 'That code did not work.')
      this.digits.set(Array(6).fill(''))
      if (status === 401 || status === 429) {
        // Ticket expired or too many attempts: back to the password step.
        this.challenge.set(null)
      } else {
        this.focus(0)
      }
    } finally {
      this.loading.set(false)
    }
  }

  protected onDigitInput(index: number, event: Event) {
    const el = event.target as HTMLInputElement
    const char = el.value.replace(/\D/g, '').slice(-1)
    el.value = char
    const next = [...this.digits()]
    next[index] = char
    this.digits.set(next)
    if (char && index < 5) this.focus(index + 1)
    if (next.every(Boolean)) void this.submitCode(next.join(''))
  }

  protected onKeyDown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) this.focus(index - 1)
  }

  protected onPaste(event: ClipboardEvent) {
    event.preventDefault()
    const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    this.digits.set(Array.from({ length: 6 }, (_, i) => pasted[i] ?? ''))
    if (pasted.length === 6) void this.submitCode(pasted)
    else this.focus(pasted.length)
  }

  protected onCodeSubmit(event: Event) {
    event.preventDefault()
    void this.submitCode(this.code())
  }

  protected async resend() {
    const ch = this.challenge()
    if (!ch || this.cooldown() > 0) return
    this.error.set('')
    this.resending.set(true)
    try {
      const { devCode } = await this.auth.resendMfaLogin(ch)
      this.devCode.set(devCode)
      this.cooldown.set(30)
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not send a new code.')
    } finally {
      this.resending.set(false)
    }
  }

  protected backToPassword() {
    this.challenge.set(null)
    this.error.set('')
    this.devCode.set(null)
  }

  protected async onSubmit(event: Event) {
    event.preventDefault()
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
        this.devCode.set(challenge.devCode)
        this.digits.set(Array(6).fill(''))
        this.cooldown.set(30)
        this.challenge.set(challenge)
        window.setTimeout(() => this.focus(0), 50)
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
