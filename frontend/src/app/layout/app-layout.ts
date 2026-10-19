import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core'
import { Router, RouterOutlet } from '@angular/router'
import { AuthService } from '../core/auth.service'
import { PageTransitionDirective } from '../shared/ui/page-transition'
import { HeaderComponent } from './header'
import { SidebarComponent } from './sidebar'

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, SidebarComponent, HeaderComponent, PageTransitionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="flex h-full min-h-screen">
      <app-sidebar />
      <div class="flex min-w-0 flex-1 flex-col">
        <app-header />
        <main class="flex-1 overflow-auto">
          <div class="mx-auto max-w-[1600px] p-6 lg:p-8">
            <div appPageTransition><router-outlet /></div>
          </div>
        </main>
      </div>
    </div>
  `,
})
export class AppLayoutComponent {
  constructor() {
    const auth = inject(AuthService)
    const router = inject(Router)
    effect(() => {
      if (!auth.isAuthenticated()) void router.navigate(['/login'], { replaceUrl: true })
    })
  }
}
