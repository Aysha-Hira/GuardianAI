import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import type { CardBrand, PaymentMethodId } from '../../shared/types/subscription'
import { cardBrandLabel, formatAedDetailed } from '../../shared/utils/subscriptionMock'

@Component({
  selector: 'app-card-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @switch (brand()) {
      @case ('visa') {
        <span [class]="cn() + ' sub-card-brand--visa'" aria-label="Visa">VISA</span>
      }
      @case ('mastercard') {
        <span [class]="cn() + ' sub-card-brand--mastercard'" aria-label="Mastercard">
          <span class="sub-mc-circle sub-mc-circle--red"></span>
          <span class="sub-mc-circle sub-mc-circle--yellow"></span>
        </span>
      }
      @case ('generic') {
        <span [class]="cn() + ' sub-card-brand--generic'" aria-label="Card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        </span>
      }
    }
  `,
})
export class CardBrandMarkComponent {
  readonly brand = input.required<CardBrand>()
  readonly size = input<'sm' | 'md' | 'lg'>('md')
  readonly inactive = input(false)
  protected readonly cn = computed(
    () => `sub-card-brand sub-card-brand--${this.size()}${this.inactive() ? ' is-inactive' : ''}`,
  )
}

@Component({
  selector: 'app-card-brand-row',
  imports: [CardBrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="sub-card-brands-row" aria-label="Accepted cards">
      <app-card-brand-mark brand="visa" size="sm" [inactive]="isInactive('visa')" />
      <app-card-brand-mark brand="mastercard" size="sm" [inactive]="isInactive('mastercard')" />
    </div>
  `,
})
export class CardBrandRowComponent {
  readonly activeBrand = input.required<CardBrand>()
  protected isInactive(brand: CardBrand) {
    const a = this.activeBrand()
    return a !== 'unknown' && a !== 'generic' && a !== brand
  }
}

@Component({
  selector: 'app-secure-checkout-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div [class]="'sub-secure-strip ' + (compact() ? 'sub-secure-strip--compact' : '')">
      <div class="sub-secure-strip-main">
        <span class="sub-secure-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 118 0v3" />
          </svg>
        </span>
        <div>
          <p class="sub-secure-title">Secure checkout</p>
          @if (!compact()) {
            <p class="sub-secure-sub">256-bit TLS encryption · PCI DSS compliant processing</p>
          }
        </div>
      </div>
      @if (!compact()) {
        <div class="sub-secure-badges" aria-label="Security badges">
          <span class="sub-secure-badge">SSL</span>
          <span class="sub-secure-badge">3D Secure</span>
          <span class="sub-secure-badge">Verified</span>
        </div>
      }
    </div>
  `,
})
export class SecureCheckoutStripComponent {
  readonly compact = input(false)
}

@Component({
  selector: 'app-payment-processing-overlay',
  imports: [SecureCheckoutStripComponent, CardBrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div [class]="'subscription-processing' + (exiting() ? ' is-exiting' : '')" role="status" aria-live="polite">
      <div [class]="'subscription-processing-card' + (phase() === 'success' ? ' is-success' : '')">
        <app-secure-checkout-strip [compact]="true" />

        <div class="subscription-processing-icon-wrap">
          @if (phase() === 'success') {
            <div class="subscription-processing-success-icon" aria-hidden="true">
              <span class="subscription-processing-success-ring"></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path class="subscription-processing-check-path" d="M6 12.5l3.5 3.5L18 8" />
              </svg>
            </div>
          } @else if (method() === 'card' && cardBrand() && cardBrand() !== 'unknown') {
            <app-card-brand-mark [brand]="cardBrand()!" size="lg" />
          } @else {
            <div class="subscription-processing-spinner" aria-hidden="true"></div>
          }
        </div>

        <p class="subscription-processing-text">{{ label() }}</p>
        <p class="subscription-processing-sub">{{ sublabel() }}</p>

        @if (method() === 'card' && cardLast4()) {
          <p class="subscription-processing-card-line">
            {{ cardBrand() && cardBrand() !== 'unknown' ? brandLabel(cardBrand()!) : 'Card' }} ·••• {{ cardLast4() }}
            <span class="subscription-processing-amount">{{ aed(amountAed()) }}</span>
          </p>
        } @else {
          <p class="subscription-processing-card-line">{{ aed(amountAed()) }}</p>
        }

        <div class="subscription-processing-progress" aria-hidden="true">
          <div class="subscription-processing-progress-bar" [style.width.%]="progress()"></div>
        </div>

        <ol class="subscription-processing-steps">
          @for (step of steps(); track step; let i = $index) {
            <li [attr.class]="i < doneStep() ? 'is-done' : i === doneStep() && phase() === 'processing' ? 'is-active' : null">
              <span class="subscription-processing-step-dot" aria-hidden="true"></span>
              {{ step }}
            </li>
          }
        </ol>

        <p class="subscription-processing-footer">Do not close or refresh this page</p>
      </div>
    </div>
  `,
})
export class PaymentProcessingOverlayComponent {
  readonly label = input.required<string>()
  readonly sublabel = input.required<string>()
  readonly steps = input.required<string[]>()
  readonly activeStep = input.required<number>()
  readonly method = input.required<PaymentMethodId>()
  readonly cardBrand = input<CardBrand>()
  readonly cardLast4 = input<string>()
  readonly amountAed = input.required<number>()
  readonly phase = input<'processing' | 'success'>('processing')
  readonly exiting = input(false)
  protected readonly aed = formatAedDetailed
  protected readonly brandLabel = cardBrandLabel
  protected readonly progress = computed(() =>
    this.phase() === 'success' ? 100 : ((this.activeStep() + 1) / this.steps().length) * 100,
  )
  protected readonly doneStep = computed(() => (this.phase() === 'success' ? this.steps().length : this.activeStep()))
}
