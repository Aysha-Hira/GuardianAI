import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { SubscriptionService } from '../core/subscription.service'
import type { SubscriptionReceipt } from '../shared/types/subscription'
import { formatAedDetailed } from '../shared/utils/subscriptionMock'
import { AuthService } from '../core/auth.service'
import { createPoll, POLL_KEYS } from '../core/polling'
import { api } from '../shared/services/api'
import { ErrorStateComponent, PageHeaderComponent, ToggleComponent } from '../shared/ui/common'

const DISPLAY_SETTINGS_KEY = 'guardian_display_settings'

interface DisplaySettings {
  showTrackTrails: boolean
  showConfidenceScores: boolean
  showCameraOverlay: boolean
}

function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY)
    if (raw) return JSON.parse(raw) as DisplaySettings
  } catch {
    /* ignore */
  }
  return { showTrackTrails: false, showConfidenceScores: true, showCameraOverlay: true }
}

/** Port of React's pages/Settings. */
@Component({
  selector: 'app-settings',
  imports: [ErrorStateComponent, PageHeaderComponent, RouterLink, ToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (poll.offline()) {
      <div appErrorState message="Unable to connect to Guardian AI services."></div>
    } @else {
      <div class="st-page">
        <div appPageHeader heading="Settings" description="Your account, plan, detection behaviour and display preferences."></div>

        <section class="st-identity" aria-label="Signed-in account">
          <span class="st-avatar" aria-hidden="true">{{ initials() }}</span>
          <div class="st-identity-text">
            <p class="st-identity-name">{{ auth.user()?.name }}</p>
            <p class="st-identity-email">{{ auth.user()?.email }}</p>
            <div class="st-pills">
              <span class="st-pill st-pill-ok">Email verified</span>
              @if (subs.current(); as plan) {
                <span class="st-pill st-pill-plan">{{ plan.planName }} plan · {{ plan.cameraLimitLabel }}</span>
              }
            </div>
          </div>
          <button type="button" class="btn-ghost" (click)="auth.logout()">Sign out</button>
        </section>

        <div class="st-layout">
          <nav class="st-rail" aria-label="Settings sections">
            @for (s of sections(); track s.id) {
              <a [href]="'#' + s.id" [class.is-active]="active() === s.id" (click)="jump($event, s.id)">
                <span class="st-rail-title">{{ s.title }}</span>
                <span class="st-rail-hint">{{ s.hint }}</span>
              </a>
            }
          </nav>

          <div class="st-sections">
            <!-- Account -->
            <section class="st-section" id="account" aria-labelledby="account-h">
              <div class="st-section-head">
                <h2 class="st-section-title" id="account-h">Account</h2>
                <p class="st-section-desc">Your operator profile is stored in the Guardian AI database.</p>
              </div>
              <div class="st-grid-2">
                <div class="st-card">
                  <p class="st-card-title">Profile</p>
                  <p class="st-card-sub">The name shown in the header and on reports.</p>
                  <form class="st-form" (submit)="saveProfile($event)">
                    <div>
                      <label for="profile-email" class="field-label">Email</label>
                      <input id="profile-email" type="email" [value]="auth.user()?.email ?? ''" readonly class="input-field w-full opacity-70" />
                    </div>
                    <div>
                      <label for="profile-name" class="field-label">Display name</label>
                      <input id="profile-name" type="text" [value]="profileName()" (input)="profileName.set($any($event.target).value)" class="input-field w-full" required />
                    </div>
                    <div class="st-actions">
                      <button type="submit" class="btn-primary" [disabled]="profileSaving()">{{ profileSaving() ? 'Saving…' : 'Save profile' }}</button>
                      @if (profileMessage(); as msg) {
                        <span [class]="'st-msg ' + (msg.includes('failed') ? 'st-msg-err' : 'st-msg-ok')">{{ msg }}</span>
                      }
                    </div>
                  </form>
                </div>

                <div class="st-card">
                  <p class="st-card-title">Password</p>
                  <p class="st-card-sub">Changing it signs you out everywhere.</p>
                  <form class="st-form" (submit)="savePassword($event)">
                    <div>
                      <label for="current-password" class="field-label">Current password</label>
                      <input id="current-password" type="password" autocomplete="current-password" [value]="currentPassword()" (input)="currentPassword.set($any($event.target).value)" class="input-field w-full" required />
                    </div>
                    <div>
                      <label for="new-password" class="field-label">New password</label>
                      <input id="new-password" type="password" autocomplete="new-password" [value]="newPassword()" (input)="newPassword.set($any($event.target).value)" class="input-field w-full" required />
                    </div>
                    <div>
                      <label for="confirm-password" class="field-label">Confirm new password</label>
                      <input id="confirm-password" type="password" autocomplete="new-password" [value]="confirmPassword()" (input)="confirmPassword.set($any($event.target).value)" class="input-field w-full" required />
                    </div>
                    <div class="st-actions">
                      <button type="submit" class="btn-primary" [disabled]="passwordSaving()">{{ passwordSaving() ? 'Updating…' : 'Update password' }}</button>
                      @if (passwordMessage(); as msg) {
                        <span [class]="'st-msg ' + (msg.includes('failed') || msg.includes('match') || msg.includes('least') ? 'st-msg-err' : 'st-msg-ok')">{{ msg }}</span>
                      }
                    </div>
                  </form>
                </div>
              </div>
              <div class="st-card" style="margin-top: 1rem" id="security">
                <div class="st-plan-top" style="gap: 0.75rem">
                  <div>
                    <p class="st-card-title">Two-step sign-in</p>
                    <p class="st-card-sub">
                      @if (auth.user()?.mfaEnabled) {
                        On. Each sign-in also needs a 6-digit code emailed to {{ auth.user()?.email }}.
                      } @else {
                        Off. Add an emailed 6-digit code to every sign-in, so a stolen password isn’t enough.
                      }
                    </p>
                  </div>
                  @if (auth.user()?.mfaEnabled) {
                    <span class="st-pill st-pill-ok">On</span>
                  } @else {
                    <span class="st-pill">Off</span>
                  }
                </div>

                @if (!auth.user()?.mfaEnabled) {
                  @if (mfaStep() === 'idle') {
                    <div class="st-actions" style="margin-top: 1rem">
                      <button type="button" class="btn-primary" [disabled]="mfaBusy()" (click)="startMfa()">{{ mfaBusy() ? 'Sending code…' : 'Turn on' }}</button>
                    </div>
                  } @else {
                    <form class="st-form" (submit)="confirmMfa($event)">
                      <p class="text-sm text-guardian-muted">We sent a code to <strong class="text-guardian-text">{{ mfaSentTo() }}</strong>. Enter it to turn two-step sign-in on.</p>
                      @if (mfaDevCode()) {
                        <p class="text-xs text-amber-300">Email couldn’t be sent (dev mode). Your code: <span class="font-mono">{{ mfaDevCode() }}</span></p>
                      }
                      <div>
                        <label for="mfa-code" class="field-label">6-digit code</label>
                        <input id="mfa-code" class="input-field w-40 font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                          [value]="mfaCode()" (input)="onMfaCodeInput($event)" />
                      </div>
                      <div class="st-actions">
                        <button type="submit" class="btn-primary" [disabled]="mfaBusy() || mfaCode().length !== 6">{{ mfaBusy() ? 'Checking…' : 'Confirm and turn on' }}</button>
                        <button type="button" class="btn-ghost" [disabled]="mfaBusy()" (click)="startMfa()">Send a new code</button>
                        <button type="button" class="btn-ghost" (click)="cancelMfa()">Cancel</button>
                      </div>
                    </form>
                  }
                } @else {
                  @if (mfaStep() === 'disable') {
                    <form class="st-form" (submit)="turnOffMfa($event)">
                      <div>
                        <label for="mfa-password" class="field-label">Current password</label>
                        <input id="mfa-password" type="password" autocomplete="current-password" class="input-field w-full" [value]="mfaPassword()" (input)="mfaPassword.set($any($event.target).value)" required />
                      </div>
                      <div class="st-actions">
                        <button type="submit" class="btn-ghost" [disabled]="mfaBusy() || !mfaPassword()">{{ mfaBusy() ? 'Turning off…' : 'Turn off two-step sign-in' }}</button>
                        <button type="button" class="btn-ghost" (click)="cancelMfa()">Keep it on</button>
                      </div>
                    </form>
                  } @else {
                    <div class="st-actions" style="margin-top: 1rem">
                      <button type="button" class="btn-ghost" (click)="mfaStep.set('disable')">Turn off</button>
                    </div>
                  }
                }
                @if (mfaMessage(); as msg) {
                  <p [class]="'st-msg mt-3 ' + (mfaMessageOk() ? 'st-msg-ok' : 'st-msg-err')">{{ msg }}</p>
                }
              </div>
            </section>

            <!-- Plan & billing -->
            <section class="st-section" id="plan" aria-labelledby="plan-h">
              <div class="st-section-head">
                <h2 class="st-section-title" id="plan-h">Plan &amp; billing</h2>
                <p class="st-section-desc">Every account starts on Free. Paid plans are saved to your account; payments are simulated on this demo.</p>
              </div>

              @if (subs.current(); as plan) {
                <div class="st-plan">
                  <div class="st-plan-top">
                    <div>
                      <p class="st-plan-name">{{ plan.planName }}</p>
                      @if (plan.planId === 'free') {
                        <p class="st-plan-price">Included for every account</p>
                      } @else {
                        <p class="st-plan-price"><strong>{{ aed(plan.priceAed ?? plan.amountAed) }}</strong> per {{ plan.billingPeriod === 'year' ? 'year' : 'month' }} + VAT</p>
                      }
                    </div>
                    <div class="st-actions">
                      @if (plan.planId === 'free') {
                        <a routerLink="/subscription" class="btn-primary">Upgrade</a>
                      } @else {
                        <a routerLink="/subscription" class="btn-ghost">Change plan</a>
                        @if (plan.cancelAtPeriodEnd) {
                          <button type="button" class="btn-primary" [disabled]="planBusy()" (click)="resumePlan()">Keep my plan</button>
                        } @else {
                          <button type="button" class="btn-ghost" [disabled]="planBusy()" (click)="cancelPlan()">Cancel plan</button>
                        }
                      }
                    </div>
                  </div>
                  <dl class="st-plan-facts">
                    <div><dt>Cameras</dt><dd>{{ plan.cameraLimitLabel }}</dd></div>
                    <div><dt>Recording</dt><dd>{{ plan.recording ? 'Included' : 'Not included' }}</dd></div>
                    @if (plan.planId !== 'free') {
                      <div><dt>{{ plan.cancelAtPeriodEnd ? 'Ends on' : 'Renews on' }}</dt><dd>{{ plan.nextBillingLabel }}</dd></div>
                      <div><dt>Payment method</dt><dd>{{ plan.paymentMethodLabel }}</dd></div>
                    }
                  </dl>
                  @if (plan.cancelAtPeriodEnd) {
                    <p class="st-plan-note">Cancelled. You keep {{ plan.planName }} until {{ plan.nextBillingLabel }}, then move to Free.</p>
                  }
                  @if (planMessage(); as msg) {
                    <p class="st-msg st-msg-err">{{ msg }}</p>
                  }
                </div>
              } @else {
                <div class="st-card"><p class="st-card-title">Loading your plan…</p></div>
              }

              @if (subs.history().length) {
                <div class="st-card" style="margin-top: 1rem">
                  <p class="st-card-title">Receipts</p>
                  <div class="st-table-wrap" style="margin-top: 0.75rem">
                    <table class="st-table">
                      <thead><tr><th>Date</th><th>Receipt</th><th>Plan</th><th class="num">Amount</th><th>Status</th></tr></thead>
                      <tbody>
                        @for (r of subs.history(); track r.receiptNumber) {
                          <tr>
                            <td>{{ r.paidAtLabel }}</td>
                            <td>{{ r.receiptNumber }}</td>
                            <td>{{ r.planName }}</td>
                            <td class="num">{{ aed(r.amountAed) }}</td>
                            <td><span [class]="'st-status st-status-' + r.status">{{ statusLabel(r) }}</span></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </section>

            <!-- Detection -->
            <section class="st-section" id="detection" aria-labelledby="detection-h">
              <div class="st-section-head">
                <h2 class="st-section-title" id="detection-h">Detection</h2>
                <p class="st-section-desc">Applies to the live detection pipeline and the Monitoring feed immediately.</p>
              </div>
              <div class="st-card">
                <p class="st-card-title">Loitering threshold</p>
                <p class="st-card-sub">How long someone can stay in a restricted zone before an alert is raised.</p>
                <div class="st-range-row">
                  <div class="st-range" style="min-width: 12rem">
                    <input type="range" min="5" max="300" step="5" class="w-full" [value]="loitering()"
                      (input)="loitering.set(+$any($event.target).value)" aria-label="Loitering threshold in seconds" style="accent-color: var(--color-guardian-accent)" />
                    <div class="st-range-scale"><span>5s</span><span>2.5 min</span><span>5 min</span></div>
                  </div>
                  <div class="st-range-value">
                    <input id="loitering-input" type="number" min="5" max="300" step="1" [value]="loitering()"
                      (input)="loitering.set(+$any($event.target).value)" class="input-field font-mono" aria-label="Seconds" />
                    <span class="text-sm text-guardian-muted">seconds</span>
                  </div>
                  <button type="button" (click)="saveLoitering()" class="btn-primary" [disabled]="loitering() === (savedLoitering() ?? poll.data()?.loitering_threshold_seconds)">Save</button>
                </div>
                @if (message(); as msg) {
                  <p [class]="'st-msg mt-3 ' + (msg.includes('failed') ? 'st-msg-err' : 'st-msg-ok')">{{ msg }}</p>
                }
              </div>
              <div style="margin-top: 1rem">
                <label appToggle label="Track trails" description="Draw each person’s recent path on the live feed." [checked]="trails()" (checkedChange)="saveTrails($event)"></label>
              </div>
            </section>

            <!-- Display -->
            <section class="st-section" id="display" aria-labelledby="display-h">
              <div class="st-section-head">
                <h2 class="st-section-title" id="display-h">Display</h2>
                <p class="st-section-desc">Saved in this browser only; it doesn’t change detection.</p>
              </div>
              <div class="grid gap-3">
                <label appToggle label="Confidence scores" description="Show detection confidence on bounding boxes."
                  [checked]="display().showConfidenceScores" (checkedChange)="updateDisplay({ showConfidenceScores: $event })"></label>
                <label appToggle label="Camera information overlay" description="Show resolution, FPS and people count on the feed."
                  [checked]="display().showCameraOverlay" (checkedChange)="updateDisplay({ showCameraOverlay: $event })"></label>
              </div>
            </section>
          </div>
        </div>
      </div>
    }
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService)
  protected readonly poll = createPoll(() => api.getSettings(), 30_000, POLL_KEYS.settings)

  protected readonly loitering = signal(15)
  protected readonly savedLoitering = signal<number | null>(null)
  protected readonly trails = signal(false)
  protected readonly message = signal<string | null>(null)
  protected readonly display = signal<DisplaySettings>(loadDisplaySettings())
  protected readonly profileName = signal('')
  protected readonly profileMessage = signal<string | null>(null)
  protected readonly profileSaving = signal(false)
  protected readonly currentPassword = signal('')
  protected readonly newPassword = signal('')
  protected readonly confirmPassword = signal('')
  protected readonly passwordMessage = signal<string | null>(null)
  protected readonly passwordSaving = signal(false)
  protected readonly mfaStep = signal<'idle' | 'verify' | 'disable'>('idle')
  protected readonly mfaBusy = signal(false)
  protected readonly mfaCode = signal('')
  protected readonly mfaPassword = signal('')
  protected readonly mfaSentTo = signal('')
  protected readonly mfaDevCode = signal<string | null>(null)
  protected readonly mfaMessage = signal<string | null>(null)
  protected readonly mfaMessageOk = signal(true)
  protected readonly subs = inject(SubscriptionService)
  protected readonly planBusy = signal(false)
  protected readonly planMessage = signal<string | null>(null)
  protected readonly active = signal('account')
  protected readonly aed = (v: number) => formatAedDetailed(v)
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  /** After a rail click, keep that item highlighted while the page scrolls to it. */
  private lockActiveUntil = 0

  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  )

  /** Rail entries show each section's current state at a glance. */
  protected readonly sections = computed(() => {
    const plan = this.subs.current()
    const loiter = this.savedLoitering() ?? this.poll.data()?.loitering_threshold_seconds
    const d = this.display()
    const shown = [d.showConfidenceScores && 'scores', d.showCameraOverlay && 'overlay'].filter(Boolean)
    return [
      { id: 'account', title: 'Account', hint: this.auth.user()?.mfaEnabled ? 'Two-step sign-in on' : 'Two-step sign-in off' },
      { id: 'plan', title: 'Plan & billing', hint: plan ? `${plan.planName} · ${plan.cameraLimitLabel}` : 'Loading…' },
      { id: 'detection', title: 'Detection', hint: `${loiter ?? '—'}s loitering · trails ${this.trails() ? 'on' : 'off'}` },
      { id: 'display', title: 'Display', hint: shown.length ? `Showing ${shown.join(' & ')}` : 'Overlays hidden' },
    ]
  })

  constructor() {
    const destroyRef = inject(DestroyRef)
    const fragment = inject(ActivatedRoute).snapshot.fragment
    afterNextRender(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting)
          if (visible.length && Date.now() > this.lockActiveUntil) {
            visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
            this.active.set((visible[0].target as HTMLElement).id)
          }
        },
        { rootMargin: '-10% 0px -60% 0px' },
      )
      this.host.nativeElement.querySelectorAll('.st-section').forEach((el) => observer.observe(el))
      destroyRef.onDestroy(() => observer.disconnect())
      if (fragment) this.scrollTo(fragment)
    })
    effect(() => {
      const name = this.auth.user()?.name
      if (name) untracked(() => this.profileName.set(name))
    })
    effect(() => {
      const settings = this.poll.data()
      if (!settings) return
      untracked(() => {
        this.loitering.set(settings.loitering_threshold_seconds)
        this.trails.set(settings.show_trails)
      })
    })
  }

  protected async startMfa() {
    this.mfaBusy.set(true)
    this.mfaMessage.set(null)
    try {
      const { sentTo, devCode } = await this.auth.startMfaSetup()
      this.mfaSentTo.set(sentTo)
      this.mfaDevCode.set(devCode)
      this.mfaCode.set('')
      this.mfaStep.set('verify')
    } catch (err) {
      this.mfaMessageOk.set(false)
      this.mfaMessage.set(err instanceof Error ? err.message : 'Could not send a code.')
    } finally {
      this.mfaBusy.set(false)
    }
  }

  protected async confirmMfa(event: Event) {
    event.preventDefault()
    this.mfaBusy.set(true)
    this.mfaMessage.set(null)
    try {
      await this.auth.enableMfa(this.mfaCode())
      this.mfaStep.set('idle')
      this.mfaMessageOk.set(true)
      this.mfaMessage.set('Two-step sign-in is on. You’ll get a code by email next time you sign in.')
    } catch (err) {
      this.mfaMessageOk.set(false)
      this.mfaMessage.set(err instanceof Error ? err.message : 'That code did not work.')
    } finally {
      this.mfaBusy.set(false)
    }
  }

  protected async turnOffMfa(event: Event) {
    event.preventDefault()
    this.mfaBusy.set(true)
    this.mfaMessage.set(null)
    try {
      await this.auth.disableMfa(this.mfaPassword())
      this.mfaPassword.set('')
      this.mfaStep.set('idle')
      this.mfaMessageOk.set(true)
      this.mfaMessage.set('Two-step sign-in is off.')
    } catch (err) {
      this.mfaMessageOk.set(false)
      this.mfaMessage.set(err instanceof Error ? err.message : 'Could not turn it off.')
    } finally {
      this.mfaBusy.set(false)
    }
  }

  protected onMfaCodeInput(event: Event) {
    const el = event.target as HTMLInputElement
    el.value = el.value.replace(/\D/g, '').slice(0, 6)
    this.mfaCode.set(el.value)
  }

  protected cancelMfa() {
    this.mfaStep.set('idle')
    this.mfaCode.set('')
    this.mfaPassword.set('')
    this.mfaDevCode.set(null)
    this.mfaMessage.set(null)
  }

  protected jump(event: Event, id: string) {
    event.preventDefault()
    this.scrollTo(id)
  }

  private scrollTo(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.lockActiveUntil = Date.now() + 900
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    this.active.set(id)
  }

  protected statusLabel(r: SubscriptionReceipt): string {
    if (r.status === 'active') return r.cancelAtPeriodEnd ? 'Ends ' + r.nextBillingLabel : 'Active'
    return r.status === 'replaced' ? 'Replaced' : 'Cancelled'
  }

  protected async cancelPlan() {
    this.planBusy.set(true)
    this.planMessage.set(null)
    try {
      await this.subs.cancel()
    } catch (err) {
      this.planMessage.set(err instanceof Error ? err.message : 'Could not cancel the plan.')
    } finally {
      this.planBusy.set(false)
    }
  }

  protected async resumePlan() {
    this.planBusy.set(true)
    this.planMessage.set(null)
    try {
      await this.subs.resume()
    } catch (err) {
      this.planMessage.set(err instanceof Error ? err.message : 'Could not keep the plan.')
    } finally {
      this.planBusy.set(false)
    }
  }

  protected async saveLoitering() {
    this.message.set(null)
    try {
      const result = await api.updateLoiteringThreshold(this.loitering())
      this.savedLoitering.set(result.loitering_threshold_seconds)
      this.message.set(`Saved. Alerts now fire after ${result.loitering_threshold_seconds} seconds.`)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Save failed')
    }
  }

  protected async saveTrails(enabled: boolean) {
    this.trails.set(enabled)
    try {
      await api.setTrails(enabled)
    } catch {
      this.trails.set(!enabled)
    }
  }

  protected updateDisplay(patch: Partial<DisplaySettings>) {
    const next = { ...this.display(), ...patch }
    this.display.set(next)
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(next))
  }

  protected async saveProfile(event: Event) {
    event.preventDefault()
    this.profileMessage.set(null)
    this.profileSaving.set(true)
    try {
      await this.auth.updateProfile(this.profileName().trim())
      this.profileMessage.set('Profile updated.')
    } catch (err) {
      this.profileMessage.set(err instanceof Error ? err.message : 'Profile update failed.')
    } finally {
      this.profileSaving.set(false)
    }
  }

  protected async savePassword(event: Event) {
    event.preventDefault()
    this.passwordMessage.set(null)
    if (this.newPassword().length < 8) {
      this.passwordMessage.set('New password must be at least 8 characters.')
      return
    }
    if (this.newPassword() !== this.confirmPassword()) {
      this.passwordMessage.set('New passwords do not match.')
      return
    }
    this.passwordSaving.set(true)
    try {
      await this.auth.changePassword(this.currentPassword(), this.newPassword())
      this.currentPassword.set('')
      this.newPassword.set('')
      this.confirmPassword.set('')
      this.passwordMessage.set('Password changed. Sign in again with your new password.')
      window.setTimeout(() => this.auth.logout(), 1500)
    } catch (err) {
      this.passwordMessage.set(err instanceof Error ? err.message : 'Password change failed.')
    } finally {
      this.passwordSaving.set(false)
    }
  }
}
