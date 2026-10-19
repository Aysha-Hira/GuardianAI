import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router, RouterLink } from '@angular/router'
import { filter, map } from 'rxjs'
import { AuthService } from '../core/auth.service'
import { createPoll, POLL_KEYS } from '../core/polling'
import { SidebarService } from '../core/sidebar.service'
import { SubscriptionService } from '../core/subscription.service'
import { api } from '../shared/services/api'
import { IconComponent } from '../shared/ui/icon'
import { SeverityBadgeComponent } from '../shared/ui/severity-badge'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Operations Dashboard',
  '/monitoring': 'Live Monitoring',
  '/incidents': 'Incident Management',
  '/cameras': 'Camera Wall',
  '/cctv-map': 'CCTV Site Map',
  '/face-recognition': 'Face Recognition',
  '/multicam-reid': 'Multi-Camera Re-ID Lab',
  '/analytics': 'Analytics',
  '/reports': 'Reports',
  '/settings': 'System Settings',
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Port of React's Header. */
@Component({
  selector: 'app-header',
  imports: [RouterLink, IconComponent, SeverityBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <header class="sticky top-0 z-20 flex h-[3.75rem] shrink-0 items-center justify-between border-b border-guardian-border bg-guardian-surface/90 px-4 backdrop-blur-md lg:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-guardian-border bg-guardian-panel text-guardian-muted transition hover:bg-guardian-panel-hover hover:text-guardian-text lg:hidden"
          aria-label="Open navigation menu"
          (click)="sidebar.setMobileOpen(true)"
        >
          <svg appIcon="menu" class="h-4 w-4"></svg>
        </button>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-white">{{ pageTitle() }}</p>
          <div class="mt-0.5 flex items-center gap-3">
            <span
              [class]="'inline-flex items-center gap-1.5 text-[11px] font-medium ' + (online() ? 'text-emerald-400' : 'text-guardian-muted')"
            >
              <span [class]="'h-1.5 w-1.5 rounded-full ' + (online() ? 'bg-emerald-400' : 'bg-zinc-500')"></span>
              {{ online() ? 'System Online' : 'Camera Offline' }}
            </span>
            @if (status.data()?.fps != null && online()) {
              <span class="text-guardian-border">·</span>
              <span class="font-mono text-[11px] text-guardian-muted">{{ status.data()?.fps }} FPS</span>
            }
            @if (status.data()?.active_tracks != null && online()) {
              <span class="text-guardian-border">·</span>
              <span class="text-[11px] text-guardian-muted">{{ status.data()?.active_tracks }} tracks</span>
            }
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="hidden text-right sm:block">
          <time class="block font-mono text-sm tabular-nums text-guardian-text">{{ clock() }}</time>
          <span class="text-[10px] text-guardian-muted">{{ date() }}</span>
        </div>

        <div class="relative" #alertsMenu>
          <button
            type="button"
            (click)="alertsOpen.set(!alertsOpen())"
            class="relative flex h-9 w-9 items-center justify-center rounded-lg border border-guardian-border bg-guardian-panel text-guardian-muted transition hover:border-guardian-border hover:bg-guardian-panel-hover hover:text-guardian-text"
            title="Alerts"
            [attr.aria-label]="newCount() + ' new alerts'"
            [attr.aria-expanded]="alertsOpen()"
          >
            <svg appIcon="bell" class="h-4 w-4"></svg>
            @if (newCount() > 0) {
              <span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-guardian-surface">
                {{ newCount() > 99 ? '99+' : newCount() }}
              </span>
            }
          </button>

          @if (alertsOpen()) {
            <div class="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-guardian-border bg-guardian-panel shadow-xl">
              <div class="flex items-center justify-between border-b border-guardian-border-subtle px-4 py-3">
                <p class="text-xs font-semibold uppercase tracking-wider text-guardian-muted">Recent Alerts</p>
                @if (newCount() > 0) {
                  <span class="rounded-full bg-red-600/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">{{ newCount() }} new</span>
                }
              </div>
              <div class="max-h-72 overflow-y-auto p-2">
                @for (alert of recentAlerts(); track alert.id) {
                  <a
                    routerLink="/incidents"
                    [queryParams]="{ alert: alert.id }"
                    (click)="alertsOpen.set(false)"
                    class="block rounded-lg px-3 py-2.5 transition hover:bg-guardian-panel-hover"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <p class="text-sm font-medium text-white">{{ alert.event_label }}</p>
                      <span appSeverityBadge [severity]="alert.severity" [label]="alert.severity_label"></span>
                    </div>
                    <p class="mt-1 text-xs text-guardian-muted">{{ alert.camera }} · {{ alert.time_label }}</p>
                  </a>
                } @empty {
                  <p class="px-2 py-6 text-center text-sm text-guardian-muted">No alerts this session</p>
                }
              </div>
              <div class="border-t border-guardian-border-subtle p-2">
                <a
                  routerLink="/incidents"
                  (click)="alertsOpen.set(false)"
                  class="block rounded-lg py-2 text-center text-xs font-medium text-guardian-accent hover:bg-guardian-accent/5"
                >
                  View all incidents →
                </a>
              </div>
            </div>
          }
        </div>

        <div class="relative" #userMenu>
          <button
            type="button"
            (click)="userOpen.set(!userOpen())"
            class="flex h-9 items-center gap-2 rounded-lg border border-guardian-border bg-guardian-panel pl-1.5 pr-2.5 text-guardian-text transition hover:bg-guardian-panel-hover"
            [attr.aria-expanded]="userOpen()"
            aria-label="Account menu"
          >
            <span class="flex h-6 w-6 items-center justify-center rounded-md bg-guardian-accent/15 text-[10px] font-bold text-guardian-accent">{{ initials() }}</span>
            <span class="hidden max-w-[7rem] truncate text-xs font-medium sm:block">{{ auth.user()?.name }}</span>
          </button>

          @if (userOpen()) {
            <div class="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-guardian-border bg-guardian-panel shadow-xl">
              <div class="border-b border-guardian-border-subtle px-4 py-3">
                <p class="truncate text-sm font-medium text-white">{{ auth.user()?.name }}</p>
                <p class="truncate text-xs text-guardian-muted">{{ auth.user()?.email }}</p>
                @if (subs.current(); as plan) {
                  @if (plan.planId === 'free') {
                    <a routerLink="/subscription" (click)="userOpen.set(false)"
                      class="mt-2 inline-flex rounded-md border border-guardian-border px-2 py-1 text-[11px] text-guardian-muted hover:text-guardian-text">
                      Free plan · Upgrade
                    </a>
                  } @else {
                    <a routerLink="/settings" fragment="plan" (click)="userOpen.set(false)"
                      class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-guardian-accent/10 px-2 py-1 text-[11px] font-medium text-guardian-accent hover:bg-guardian-accent/15">
                      {{ plan.planName }} plan · {{ plan.cameraLimitLabel }}
                    </a>
                  }
                }
              </div>
              <div class="p-2">
                <a
                  routerLink="/settings"
                  (click)="userOpen.set(false)"
                  class="block rounded-lg px-3 py-2 text-sm text-guardian-text transition hover:bg-guardian-panel-hover"
                >
                  Settings
                </a>
                <button
                  type="button"
                  (click)="signOut()"
                  class="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 transition hover:bg-red-500/10"
                >
                  Sign out
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  protected readonly auth = inject(AuthService)
  protected readonly sidebar = inject(SidebarService)
  protected readonly subs = inject(SubscriptionService)
  private readonly router = inject(Router)

  protected readonly status = createPoll(() => api.getStatus(), 4000, POLL_KEYS.status)
  private readonly alerts = createPoll(() => api.getAlerts(), 4000, POLL_KEYS.alerts)

  protected readonly alertsOpen = signal(false)
  protected readonly userOpen = signal(false)
  private readonly alertsMenu = viewChild<ElementRef<HTMLElement>>('alertsMenu')
  private readonly userMenu = viewChild<ElementRef<HTMLElement>>('userMenu')

  private readonly now = signal(new Date())
  protected readonly clock = computed(() => formatClock(this.now()))
  protected readonly date = computed(() => formatDate(this.now()))

  private readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split('?')[0]),
    ),
    { initialValue: this.router.url.split('?')[0] },
  )

  protected readonly online = computed(() => Boolean(this.status.data()?.camera_active))
  protected readonly newCount = computed(() => this.alerts.data()?.new_count ?? 0)
  protected readonly recentAlerts = computed(() => (this.alerts.data()?.alerts ?? []).slice(0, 4))
  protected readonly pageTitle = computed(() => PAGE_TITLES[this.pathname()] ?? 'Guardian AI')
  protected readonly initials = computed(
    () =>
      this.auth
        .user()
        ?.name?.split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() ?? '?',
  )

  constructor() {
    const id = window.setInterval(() => this.now.set(new Date()), 1000)
    const sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.alertsOpen.set(false)
        this.userOpen.set(false)
      })
    inject(DestroyRef).onDestroy(() => {
      window.clearInterval(id)
      sub.unsubscribe()
    })
  }

  /** Close dropdowns on a click outside them (React used a mousedown listener too). */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMouseDown(event: MouseEvent) {
    const target = event.target as Node
    if (this.alertsOpen() && !this.alertsMenu()?.nativeElement.contains(target)) {
      this.alertsOpen.set(false)
    }
    if (this.userOpen() && !this.userMenu()?.nativeElement.contains(target)) {
      this.userOpen.set(false)
    }
  }

  protected signOut() {
    this.auth.logout()
    this.userOpen.set(false)
    void this.router.navigate(['/login'])
  }
}
