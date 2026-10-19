import type {
  CardBrand,
  PaymentMethodId,
  SubscriptionPlan,
  SubscriptionReceipt,
} from '../types/subscription'

export const SUBSCRIPTION_RECEIPT_KEY = 'guardian_subscription_receipt'

const PAYMENT_LABELS: Record<PaymentMethodId, string> = {
  card: 'Credit / debit card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  paypal: 'PayPal',
}

export function cardBrandLabel(brand: CardBrand): string {
  if (brand === 'visa') return 'Visa'
  if (brand === 'mastercard') return 'Mastercard'
  if (brand === 'generic') return 'Card'
  return 'Card'
}

/** Stable pseudo-random brand from BIN (first 4 digits). */
export function stableRandomCardBrand(digits: string): 'visa' | 'mastercard' {
  const d = digits.replace(/\D/g, '').slice(0, 4)
  if (!d) return 'visa'
  let hash = 0
  for (let i = 0; i < d.length; i++) {
    hash = (hash + parseInt(d[i]!, 10) * (i + 3)) % 997
  }
  return hash % 2 === 0 ? 'visa' : 'mastercard'
}

/** Brand shown in the card-number field while typing. */
export function resolveInputCardBrand(digits: string): CardBrand {
  const d = digits.replace(/\D/g, '')
  if (!d) return 'unknown'

  const detected = detectCardBrand(d)
  if (detected !== 'unknown') return detected
  if (d.length >= 4) return stableRandomCardBrand(d)
  return 'generic'
}
/** Detect Visa or Mastercard from partial or full PAN. */
export function detectCardBrand(digits: string): Exclude<CardBrand, 'generic'> {
  const d = digits.replace(/\D/g, '')
  if (!d) return 'unknown'
  if (/^4/.test(d)) return 'visa'
  if (/^5[1-5]/.test(d)) return 'mastercard'
  if (/^2(?:2[2-9]|[3-6]\d|7[01]\d|720)/.test(d)) return 'mastercard'
  return 'unknown'
}

/** Brand used at checkout completion — matches the input field icon. */
export function resolveCheckoutCardBrand(digits: string): 'visa' | 'mastercard' {
  const brand = resolveInputCardBrand(digits)
  if (brand === 'visa' || brand === 'mastercard') return brand
  return stableRandomCardBrand(digits)
}

export function isValidLuhn(digits: string): boolean {
  const d = digits.replace(/\D/g, '')
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i]!, 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function isSupportedCard(digits: string): boolean {
  const brand = detectCardBrand(digits)
  if (brand === 'unknown') return false
  const len = digits.replace(/\D/g, '').length
  if (brand === 'visa') return len === 13 || len === 16 || len === 19
  if (brand === 'mastercard') return len === 16
  return false
}

export function formatAed(amount: number): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatAedDetailed(amount: number): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

export function generateReceiptNumber(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const seq = Math.floor(10000 + Math.random() * 89999)
  return `GRD-AED-${date}-${seq}`
}

export function buildMockReceipt(
  plan: SubscriptionPlan,
  paymentMethod: PaymentMethodId,
  cardLast4?: string,
  cardBrand?: CardBrand,
): SubscriptionReceipt {
  const paidAt = new Date()
  const nextBilling = new Date(paidAt)
  nextBilling.setMonth(nextBilling.getMonth() + 1)

  const paidAtLabel = paidAt.toLocaleString('en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const nextBillingLabel = nextBilling.toLocaleDateString('en-AE', {
    dateStyle: 'long',
  })

  const brandLabel =
    paymentMethod === 'card' && cardBrand && cardBrand !== 'unknown' && cardBrand !== 'generic'
      ? cardBrandLabel(cardBrand)
      : null

  return {
    receiptNumber: generateReceiptNumber(),
    planId: plan.id,
    planName: plan.name,
    amountAed: plan.priceAed,
    billingPeriod: plan.billingPeriod,
    paymentMethod,
    paymentMethodLabel:
      brandLabel && paymentMethod === 'card'
        ? `${brandLabel}${cardLast4 ? ` ·••• ${cardLast4}` : ''}`
        : PAYMENT_LABELS[paymentMethod],
    cardBrand: paymentMethod === 'card' ? cardBrand : undefined,
    cardLast4: paymentMethod === 'card' ? cardLast4 : undefined,
    paidAt: paidAt.toISOString(),
    paidAtLabel,
    nextBillingDate: nextBilling.toISOString(),
    nextBillingLabel,
    status: 'active',
  }
}

export function saveReceipt(receipt: SubscriptionReceipt): void {
  sessionStorage.setItem(SUBSCRIPTION_RECEIPT_KEY, JSON.stringify(receipt))
}

export function loadReceipt(): SubscriptionReceipt | null {
  try {
    const raw = sessionStorage.getItem(SUBSCRIPTION_RECEIPT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SubscriptionReceipt
  } catch {
    return null
  }
}

export function clearReceipt(): void {
  sessionStorage.removeItem(SUBSCRIPTION_RECEIPT_KEY)
}

export function randomCheckoutCardBrand(): 'visa' | 'mastercard' {
  return Math.random() < 0.5 ? 'visa' : 'mastercard'
}

export function mockPaymentStepDelayMs(): number {
  return 1800 + Math.floor(Math.random() * 600)
}

/** @deprecated Use mockPaymentStepDelayMs per step instead. */
export function mockPaymentDelayMs(): number {
  return mockPaymentStepDelayMs() * 4
}

export function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16)
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}
