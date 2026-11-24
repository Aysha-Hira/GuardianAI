import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core'
import { Router } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { AuthAlertComponent } from '../../shared/ui/auth-alert'

@Component({
  selector: 'app-totp-challenge',
  imports: [AuthAlertComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (expired()) {
      <div class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">Sign in again</h2>
          <p class="auth-card-sub">{{ error() }}</p>
        </div>
        <button type="button" class="auth-submit" (click)="backToLogin()">Return to sign in</button>
      </div>
    } @else if (challenge(); as activeChallenge) {
      <div class="auth-card">
        <div class="auth-card-head">
          @if (activeChallenge.method === 'totp_setup') {
            <h2 class="auth-card-title">Set up mandatory Authenticator MFA</h2>
            <p class="auth-card-sub">
              Scan this QR code using Microsoft Authenticator or another compatible authenticator app.
              You must confirm a current six-digit code before Guardian AI grants access.
            </p>
          } @else {
            <h2 class="auth-card-title">Authenticator verification</h2>
            <p class="auth-card-sub">
              Enter the current six-digit code from your authenticator app to finish signing in.
            </p>
          }
        </div>

        @if (error()) {
          <div appAuthAlert variant="error" aria-live="polite">{{ error() }}</div>
        }

        @if (activeChallenge.method === 'totp_setup') {
          @if (setupLoading()) {
            <p class="auth-card-sub" role="status">Preparing your secure QR code…</p>
          } @else if (qrPngBase64()) {
            <figure class="auth-totp-qr">
              <img
                [src]="'data:image/png;base64,' + qrPngBase64()"
                alt="QR code for setting up Guardian AI in an authenticator app"
                (error)="onQrError()"
              />
              <figcaption>Keep this QR code private. It is only for your authenticator app.</figcaption>
            </figure>
          } @else if (setupError()) {
            <div appAuthAlert variant="error" aria-live="polite">{{ setupError() }}</div>
            <button type="button" class="auth-link auth-totp-retry" [disabled]="setupLoading()" (click)="loadSetup()">
              {{ setupLoading() ? 'Loading…' : 'Retry loading QR code' }}
            </button>
          }
        }

        <form class="auth-form auth-totp-form" (submit)="onSubmit($event)">
          <label class="auth-field" for="totp-code">
            <span class="auth-field-label">Six-digit authenticator code</span>
            <input
              id="totp-code"
              class="auth-input auth-totp-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]{6}"
              aria-describedby="totp-code-help"
              [value]="code()"
              (input)="onCodeInput($event)"
              required
            />
            <span id="totp-code-help" class="auth-field-hint">Enter all six digits shown in your app.</span>
          </label>
          <button
            type="submit"
            class="auth-submit"
            [disabled]="busy() || code().length !== 6 || (activeChallenge.method === 'totp_setup' && !qrPngBase64())"
          >
            {{ busy() ? 'Verifying…' : activeChallenge.method === 'totp_setup' ? 'Confirm and continue' : 'Verify and sign in' }}
          </button>
        </form>

        <p class="auth-footer">
          <button type="button" class="auth-link" [disabled]="busy()" (click)="backToLogin()">
            Cancel and return to sign in
          </button>
        </p>
      </div>
    } @else {
      <div class="auth-card">
        <p class="auth-card-sub" role="status">Returning to sign in…</p>
      </div>
    }
  `,
})
export class TotpChallengePage implements OnDestroy {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  private readonly from: string = (history.state as { from?: string } | null)?.from ?? '/'

  protected readonly challenge = this.auth.pendingTotpChallenge
  protected readonly code = signal('')
  protected readonly error = signal('')
  protected readonly setupError = signal('')
  protected readonly qrPngBase64 = signal<string | null>(null)
  protected readonly setupLoading = signal(false)
  protected readonly busy = signal(false)
  protected readonly expired = signal(false)

  constructor() {
    const challenge = this.challenge()
    if (!challenge) {
      void this.backToLogin()
    } else if (challenge.method === 'totp_setup') {
      void this.loadSetup()
    }
  }

  ngOnDestroy() {
    this.auth.clearTotpChallenge()
  }

  protected async loadSetup() {
    if (this.setupLoading() || this.challenge()?.method !== 'totp_setup') return
    this.setupLoading.set(true)
    this.setupError.set('')
    try {
      const setup = await this.auth.loadTotpSetup()
      this.qrPngBase64.set(setup.qrPngBase64)
    } catch (err) {
      const status = (err as { status?: number }).status
      const message = err instanceof Error ? err.message : 'Could not load the setup QR code.'
      if (status === 401) {
        this.expireChallenge('Your setup challenge has expired. Sign in again to restart setup.')
      } else {
        this.setupError.set(message)
      }
    } finally {
      this.setupLoading.set(false)
    }
  }

  protected onCodeInput(event: Event) {
    const input = event.target as HTMLInputElement
    input.value = input.value.replace(/\D/g, '').slice(0, 6)
    this.code.set(input.value)
    this.error.set('')
  }

  protected onQrError() {
    this.qrPngBase64.set(null)
    this.setupError.set('The QR code could not be displayed. Request a fresh code and try again.')
  }

  protected async onSubmit(event: Event) {
    event.preventDefault()
    if (this.busy() || !/^\d{6}$/.test(this.code())) return

    this.error.set('')
    this.busy.set(true)
    try {
      await this.auth.completeTotpChallenge(this.code())
      await this.router.navigateByUrl(this.from, { replaceUrl: true })
    } catch (err) {
      const status = (err as { status?: number }).status
      const message = err instanceof Error ? err.message : 'Authenticator verification failed.'
      const exhausted = status === 429 && /wrong codes|start again/i.test(message)
      const expired = status === 401 && message !== 'Invalid code.'
      if (exhausted || expired || !this.auth.pendingTotpChallenge()) {
        this.expireChallenge(message || 'This Authenticator challenge is no longer valid. Sign in again.')
      } else {
        this.error.set(message)
      }
      this.code.set('')
    } finally {
      this.busy.set(false)
    }
  }

  protected async backToLogin() {
    this.auth.clearTotpChallenge()
    await this.router.navigateByUrl('/login', {
      replaceUrl: true,
      state: { from: this.from },
    })
  }

  private expireChallenge(message: string) {
    this.auth.clearTotpChallenge()
    this.expired.set(true)
    this.error.set(message)
  }
}
