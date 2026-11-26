import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import {
  AuthAlertComponent,
  AuthDemoBannerComponent,
} from "../../shared/ui/auth-alert";

type Mode = "choose" | "authenticator" | "email";

@Component({
  selector: "app-totp-challenge",
  imports: [AuthAlertComponent, AuthDemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @if (expired()) {
      <div class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">Sign in again</h2>
          <p class="auth-card-sub">{{ error() }}</p>
        </div>
        <button type="button" class="auth-submit" (click)="backToLogin()">
          Return to sign in
        </button>
      </div>
    } @else if (challenge(); as activeChallenge) {
      <div class="auth-card">
        <div class="auth-card-head">
          @if (mode() === "choose") {
            <h2 class="auth-card-title">Verify it's you</h2>
            <p class="auth-card-sub">
              Choose how you'd like to receive your sign-in code.
            </p>
          } @else if (mode() === "email") {
            <h2 class="auth-card-title">Check your email</h2>
            <p class="auth-card-sub">
              We sent a six-digit code to <strong>{{ sentTo() }}</strong
              >. Enter it below to finish signing in.
            </p>
          } @else if (activeChallenge.method === "totp_setup") {
            <h2 class="auth-card-title">Set up Authenticator</h2>
            <p class="auth-card-sub">
              Scan this QR code using Microsoft Authenticator or another
              compatible authenticator app, then enter the current six-digit
              code.
            </p>
          } @else {
            <h2 class="auth-card-title">Authenticator verification</h2>
            <p class="auth-card-sub">
              Enter the current six-digit code from your authenticator app to
              finish signing in.
            </p>
          }
        </div>

        @if (error()) {
          <div appAuthAlert variant="error" aria-live="polite">
            {{ error() }}
          </div>
        }

        @if (mode() === "choose") {
          <div class="auth-method-list">
            <button
              type="button"
              class="auth-method"
              [disabled]="busy() || sending()"
              (click)="chooseAuthenticator()"
            >
              <span class="auth-method-title">Authenticator app</span>
              <span class="auth-method-sub">
                {{
                  activeChallenge.method === "totp_setup"
                    ? "Scan a QR code and use the six-digit code from your app"
                    : "Use the six-digit code from your authenticator app"
                }}
              </span>
            </button>
            <button
              type="button"
              class="auth-method"
              [disabled]="busy() || sending()"
              (click)="chooseEmail()"
            >
              <span class="auth-method-title">{{
                sending() ? "Sending…" : "Email code"
              }}</span>
              <span class="auth-method-sub"
                >We'll email a six-digit code to your inbox</span
              >
            </button>
          </div>
        } @else {
          @if (
            mode() === "authenticator" &&
            activeChallenge.method === "totp_setup"
          ) {
            @if (setupLoading()) {
              <p class="auth-card-sub" role="status">
                Preparing your secure QR code…
              </p>
            } @else if (qrPngBase64()) {
              <figure class="auth-totp-qr">
                <img
                  [src]="'data:image/png;base64,' + qrPngBase64()"
                  alt="QR code for setting up Guardian AI in an authenticator app"
                  (error)="onQrError()"
                />
                <figcaption>
                  Keep this QR code private. It is only for your authenticator
                  app.
                </figcaption>
              </figure>
            } @else if (setupError()) {
              <div appAuthAlert variant="error" aria-live="polite">
                {{ setupError() }}
              </div>
              <button
                type="button"
                class="auth-link auth-totp-retry"
                [disabled]="setupLoading()"
                (click)="loadSetup()"
              >
                {{ setupLoading() ? "Loading…" : "Retry loading QR code" }}
              </button>
            }
          }

          @if (mode() === "email" && demoCode()) {
            <div appAuthDemoBanner bannerTitle="Dev fallback — email code">
              Email could not be sent. Your code:
              <span class="auth-demo-code">{{ demoCode() }}</span>
            </div>
          }

          <form class="auth-form auth-totp-form" (submit)="onSubmit($event)">
            <label class="auth-field" for="totp-code">
              <span class="auth-field-label">
                {{
                  mode() === "email"
                    ? "Six-digit email code"
                    : "Six-digit authenticator code"
                }}
              </span>
              <input
                id="totp-code"
                class="auth-input auth-totp-code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                pattern="[0-9]{6}"
                [value]="code()"
                (input)="onCodeInput($event)"
                required
              />
            </label>
            <button
              type="submit"
              class="auth-submit"
              [disabled]="
                busy() ||
                code().length !== 6 ||
                (mode() === 'authenticator' &&
                  activeChallenge.method === 'totp_setup' &&
                  !qrPngBase64())
              "
            >
              {{ busy() ? "Verifying…" : "Verify and sign in" }}
            </button>
          </form>

          @if (mode() === "email") {
            <p class="auth-resend">
              Didn't get it?
              <button
                type="button"
                (click)="sendEmail()"
                [disabled]="sending() || cooldown() > 0"
              >
                {{
                  sending()
                    ? "Sending…"
                    : cooldown() > 0
                      ? "Resend in " + cooldown() + "s"
                      : "Resend code"
                }}
              </button>
            </p>
          }

          <p class="auth-footer">
            <button
              type="button"
              class="auth-link"
              [disabled]="busy()"
              (click)="changeMethod()"
            >
              Choose a different method
            </button>
          </p>
        }

        <p class="auth-footer">
          <button
            type="button"
            class="auth-link"
            [disabled]="busy()"
            (click)="backToLogin()"
          >
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
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly from: string =
    (history.state as { from?: string } | null)?.from ?? "/";
  private timer: number | undefined;

  protected readonly challenge = this.auth.pendingTotpChallenge;
  protected readonly mode = signal<Mode>("choose");
  protected readonly code = signal("");
  protected readonly error = signal("");
  protected readonly setupError = signal("");
  protected readonly qrPngBase64 = signal<string | null>(null);
  protected readonly setupLoading = signal(false);
  protected readonly busy = signal(false);
  protected readonly expired = signal(false);

  protected readonly sending = signal(false);
  protected readonly sentTo = signal("");
  protected readonly demoCode = signal<string | null>(null);
  protected readonly cooldown = signal(0);

  constructor() {
    if (!this.challenge()) void this.backToLogin();
  }

  ngOnDestroy() {
    window.clearInterval(this.timer);
    this.auth.clearTotpChallenge();
  }

  protected chooseAuthenticator() {
    this.error.set("");
    this.code.set("");
    this.mode.set("authenticator");
    if (this.challenge()?.method === "totp_setup" && !this.qrPngBase64())
      void this.loadSetup();
  }

  protected async chooseEmail() {
    this.error.set("");
    this.code.set("");
    // Already sent a code recently? Just go back to the entry screen instead of re-sending.
    if (this.sentTo() && this.cooldown() > 0) {
      this.mode.set("email");
      return;
    }
    await this.sendEmail();
  }

  protected changeMethod() {
    this.error.set("");
    this.code.set("");
    this.mode.set("choose");
  }

  protected async sendEmail() {
    if (this.sending() || this.cooldown() > 0) return;
    this.error.set("");
    this.sending.set(true);
    try {
      const { sentTo, devCode } = await this.auth.sendEmailCode();
      this.sentTo.set(sentTo);
      this.demoCode.set(devCode);
      this.code.set("");
      this.mode.set("email");
      this.startCooldown(30);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message =
        err instanceof Error ? err.message : "Could not send the email code.";
      if (status === 401) this.expireChallenge(message);
      else this.error.set(message);
    } finally {
      this.sending.set(false);
    }
  }

  private startCooldown(seconds: number) {
    window.clearInterval(this.timer);
    this.cooldown.set(seconds);
    this.timer = window.setInterval(() => {
      this.cooldown.update((c) => Math.max(0, c - 1));
      if (this.cooldown() === 0) window.clearInterval(this.timer);
    }, 1000);
  }

  protected async loadSetup() {
    if (this.setupLoading() || this.challenge()?.method !== "totp_setup")
      return;
    this.setupLoading.set(true);
    this.setupError.set("");
    try {
      const setup = await this.auth.loadTotpSetup();
      this.qrPngBase64.set(setup.qrPngBase64);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message =
        err instanceof Error
          ? err.message
          : "Could not load the setup QR code.";
      if (status === 401) {
        this.expireChallenge(
          "Your setup challenge has expired. Sign in again to restart setup.",
        );
      } else {
        this.setupError.set(message);
      }
    } finally {
      this.setupLoading.set(false);
    }
  }

  protected onCodeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    this.code.set(input.value);
    this.error.set("");
  }

  protected onQrError() {
    this.qrPngBase64.set(null);
    this.setupError.set(
      "The QR code could not be displayed. Request a fresh code and try again.",
    );
  }

  protected async onSubmit(event: Event) {
    event.preventDefault();
    if (this.busy() || !/^\d{6}$/.test(this.code())) return;

    this.error.set("");
    this.busy.set(true);
    try {
      if (this.mode() === "email") {
        await this.auth.completeEmailChallenge(this.code());
      } else {
        await this.auth.completeTotpChallenge(this.code());
      }
      await this.router.navigateByUrl(this.from, { replaceUrl: true });
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message =
        err instanceof Error ? err.message : "Verification failed.";
      const exhausted =
        status === 429 && /wrong codes|start again/i.test(message);
      const expired = status === 401 && message !== "Invalid code.";
      if (exhausted || expired || !this.auth.pendingTotpChallenge()) {
        this.expireChallenge(
          message || "This sign-in is no longer valid. Sign in again.",
        );
      } else {
        this.error.set(message);
      }
      this.code.set("");
    } finally {
      this.busy.set(false);
    }
  }

  protected async backToLogin() {
    this.auth.clearTotpChallenge();
    await this.router.navigateByUrl("/login", {
      replaceUrl: true,
      state: { from: this.from },
    });
  }

  private expireChallenge(message: string) {
    this.auth.clearTotpChallenge();
    this.expired.set(true);
    this.error.set(message);
  }
}
