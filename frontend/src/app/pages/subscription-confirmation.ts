import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import {
  CardBrandMarkComponent,
  SecureCheckoutStripComponent,
} from '../features/subscription/subscription-ui'
import type { SubscriptionReceipt } from '../shared/types/subscription'
import { PageHeaderComponent } from '../shared/ui/common'
import { formatAedDetailed, loadReceipt } from '../shared/utils/subscriptionMock'

/** Port of React's pages/SubscriptionConfirmation. */
@Component({
  selector: 'app-subscription-confirmation',
  imports: [RouterLink, PageHeaderComponent, CardBrandMarkComponent, SecureCheckoutStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (receipt; as r) {
      <div class="subscription-page subscription-confirm-page space-y-6">
        <div class="subscription-confirm-header">
          <div appPageHeader eyebrow="Billing" heading="Subscription confirmed"></div>
        </div>

        <div class="subscription-confirm-wrap">
          <div class="subscription-confirm-card">
            <div class="subscription-confirm-icon" aria-hidden="true">
              <span class="subscription-confirm-icon-ring"></span>
              <span class="subscription-confirm-icon-ring subscription-confirm-icon-ring--delayed"></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path class="subscription-confirm-check-path" d="M6 12.5l3.5 3.5L18 8" />
              </svg>
            </div>

            <h2 class="subscription-confirm-title">Payment successful</h2>
            <p class="subscription-confirm-sub">
              Your {{ r.planName }} plan is now active. A confirmation email would be sent in
              production.
            </p>

            <div class="subscription-receipt-box">
              <h3>Receipt</h3>
              <dl>
                @for (row of rows; track row; let i = $index) {
                  <div class="subscription-receipt-row" [style.animation-delay]="(0.52 + i * 0.07) + 's'">
                    <dt>{{ row }}</dt>
                    <dd [attr.class]="row === 'Receipt number' ? 'subscription-receipt-number' : null">
                      @switch (row) {
                        @case ('Receipt number') { {{ r.receiptNumber }} }
                        @case ('Plan') { {{ r.planName }} }
                        @case ('Status') { <span style="color: #34d399; text-transform: capitalize">{{ r.status }}</span> }
                        @case ('Amount paid') { {{ aed(r.amountAed) }} }
                        @case ('Payment method') {
                          <span class="subscription-receipt-pay">
                            @if (r.cardBrand && r.cardBrand !== 'unknown') {
                              <app-card-brand-mark [brand]="r.cardBrand" size="sm" />
                            }
                            <span>{{ r.paymentMethodLabel }}{{ r.cardLast4 && !(r.paymentMethodLabel ?? '').includes(r.cardLast4) ? ' ·••• ' + r.cardLast4 : '' }}</span>
                          </span>
                        }
                        @case ('Paid on') { {{ r.paidAtLabel }} }
                        @case ('Next billing') { {{ r.nextBillingLabel }} }
                      }
                    </dd>
                  </div>
                }
              </dl>
            </div>

            <div class="subscription-confirm-strip">
              <app-secure-checkout-strip [compact]="true" />
            </div>

            <div class="subscription-confirm-actions">
              <a routerLink="/" class="subscription-confirm-primary">Go to dashboard</a>
              <a routerLink="/subscription" class="subscription-confirm-ghost">View plans</a>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class SubscriptionConfirmationPage {
  protected readonly receipt: SubscriptionReceipt | null =
    (history.state as { receipt?: SubscriptionReceipt } | null)?.receipt ?? loadReceipt()
  protected readonly rows = [
    'Receipt number',
    'Plan',
    'Status',
    'Amount paid',
    'Payment method',
    'Paid on',
    'Next billing',
  ]
  protected readonly aed = formatAedDetailed

  constructor() {
    if (!this.receipt) void inject(Router).navigate(['/subscription'], { replaceUrl: true })
  }
}
