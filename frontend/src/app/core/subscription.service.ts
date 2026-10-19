import { computed, effect, Injectable, inject, signal, untracked } from '@angular/core'
import { api } from '../shared/services/api'
import type { ApiSubscription, CheckoutPayload, SubscriptionReceipt } from '../shared/types/subscription'
import { AuthService } from './auth.service'

export function withLabels(s: ApiSubscription): SubscriptionReceipt {
  return {
    ...s,
    paidAtLabel: s.paidAt ? new Date(s.paidAt).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '',
    nextBillingLabel: s.nextBillingDate
      ? new Date(s.nextBillingDate).toLocaleDateString('en-AE', { dateStyle: 'long' })
      : '',
  }
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly auth = inject(AuthService)
  readonly current = signal<SubscriptionReceipt | null>(null)
  readonly history = signal<SubscriptionReceipt[]>([])
  readonly loaded = signal(false)
  readonly isPaid = computed(() => {
    const id = this.current()?.planId
    return !!id && id !== 'free'
  })

  constructor() {
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
