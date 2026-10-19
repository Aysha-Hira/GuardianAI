import { computed, effect, Injectable, inject, signal, untracked } from '@angular/core'
import { api } from '../shared/services/api'
import type { ApiSubscription, CheckoutPayload, SubscriptionReceipt } from '../shared/types/subscription'
import { AuthService } from './auth.service'

/** Adds the display labels the receipt / confirmation UI expects. */
export function withLabels(s: ApiSubscription): SubscriptionReceipt {
  return {
    ...s,
    paidAtLabel: s.paidAt ? new Date(s.paidAt).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '',
    nextBillingLabel: s.nextBillingDate
      ? new Date(s.nextBillingDate).toLocaleDateString('en-AE', { dateStyle: 'long' })
      : '',
  }
}

/** The signed-in user's plan, saved on the server (survives devices and browsers). */
@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly auth = inject(AuthService)
  readonly current = signal<SubscriptionReceipt | null>(null)
  readonly history = signal<SubscriptionReceipt[]>([])
  readonly loaded = signal(false)
  /** True when the user is on a paid plan. */
  readonly isPaid = computed(() => {
    const id = this.current()?.planId
    return !!id && id !== 'free'
  })

  constructor() {
    // Reload whenever the signed-in user changes; clear on sign-out.
    effect(() => {
      const id = this.auth.user()?.id
      untracked(() => {
        if (id) void this.refresh()
        else {
          this.current.set(null)
          this.history.set([])
          this.loaded.set(false)
        }
      })
    })
  }

  async refresh(): Promise<void> {
    try {
      const data = await api.getSubscription()
      this.current.set(data.current ? withLabels(data.current) : null)
      this.history.set(data.history.map(withLabels))
    } catch {
      /* keep last known state; pages show their own errors */
    } finally {
      this.loaded.set(true)
    }
  }

  async checkout(payload: CheckoutPayload): Promise<SubscriptionReceipt> {
    const { receipt } = await api.checkoutSubscription(payload)
    const labelled = withLabels(receipt)
    void this.refresh()
    return labelled
  }

  async cancel(): Promise<void> {
    const { current } = await api.cancelSubscription()
    this.current.set(withLabels(current))
  }

  async resume(): Promise<void> {
    const { current } = await api.resumeSubscription()
    this.current.set(withLabels(current))
  }
}
