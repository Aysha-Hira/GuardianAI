import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { SubscriptionService } from '../core/subscription.service'
import { ActivatedRoute, Router } from '@angular/router'
import { planPrice, SUBSCRIPTION_PLANS } from '../shared/data/subscriptionPlans'
import type { BillingPeriod, SubscriptionPlan } from '../shared/types/subscription'
import { PageHeaderComponent } from '../shared/ui/common'
import { formatAed } from '../shared/utils/subscriptionMock'

@Component({
  selector: 'app-subscription',
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="subscription-page space-y-6">
      <div appPageHeader eyebrow="Business" heading="Choose your plan"
        description="Guardian AI subscription pricing in AED. Scale CCTV monitoring, AI detection, and incident response across your sites."></div>

      @if (upgradeReason() === 'recording') {
        <p class="rounded-lg border border-guardian-border bg-guardian-panel px-4 py-3 text-sm text-guardian-text">
          Recording isn’t included in the Free plan. Choose Professional or Enterprise to record your cameras.
        </p>
      }

      <div class="subscription-billing-toggle" role="group" aria-label="Billing period">
        <button type="button" [class.is-active]="billing() === 'month'" [attr.aria-pressed]="billing() === 'month'" (click)="billing.set('month')">Monthly (AED)</button>
        <button type="button" [class.is-active]="billing() === 'year'" [attr.aria-pressed]="billing() === 'year'" (click)="billing.set('year')">Annual — save 15%</button>
      </div>

      <div class="subscription-plan-grid">
        @for (plan of plans; track plan.id) {
          @let isCurrent = currentPlanId() === plan.id;
          <article [class]="'subscription-plan-card ' + (plan.highlighted ? 'is-highlighted' : '') + (isCurrent ? ' is-current' : '')">
            @if (isCurrent) {
              <span class="subscription-plan-badge subscription-plan-badge-current">Your plan</span>
            } @else if (plan.badge) {
              <span class="subscription-plan-badge">{{ plan.badge }}</span>
            }
            <h2 class="subscription-plan-name">{{ plan.name }}</h2>
            <p class="subscription-plan-tagline">{{ plan.tagline }}</p>
            <div class="subscription-plan-price">
              <span class="subscription-plan-price-value">{{ plan.priceAed === 0 ? 'Free' : aed(price(plan)) }}</span>
              @if (plan.priceAed > 0) {
                <span class="subscription-plan-price-period">/ {{ billing() === 'year' ? 'year' : 'month' }}</span>
              }
            </div>
            @if (plan.priceAed > 0 && billing() === 'year') {
              <p class="text-xs text-guardian-muted">{{ aed(price(plan) / 12) }} a month, billed yearly</p>
            }
            <p class="subscription-plan-limit">{{ plan.cameraLimit }}</p>
            <ul class="subscription-plan-features">
              @for (feature of plan.features; track feature) {
                <li>{{ feature }}</li>
              }
            </ul>
            @if (isCurrent) {
              <button type="button" class="subscription-plan-cta subscription-plan-cta-secondary" disabled>
                {{ plan.id === 'free' ? 'Your current plan' : 'Current plan · renews ' + subs.current()?.nextBillingLabel }}
              </button>
            } @else if (plan.id === 'free') {
              <button type="button" class="subscription-plan-cta subscription-plan-cta-secondary" disabled>
                Included for everyone
              </button>
            } @else {
              <button
                type="button"
                [class]="'subscription-plan-cta ' + (plan.highlighted ? 'subscription-plan-cta-primary' : 'subscription-plan-cta-secondary')"
                (click)="choose(plan.id)"
              >
                {{ subs.isPaid() ? 'Switch to ' + plan.name : 'Upgrade to ' + plan.name }}
              </button>
            }
          </article>
        }
      </div>

      <p class="text-center text-xs text-guardian-muted">
        All prices in UAE Dirhams (AED), plus 5% VAT. Payments are simulated on this demo; your plan is
        saved to your account.
      </p>
    </div>
  `,
})
export class SubscriptionPage {
  private readonly router = inject(Router)
  protected readonly plans = SUBSCRIPTION_PLANS
  protected readonly aed = formatAed
  protected readonly subs = inject(SubscriptionService)
  protected readonly currentPlanId = computed(() => this.subs.current()?.planId ?? 'free')
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap
  protected readonly upgradeReason = signal(this.query.get('upgrade'))
  protected readonly billing = signal<BillingPeriod>(this.query.get('billing') === 'year' ? 'year' : 'month')
  protected price(plan: SubscriptionPlan) {
    return planPrice(plan, this.billing())
  }

  protected choose(planId: string) {
    void this.router.navigate(['/subscription/checkout'], { queryParams: { plan: planId, billing: this.billing() } })
  }
}
