export type SubscriptionPlanId = 'free' | 'professional' | 'enterprise'
export type BillingPeriod = 'month' | 'year'

export type PaymentMethodId = 'card' | 'apple_pay' | 'google_pay' | 'paypal'

export type CardBrand = 'visa' | 'mastercard' | 'generic' | 'unknown'

export interface SubscriptionPlan {
  id: SubscriptionPlanId
  name: string
  tagline: string
  priceAed: number
  billingPeriod: 'month' | 'year'
  cameraLimit: string
  features: string[]
  highlighted?: boolean
  badge?: string
}

export interface SubscriptionReceipt {
  /** null for the Free plan (nothing was bought). */
  receiptNumber: string | null
  planId: SubscriptionPlanId
  planName: string
  amountAed: number
  billingPeriod: 'month' | 'year'
  paymentMethod: PaymentMethodId | null
  paymentMethodLabel: string | null
  cardBrand?: CardBrand | null
  cardLast4?: string | null
  paidAt: string | null
  paidAtLabel: string
  nextBillingDate: string | null
  nextBillingLabel: string
  status: 'active' | 'replaced' | 'cancelled'
  /** Plan features (from the server). */
  recording?: boolean
  /** Set when the receipt comes from the server (saved to the account). */
  priceAed?: number
  vatAed?: number
  cameraLimit?: number | null
  cameraLimitLabel?: string
  cancelAtPeriodEnd?: boolean
  endedAt?: string | null
}

/** Raw shape returned by /api/subscription (labels are formatted on the client). */
export type ApiSubscription = Omit<SubscriptionReceipt, 'paidAtLabel' | 'nextBillingLabel'>

export interface CheckoutPayload {
  plan_id: Exclude<SubscriptionPlanId, 'free'>
  billing_period: BillingPeriod
  payment_method: PaymentMethodId
  card_brand?: 'visa' | 'mastercard'
  card_last4?: string
}
