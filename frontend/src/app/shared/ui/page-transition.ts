import { DestroyRef, Directive, ElementRef, inject } from '@angular/core'
import { NavigationEnd, Router } from '@angular/router'

/**
 * Port of React's PageTransition: on every *later* path change scroll <main> to the top and
 * replay the .page-transition fade-in (React did this by re-keying the div).
 *
 * The first navigation is skipped (the CSS animation already plays on first render), and the
 * replay uses the Web Animations API instead of removing/re-adding the class — toggling the class
 * forced a re-layout mid-paint, which Chrome sometimes left blank for the backdrop-blurred cards.
 */
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
