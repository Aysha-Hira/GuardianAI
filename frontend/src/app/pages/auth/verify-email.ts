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
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { AuthService } from '../../core/auth.service'
import { normalizeEmail } from '../../shared/services/authStorage'
import { AuthAlertComponent, AuthDemoBannerComponent } from '../../shared/ui/auth-alert'

const CODE_LENGTH = 6

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, AuthAlertComponent, AuthDemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="auth-card">
      <div class="auth-card-head">
        <h2 class="auth-card-title">Verify your email</h2>
        <p class="auth-card-sub">
          We sent a 6-digit code to <strong>{{ email }}</strong>. Enter it below to activate your
          account.
        </p>
      </div>

      @if (error()) {
        <div appAuthAlert variant="error">{{ error() }}</div>
      }

      <form class="auth-form" (submit)="onSubmit($event)">
        <div class="auth-code-inputs">
          @for (digit of digits(); track $index; let i = $index) {
            <input
              #digitInput
              class="auth-code-digit"
              inputmode="numeric"
              maxlength="1"
              [value]="digit"
              [attr.aria-label]="'Digit ' + (i + 1)"
              (input)="onDigitInput(i, $event)"
              (keydown)="onKeyDown(i, $event)"
              (paste)="i === 0 ? onPaste($event) : null"
            />
          }
        </div>

        <button type="submit" class="auth-submit" [disabled]="loading() || code().length !== codeLength">
          {{ loading() ? 'Verifying…' : 'Verify email' }}
        </button>
      </form>

      @if (demoCode()) {
        <div appAuthDemoBanner bannerTitle="Dev fallback — verification code">
          Email could not be sent. Your code:
          <span class="auth-demo-code">{{ demoCode() }}</span>
        </div>
      }

      <p class="auth-resend">
        Didn't receive it?
        <button type="button" (click)="resend()" [disabled]="resending() || cooldown() > 0">
          {{ resending() ? 'Sending…' : cooldown() > 0 ? 'Resend in ' + cooldown() + 's' : 'Resend code' }}
        </button>
      </p>

      <p class="auth-footer">
        Wrong email? <a class="auth-link" routerLink="/signup">Sign up again</a>
        ·
        <a class="auth-link" routerLink="/login">Sign in</a>
      </p>
    </div>
  `,
})
export class VerifyEmailPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  protected readonly codeLength = CODE_LENGTH

  protected readonly email = normalizeEmail(
    inject(ActivatedRoute).snapshot.queryParamMap.get('email') || this.auth.pendingEmail() || '',
  )

  protected readonly digits = signal<string[]>(Array(CODE_LENGTH).fill(''))
  protected readonly code = computed(() => this.digits().join(''))
  protected readonly error = signal('')
  protected readonly loading = signal(false)
  protected readonly resending = signal(false)
  protected readonly demoCode = signal<string | null>(
    (history.state as { demoVerificationCode?: string } | null)?.demoVerificationCode ?? null,
  )
  protected readonly cooldown = signal(0)
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput')

  constructor() {
    if (!this.email) void this.router.navigate(['/signup'], { replaceUrl: true })
    const id = window.setInterval(() => {
      if (this.cooldown() > 0) this.cooldown.update((c) => Math.max(0, c - 1))
    }, 1000)
    inject(DestroyRef).onDestroy(() => window.clearInterval(id))
  }

  private focus(index: number) {
    this.inputs()[index]?.nativeElement.focus()
  }

  private async submitCode(value: string) {
    if (value.length !== CODE_LENGTH) return
    this.error.set('')
    this.loading.set(true)
    try {
      await this.auth.verifyEmail(this.email, value)
      await this.router.navigate(['/'], { replaceUrl: true })
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Verification failed.')
      this.digits.set(Array(CODE_LENGTH).fill(''))
      this.focus(0)
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
    if (char && index < CODE_LENGTH - 1) this.focus(index + 1)
    if (next.every(Boolean)) void this.submitCode(next.join(''))
  }

  protected onKeyDown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) this.focus(index - 1)
  }

  protected onPaste(event: ClipboardEvent) {
    event.preventDefault()
    const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return
    const next = Array.from({ length: CODE_LENGTH }, (_, i) => pasted[i] ?? '')
    this.digits.set(next)
    if (pasted.length === CODE_LENGTH) void this.submitCode(pasted)
    else this.focus(pasted.length)
  }

  protected onSubmit(event: Event) {
    event.preventDefault()
    void this.submitCode(this.code())
  }

  protected async resend() {
    if (this.cooldown() > 0) return
    this.error.set('')
    this.resending.set(true)
    try {
      const { demoVerificationCode } = await this.auth.resendVerification(this.email)
      this.demoCode.set(demoVerificationCode)
      this.cooldown.set(60)
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not resend code.')
    } finally {
      this.resending.set(false)
    }
  }
}
