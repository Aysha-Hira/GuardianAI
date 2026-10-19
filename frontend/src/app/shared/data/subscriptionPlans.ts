import type { BillingPeriod, SubscriptionPlan } from '../types/subscription'

export const ANNUAL_DISCOUNT = 0.15

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everyone starts here: one live camera',
    priceAed: 0,
    billingPeriod: 'month',
    cameraLimit: '1 camera',
    features: [
      'Live monitoring wall',
      'Person detection & tracking',
      'Incident alerts',
      'No recording',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'Multi-zone security for growing operations',
    priceAed: 699,
    billingPeriod: 'month',
    cameraLimit: 'Up to 20 cameras',
    highlighted: true,
    badge: 'Most popular',
    features: [
      'Everything in Free',
      'Recording & incident clips',
      'Restricted zones & loitering',
      'Vehicle detection lanes',
      'CCTV site map & digital twin',
      'PDF reports & priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Full platform for multi-site command centers',
    priceAed: 1499,
    billingPeriod: 'month',
    cameraLimit: 'Unlimited cameras',
    features: [
      'Everything in Professional',
      'Face recognition watchlists',
      'Multi-site dashboard',
      'Custom retention & exports',
      'Dedicated account manager',
      'SLA & 24/7 phone support',
    ],
  },
]

export function getPlanById(id: string | null | undefined): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id)
}

export function planPrice(plan: SubscriptionPlan, period: BillingPeriod): number {
  return period === 'year' ? Math.round(plan.priceAed * 12 * (1 - ANNUAL_DISCOUNT)) : plan.priceAed
}
