import { DestroyRef, Directive, ElementRef, inject } from '@angular/core'
import { NavigationEnd, Router } from '@angular/router'

@Directive({ selector: '[appPageTransition]', host: { class: 'page-transition' } })
export class PageTransitionDirective {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
    const router = inject(Router)
    let lastPath: string | null = null
    const sub = router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return
      const path = event.urlAfterRedirects.split('?')[0]
      if (lastPath === null || path === lastPath) {
        lastPath = path
        return
      }
      lastPath = path
      const main = document.querySelector('main')
      if (main) main.scrollTo({ top: 0, behavior: 'auto' })
      else window.scrollTo(0, 0)
      for (const animation of el.getAnimations()) {
        animation.cancel()
        animation.play()
      }
    })
    inject(DestroyRef).onDestroy(() => sub.unsubscribe())
  }
}
