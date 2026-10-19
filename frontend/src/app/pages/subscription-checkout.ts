import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { SubscriptionService } from '../core/subscription.service'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import {
  CardBrandMarkComponent,
  CardBrandRowComponent,
  PaymentProcessingOverlayComponent,
  SecureCheckoutStripComponent,
} from '../features/subscription/subscription-ui'
import { getPlanById, planPrice } from '../shared/data/subscriptionPlans'
import type { BillingPeriod, CardBrand, PaymentMethodId } from '../shared/types/subscription'
import { PageHeaderComponent } from '../shared/ui/common'
import {
  cardBrandLabel,
  formatAedDetailed,
  formatCardNumber,
  formatExpiry,
  mockPaymentStepDelayMs,
  resolveCheckoutCardBrand,
  resolveInputCardBrand,
  saveReceipt,
} from '../shared/utils/subscriptionMock'

const PAYMENT_METHODS: { id: PaymentMethodId; label: string; icon: string }[] = [
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'apple_pay', label: 'Apple Pay', icon: '' },
  { id: 'google_pay', label: 'Google Pay', icon: 'G' },
  { id: 'paypal', label: 'PayPal', icon: 'P' },
]

function walletProcessingSteps(method: PaymentMethodId): string[] {
  const name = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? 'Wallet'
  return ['Establishing secure connection…', `Authenticating ${name}…`, 'Confirming payment…', 'Activating subscription…']
}

function cardProcessingSteps(brand: 'visa' | 'mastercard', last4: string): string[] {
  const name = cardBrandLabel(brand)
  return [
    'Establishing secure connection…',
    `Verifying ${name} ·••• ${last4}…`,
    'Contacting card issuer…',
    'Confirming subscription…',
  ]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Port of React's pages/SubscriptionCheckout (simulated payment — nothing is charged or stored). */
@Component({
  selector: 'app-subscription-checkout',
  imports: [
    RouterLink,
    PageHeaderComponent,
    CardBrandMarkComponent,
    CardBrandRowComponent,
    PaymentProcessingOverlayComponent,
    SecureCheckoutStripComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (plan; as plan) {
      <div class="subscription-page space-y-6">
        <div appPageHeader eyebrow="Checkout" heading="Complete your subscription"
          [description]="'You selected ' + plan.name + '. All payments processed securely in AED.'">
          <div class="shrink-0 pt-1">
            <a routerLink="/subscription" class="text-sm text-guardian-accent hover:underline">← Change plan</a>
          </div>
        </div>

        <app-secure-checkout-strip />

        <form class="subscription-checkout-layout" (submit)="onSubmit($event)">
          <div class="subscription-checkout-panel">
            <h2>Payment method</h2>

            <div class="subscription-pay-methods" role="radiogroup" aria-label="Payment method">
              @for (m of methods; track m.id) {
                <button type="button" [class]="'subscription-pay-method ' + (method() === m.id ? 'is-active' : '')"
                  (click)="method.set(m.id)" [attr.aria-pressed]="method() === m.id">
                  @if (m.id === 'apple_pay') {
                    <span class="subscription-pay-method-icon subscription-pay-apple" aria-hidden="true">{{ appleGlyph }}</span>
                  } @else if (m.id === 'card') {
                    <span class="subscription-pay-method-icon subscription-pay-method-cards">
                      <app-card-brand-mark brand="visa" size="sm" />
                      <app-card-brand-mark brand="mastercard" size="sm" />
                    </span>
                  } @else {
                    <span class="subscription-pay-method-icon">{{ m.icon }}</span>
                  }
                  {{ m.label }}
                </button>
              }
            </div>

            @switch (method()) {
              @case ('card') {
                <div class="subscription-form-grid">
                  <div class="sub-card-form-header">
                    <p class="sub-card-form-title">Card details</p>
                    <app-card-brand-row [activeBrand]="displayBrand()" />
                  </div>

                  <div class="subscription-field">
                    <label for="sub-name">Name on card</label>
                    <input id="sub-name" autocomplete="cc-name" [value]="name()" (input)="name.set($any($event.target).value)"
                      placeholder="Ahmed Al Maktoum" [class]="errors()['name'] ? 'input-error' : ''" />
                    @if (errors()['name']) {
                      <p class="subscription-field-error">{{ errors()['name'] }}</p>
                    }
                  </div>

                  <div class="subscription-field">
                    <label for="sub-card">Card number</label>
                    <div [class]="'sub-card-input-wrap ' + (errors()['cardNumber'] ? 'has-error' : '')">
                      <input id="sub-card" inputmode="numeric" autocomplete="cc-number" [value]="cardNumber()"
                        (input)="setFormatted($event, cardNumber, formatCard)" placeholder="1234 5678 9012 3456"
                        [class]="errors()['cardNumber'] ? 'input-error' : ''" />
                      <span class="sub-card-input-brand">
                        @if (displayBrand() !== 'unknown') {
                          <app-card-brand-mark [brand]="displayBrand()" size="md" />
                        }
                      </span>
                    </div>
                    @if (errors()['cardNumber']) {
                      <p class="subscription-field-error">{{ errors()['cardNumber'] }}</p>
                    }
                  </div>

                  <div class="subscription-form-grid two-col">
                    <div class="subscription-field">
                      <label for="sub-expiry">Expiry</label>
                      <input id="sub-expiry" inputmode="numeric" autocomplete="cc-exp" [value]="expiry()"
                        (input)="setFormatted($event, expiry, formatExp)" placeholder="MM/YY" [class]="errors()['expiry'] ? 'input-error' : ''" />
                      @if (errors()['expiry']) {
                        <p class="subscription-field-error">{{ errors()['expiry'] }}</p>
                      }
                    </div>
                    <div class="subscription-field">
                      <label for="sub-cvc">CVC</label>
                      <input id="sub-cvc" inputmode="numeric" autocomplete="cc-csc" [value]="cvc()"
                        (input)="setFormatted($event, cvc, formatCvc)" placeholder="123" [class]="errors()['cvc'] ? 'input-error' : ''" />
                      @if (errors()['cvc']) {
                        <p class="subscription-field-error">{{ errors()['cvc'] }}</p>
                      }
                    </div>
                  </div>
                </div>
              }
              @case ('apple_pay') {
                <div class="subscription-wallet-panel">
                  <app-secure-checkout-strip [compact]="true" />
                  <p class="text-sm text-guardian-muted">Pay {{ aed(total()) }} with Apple Pay on this device.</p>
                  <button type="submit" class="subscription-wallet-btn subscription-wallet-btn--apple">Pay with Apple Pay</button>
                </div>
              }
              @case ('google_pay') {
                <div class="subscription-wallet-panel">
                  <app-secure-checkout-strip [compact]="true" />
                  <p class="text-sm text-guardian-muted">Pay {{ aed(total()) }} with Google Pay.</p>
                  <button type="submit" class="subscription-wallet-btn subscription-wallet-btn--google">Pay with Google Pay</button>
                </div>
              }
              @default {
                <div class="subscription-wallet-panel">
                  <app-secure-checkout-strip [compact]="true" />
                  <p class="text-sm text-guardian-muted">You will be redirected to PayPal to approve {{ aed(total()) }}.</p>
                  <button type="submit" class="subscription-wallet-btn subscription-wallet-btn--paypal">PayPal Checkout</button>
                </div>
              }
            }

            @if (method() === 'card') {
              <button type="submit" class="subscription-submit-btn" [disabled]="processing()">
                <span class="sub-submit-lock" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 118 0v3" />
                  </svg>
                </span>
                Securely pay {{ aed(total()) }}
              </button>
            }
            @if (payError(); as err) {
              <p class="subscription-field-error" role="alert">{{ err }}</p>
            }

            <div class="subscription-trust-footer">
              <p class="subscription-secure-note">Your payment details are encrypted and never stored on our servers.</p>
              <div class="subscription-trust-badges">
                <span>PCI DSS</span>
                <span>3D Secure ready</span>
                <span>UAE VAT compliant</span>
              </div>
            </div>
          </div>

          <aside class="subscription-checkout-panel">
            <h2>Order summary</h2>
            <div class="subscription-summary-row"><span>{{ plan.name }} plan</span><span>{{ aed(price()) }}</span></div>
            <div class="subscription-summary-row"><span>Billing</span><span>{{ billing === 'year' ? 'Annual (save 15%)' : 'Monthly' }}</span></div>
            <div class="subscription-summary-row"><span>Cameras</span><span>{{ plan.cameraLimit }}</span></div>
            <div class="subscription-summary-row"><span>VAT (5%)</span><span>{{ aed(vat()) }}</span></div>
            <div class="subscription-summary-row total"><span>Total due today</span><span>{{ aed(total()) }}</span></div>

            <ul class="subscription-plan-features" style="margin-top: 1.25rem">
              @for (f of plan.features.slice(0, 4); track f) {
                <li>{{ f }}</li>
              }
            </ul>

            <div class="sub-summary-secure">
              <app-secure-checkout-strip [compact]="true" />
            </div>
          </aside>
        </form>

        @if (processing()) {
          <app-payment-processing-overlay
            [label]="processingLabel()"
            [sublabel]="processingSub()"
            [steps]="processingSteps()"
            [activeStep]="processingStep()"
            [method]="method()"
            [cardBrand]="processingBrand()"
            [cardLast4]="processingLast4()"
            [amountAed]="total()"
            [phase]="processingPhase()"
            [exiting]="processingExiting()"
          />
        }
      </div>
    }
  `,
})
export class SubscriptionCheckoutPage {
  private readonly router = inject(Router)
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap
  /** Only paid plans can be bought; Free is the default for everyone. */
  protected readonly plan = (() => {
    const p = getPlanById(this.query.get('plan'))
    return p && p.id !== 'free' ? p : undefined
  })()
  protected readonly billing: BillingPeriod = this.query.get('billing') === 'year' ? 'year' : 'month'
  protected readonly price = computed(() => (this.plan ? planPrice(this.plan, this.billing) : 0))
  protected readonly methods = PAYMENT_METHODS
  protected readonly appleGlyph = ''
  protected readonly aed = formatAedDetailed
  protected readonly formatCard = formatCardNumber
  protected readonly formatExp = formatExpiry
  protected readonly formatCvc = (v: string) => v.replace(/\D/g, '').slice(0, 4)

  protected readonly method = signal<PaymentMethodId>('card')
  protected readonly processing = signal(false)
  protected readonly processingPhase = signal<'processing' | 'success'>('processing')
  protected readonly processingExiting = signal(false)
  protected readonly processingLabel = signal('Processing payment…')
  protected readonly processingSub = signal('Secured by Guardian Pay')
  protected readonly processingSteps = signal<string[]>([])
  protected readonly processingStep = signal(0)
  protected readonly processingBrand = signal<CardBrand>('unknown')
  protected readonly processingLast4 = signal<string | undefined>(undefined)

  protected readonly name = signal('')
  protected readonly cardNumber = signal('')
  protected readonly expiry = signal('')
  protected readonly cvc = signal('')
  protected readonly errors = signal<Record<string, string>>({})
  protected readonly payError = signal<string | null>(null)
  private readonly subscriptions = inject(SubscriptionService)

  private readonly cardDigits = computed(() => this.cardNumber().replace(/\D/g, ''))
  protected readonly displayBrand = computed(() => resolveInputCardBrand(this.cardDigits()))
  protected readonly vat = computed(() => Math.round(this.price() * 0.05))
  protected readonly total = computed(() => this.price() + this.vat())

  constructor() {
    if (!this.plan) void this.router.navigate(['/subscription'], { replaceUrl: true })
  }

  /** Controlled input with formatting (React re-rendered the formatted value). */
  protected setFormatted(event: Event, target: { set(v: string): void }, format: (v: string) => string) {
    const el = event.target as HTMLInputElement
    const value = format(el.value)
    el.value = value
    target.set(value)
  }

  private validateCard(): boolean {
    const next: Record<string, string> = {}
    if (!this.name().trim()) next['name'] = 'Name on card is required'
    if (this.cardDigits().length !== 16) next['cardNumber'] = 'Enter a 16-digit card number'
    if (this.expiry().replace(/\D/g, '').length < 4) next['expiry'] = 'Enter MM/YY'
    if (this.cvc().replace(/\D/g, '').length < 3) next['cvc'] = 'Enter CVC'
    this.errors.set(next)
    return Object.keys(next).length === 0
  }

  private async runProcessingSteps(steps: string[]) {
    for (let i = 0; i < steps.length; i++) {
      this.processingStep.set(i)
      this.processingLabel.set(steps[i]!)
      if (i === 0) this.processingSub.set('256-bit encrypted connection established')
      else if (i === steps.length - 1) this.processingSub.set('Finalizing your Guardian AI subscription')
      else this.processingSub.set('Secured checkout · do not close this window')
      await sleep(mockPaymentStepDelayMs())
    }
  }

  private async completePayment(paymentMethod: PaymentMethodId, cardLast4?: string) {
    const plan = this.plan
    if (!plan) return
    const resolvedBrand = paymentMethod === 'card' ? resolveCheckoutCardBrand(this.cardDigits()) : undefined
    const steps =
      paymentMethod === 'card' && resolvedBrand
        ? cardProcessingSteps(resolvedBrand, cardLast4 ?? '0000')
        : walletProcessingSteps(paymentMethod)

    this.processingBrand.set(resolvedBrand ?? 'unknown')
    this.processingLast4.set(cardLast4)
    this.processingSteps.set(steps)
    this.processingStep.set(0)
    this.processingPhase.set('processing')
    this.processingExiting.set(false)
    this.processingLabel.set(steps[0]!)
    this.processingSub.set('256-bit encrypted connection established')
    this.processing.set(true)
    this.payError.set(null)

    // The plan is saved to the signed-in account on the server while the animation runs.
    const saved = this.subscriptions
      .checkout({
        plan_id: plan.id as 'professional' | 'enterprise',
        billing_period: this.billing,
        payment_method: paymentMethod,
        ...(paymentMethod === 'card' && resolvedBrand ? { card_brand: resolvedBrand, card_last4: cardLast4 } : {}),
      })
      .then(
        (r) => ({ ok: true as const, receipt: r }),
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'Payment could not be completed.' }),
      )

    await this.runProcessingSteps(steps)
    const result = await saved
    if (!result.ok) {
      this.processingExiting.set(true)
      await sleep(300)
      this.processing.set(false)
      this.payError.set(`Payment not completed: ${result.error}`)
      return
    }

    this.processingPhase.set('success')
    this.processingStep.set(steps.length)
    this.processingLabel.set('Payment confirmed')
    this.processingSub.set('Preparing your receipt…')
    await sleep(1100)

    const receipt = result.receipt
    saveReceipt(receipt)

    this.processingExiting.set(true)
    await sleep(480)

    this.processing.set(false)
    void this.router.navigate(['/subscription/confirmation'], { replaceUrl: true, state: { receipt } })
  }

  protected onSubmit(event: Event) {
    event.preventDefault()
    const method = this.method()
    if (method === 'card') {
      if (!this.validateCard()) return
      void this.completePayment('card', this.cardDigits().slice(-4))
      return
    }
    void this.completePayment(method)
  }
}
