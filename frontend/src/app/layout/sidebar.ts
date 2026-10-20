import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router, RouterLink } from '@angular/router'
import { filter, map } from 'rxjs'
import { AuthService } from '../core/auth.service'
import { createPoll, POLL_KEYS } from '../core/polling'
import { SidebarService } from '../core/sidebar.service'
import { api } from '../shared/services/api'
import { IconComponent, type IconName } from '../shared/ui/icon'

interface NavItemDef {
  to: string
  label: string
  end?: boolean
  icon: IconName
  badge?: number
}

interface NavGroup {
  label: string
  items: NavItemDef[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
      { to: '/monitoring', label: 'Monitoring', icon: 'monitoring' },
      { to: '/incidents', label: 'Incidents', icon: 'incidents' },
      { to: '/cameras', label: 'Cameras', icon: 'cameras' },
      { to: '/cctv-map', label: 'CCTV Map', icon: 'map' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/face-recognition', label: 'Face Recognition', icon: 'face-recognition' },
      { to: '/multicam-reid', label: 'Multi-Cam Re-ID', icon: 'multicam' },
      { to: '/analytics', label: 'Analytics', icon: 'analytics' },
      { to: '/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/subscription', label: 'Subscription', icon: 'subscription' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (sidebar.mobileOpen()) {
      <button
        type="button"
        class="sidebar-backdrop lg:hidden"
        aria-label="Close navigation menu"
        (click)="sidebar.closeMobile()"
      ></button>
    }

    <aside
      [class]="
        'sidebar-shell ' +
        (collapsed() ? 'is-collapsed' : '') +
        ' ' +
        (sidebar.mobileOpen() ? 'sidebar-mobile-open' : 'sidebar-mobile-closed')
      "
    >
      <div class="sidebar-brand">
        <svg appIcon="shield" class="sidebar-brand-icon" aria-hidden="true"></svg>
        @if (!collapsed()) {
          <div class="min-w-0">
            <p class="sidebar-brand-title">Guardian AI</p>
            <p class="sidebar-brand-sub">Security Operations</p>
          </div>
        }
      </div>

      <nav class="sidebar-nav" aria-label="Main">
        @for (group of navGroups(); track group.label) {
          <div class="sidebar-nav-group">
            @if (!collapsed()) {
              <p class="sidebar-nav-group-label">{{ group.label }}</p>
            }
            <div class="sidebar-nav-group-items">
              @for (item of group.items; track item.to) {
                <a
                  [routerLink]="item.to"
                  [attr.title]="collapsed() ? item.label : null"
                  (click)="sidebar.closeMobile()"
                  [class]="
                    'sidebar-nav-item ' +
                    (isActive(item) ? 'active' : '') +
                    ' ' +
                    (collapsed() ? 'collapsed' : '')
                  "
                  [attr.aria-current]="isActive(item) ? 'page' : null"
                >
                  <svg [appIcon]="item.icon" class="sidebar-nav-icon" aria-hidden="true"></svg>
                  @if (!collapsed()) {
                    <span class="truncate">{{ item.label }}</span>
                  }
                  @if (item.badge != null && item.badge > 0) {
                    <span class="sidebar-nav-badge" [attr.aria-label]="item.badge + ' new incidents'">
                      {{ item.badge > 99 ? '99+' : item.badge }}
                    </span>
                  }
                  @if (collapsed()) {
                    <span class="sidebar-tooltip" role="tooltip">{{ item.label }}</span>
                  }
                </a>
              }
            </div>
          </div>
        }
      </nav>

      <div class="sidebar-footer">
        @if (auth.user(); as user) {
          <div
            [class]="'sidebar-user ' + (collapsed() ? 'collapsed' : '')"
            [attr.title]="collapsed() ? user.name + ' (' + user.email + ')' : null"
          >
            <span class="sidebar-user-avatar">{{ initials() }}</span>
            @if (!collapsed()) {
              <div class="min-w-0">
                <p class="sidebar-user-name">{{ user.name }}</p>
                <p class="sidebar-user-email">{{ user.email }}</p>
              </div>
            }
          </div>
        }

        <div [class]="'sidebar-footer-meta ' + (collapsed() ? 'collapsed' : '')">
          @if (!collapsed()) {
            <span class="sidebar-version">Platform v1.0.0</span>
          }
          <button
            type="button"
            (click)="sidebar.toggleCollapsed()"
            class="sidebar-collapse-btn"
            [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
            [attr.title]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
          >
            @if (collapsed()) {
              <svg appIcon="chevron-right" class="h-4 w-4"></svg>
            } @else {
              <svg appIcon="chevron-left" class="h-4 w-4"></svg>
              <span>Collapse</span>
            }
          </button>
        </div>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService)
  protected readonly sidebar = inject(SidebarService)
  private readonly router = inject(Router)

  protected readonly collapsed = this.sidebar.collapsed
  private readonly alerts = createPoll(() => api.getAlerts(), 5000, POLL_KEYS.alerts)

  private readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split('?')[0]),
    ),
    { initialValue: this.router.url.split('?')[0] },
  )

  protected readonly navGroups = computed<NavGroup[]>(() => {
    const newIncidents = this.alerts.data()?.new_count ?? 0
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.to === '/incidents' ? { ...item, badge: newIncidents } : item,
      ),
    }))
  })

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

  protected isActive(item: NavItemDef): boolean {
    const path = this.pathname()
    return item.end ? path === item.to : path.startsWith(item.to)
  }
}
