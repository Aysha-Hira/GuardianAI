import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'

export type IconName =
  | 'dashboard' | 'monitoring' | 'incidents' | 'cameras' | 'map'
  | 'face-recognition' | 'multicam' | 'analytics' | 'reports'
  | 'subscription' | 'settings' | 'shield' | 'bell' | 'menu'
  | 'chevron-left' | 'chevron-right'
  | 'activity' | 'users' | 'alert-triangle' | 'search' | 'video'
  | 'camera' | 'cctv' | 'check-circle'

/** Icons drawn with fill instead of stroke (React: fill="currentColor", no stroke). */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['camera', 'cctv'])

/**
 * Same SVGs as React's components/common/Icons.tsx.
 * Usage: <svg appIcon="dashboard" class="h-4 w-4" aria-hidden="true"></svg>
 * (attribute selector → the DOM is a plain <svg>, exactly like React's).
 */
@Component({
  selector: 'svg[appIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.viewBox]': '"0 0 24 24"',
    '[attr.fill]': 'filled() ? "currentColor" : "none"',
    '[attr.stroke]': 'filled() ? null : "currentColor"',
    '[attr.stroke-width]': 'filled() ? null : strokeWidth()',
  },
  template: `
    @switch (appIcon()) {
      @case ('dashboard') {
        <svg:rect x="3" y="3" width="7" height="9" rx="1"></svg:rect>
        <svg:rect x="14" y="3" width="7" height="5" rx="1"></svg:rect>
        <svg:rect x="14" y="12" width="7" height="9" rx="1"></svg:rect>
        <svg:rect x="3" y="16" width="7" height="5" rx="1"></svg:rect>
      }
      @case ('monitoring') {
        <svg:path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"></svg:path>
      }
      @case ('incidents') {
        <svg:path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></svg:path>
        <svg:line x1="12" y1="9" x2="12" y2="13"></svg:line>
        <svg:line x1="12" y1="17" x2="12.01" y2="17"></svg:line>
      }
      @case ('cameras') {
        <svg:path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"></svg:path>
        <svg:circle cx="12" cy="13" r="4"></svg:circle>
      }
      @case ('map') {
        <svg:polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></svg:polygon>
        <svg:line x1="8" y1="2" x2="8" y2="18"></svg:line>
        <svg:line x1="16" y1="6" x2="16" y2="22"></svg:line>
      }
      @case ('face-recognition') {
        <svg:rect x="3" y="3" width="18" height="18" rx="3"></svg:rect>
        <svg:circle cx="12" cy="10" r="3"></svg:circle>
        <svg:path d="M7 19c1.5-2.5 3.5-4 5-4s3.5 1.5 5 4"></svg:path>
        <svg:path d="M3 12h2M19 12h2" stroke-dasharray="2 2"></svg:path>
      }
      @case ('multicam') {
        <svg:rect x="2" y="5" width="8" height="10" rx="1"></svg:rect>
        <svg:rect x="14" y="5" width="8" height="10" rx="1"></svg:rect>
        <svg:path d="M10 10h4" stroke-dasharray="2 2"></svg:path>
        <svg:circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"></svg:circle>
      }
      @case ('analytics') {
        <svg:path d="M3 3v18h18"></svg:path>
        <svg:path d="M7 16l4-6 4 3 5-8"></svg:path>
      }
      @case ('reports') {
        <svg:path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></svg:path>
        <svg:path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"></svg:path>
      }
      @case ('subscription') {
        <svg:rect x="2" y="5" width="20" height="14" rx="2"></svg:rect>
        <svg:line x1="2" y1="10" x2="22" y2="10"></svg:line>
        <svg:line x1="6" y1="15" x2="10" y2="15"></svg:line>
      }
      @case ('settings') {
        <svg:circle cx="12" cy="12" r="3"></svg:circle>
        <svg:path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></svg:path>
      }
      @case ('shield') {
        <svg:path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></svg:path>
      }
      @case ('bell') {
        <svg:path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"></svg:path>
        <svg:path d="M13.73 21a2 2 0 01-3.46 0"></svg:path>
      }
      @case ('menu') {
        <svg:line x1="3" y1="6" x2="21" y2="6"></svg:line>
        <svg:line x1="3" y1="12" x2="21" y2="12"></svg:line>
        <svg:line x1="3" y1="18" x2="21" y2="18"></svg:line>
      }
      @case ('chevron-left') {
        <svg:polyline points="15 18 9 12 15 6"></svg:polyline>
      }
      @case ('chevron-right') {
        <svg:polyline points="9 18 15 12 9 6"></svg:polyline>
      }
      @case ('activity') {
        <svg:polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></svg:polyline>
      }
      @case ('users') {
        <svg:path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></svg:path>
        <svg:circle cx="9" cy="7" r="4"></svg:circle>
        <svg:path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"></svg:path>
      }
      @case ('alert-triangle') {
        <svg:path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></svg:path>
        <svg:line x1="12" y1="9" x2="12" y2="13"></svg:line>
        <svg:line x1="12" y1="17" x2="12.01" y2="17"></svg:line>
      }
      @case ('search') {
        <svg:circle cx="11" cy="11" r="8"></svg:circle>
        <svg:path d="M21 21l-4.35-4.35"></svg:path>
      }
      @case ('video') {
        <svg:polygon points="23 7 16 12 23 17 23 7"></svg:polygon>
        <svg:rect x="1" y="5" width="15" height="14" rx="2"></svg:rect>
      }
      @case ('camera') {
        <svg:path d="M12 15a3 3 0 100-6 3 3 0 000 6z"></svg:path>
        <svg:path fill-rule="evenodd" clip-rule="evenodd" d="M9 4L7.17 6H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-3.17L15 4H9zm3 14a5 5 0 100-10 5 5 0 000 10z"></svg:path>
      }
      @case ('cctv') {
        <svg:rect x="3" y="5" width="2.5" height="14" rx="0.6"></svg:rect>
        <svg:rect x="5.5" y="11" width="5.5" height="2.2" rx="0.5"></svg:rect>
        <svg:rect x="10.5" y="9.5" width="8.5" height="5" rx="1.2"></svg:rect>
        <svg:circle cx="19.5" cy="12" r="2.1"></svg:circle>
        <svg:circle cx="19.5" cy="12" r="0.95" opacity="0.45"></svg:circle>
      }
      @case ('check-circle') {
        <svg:circle cx="12" cy="12" r="10"></svg:circle>
        <svg:path d="M9 12l2 2 4-4"></svg:path>
      }
    }
  `,
})
export class IconComponent {
  readonly appIcon = input.required<IconName>()
  protected readonly filled = computed(() => FILLED.has(this.appIcon()))
  protected readonly strokeWidth = computed(() =>
    this.appIcon() === 'chevron-left' || this.appIcon() === 'chevron-right' ? 2 : 1.75,
  )
}
