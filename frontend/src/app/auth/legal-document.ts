import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core'
import { RouterLink } from '@angular/router'

export interface LegalSection {
  title: string
  paragraphs: string[]
}

export interface LegalDoc {
  kind: 'terms' | 'privacy'
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
  contact: { label: string; email: string }
}

@Component({
  selector: 'app-legal-document',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="legal-page">
      <header class="legal-bar">
        <div class="legal-bar-inner">
          <a class="legal-brand" routerLink="/login" aria-label="Guardian AI — sign in">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L4 5.5V11.5C4 16.5 7.5 20.5 12 22C16.5 20.5 20 16.5 20 11.5V5.5L12 2Z"
                stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <path d="M8.5 12l2.4 2.4L15.5 9.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>Guardian AI</span>
          </a>
          <nav class="legal-switch" aria-label="Legal documents">
            <a routerLink="/terms" [class.is-current]="doc().kind === 'terms'"
              [attr.aria-current]="doc().kind === 'terms' ? 'page' : null">Terms</a>
            <a routerLink="/privacy" [class.is-current]="doc().kind === 'privacy'"
              [attr.aria-current]="doc().kind === 'privacy' ? 'page' : null">Privacy</a>
          </nav>
          <a class="legal-signin" routerLink="/login">Sign in</a>
        </div>
      </header>

      <section class="legal-hero">
        <div class="legal-hero-inner">
          <h1 class="legal-title">{{ doc().title }}</h1>
          <p class="legal-updated">Last updated {{ doc().updated }}</p>
          <p class="legal-intro">{{ doc().intro }}</p>
        </div>
      </section>

      <div class="legal-layout">
        <nav class="legal-toc" aria-label="Contents">
          <p class="legal-toc-title">Contents</p>
          <ol>
            @for (s of sections(); track s.id) {
              <li>
                <a [href]="'#' + s.id" [class.is-active]="active() === s.id" (click)="jump($event, s.id)">
                  <span class="legal-toc-num">{{ s.num }}</span><span>{{ s.heading }}</span>
                </a>
              </li>
            }
          </ol>
        </nav>

        <article class="legal-doc">
          @for (s of sections(); track s.id) {
            <section class="legal-clause" [id]="s.id" [class.is-active]="active() === s.id" [attr.aria-labelledby]="s.id + '-h'">
              <div class="legal-numeral" aria-hidden="true">{{ s.num }}</div>
              <div>
                <h2 [id]="s.id + '-h'">{{ s.heading }}</h2>
                @for (p of s.paragraphs; track $index) {
                  <p>{{ p }}</p>
                }
              </div>
            </section>
          }

          <footer class="legal-foot">
            <p>
              <strong>{{ doc().contact.label }}</strong>
              Email <a [href]="'mailto:' + doc().contact.email">{{ doc().contact.email }}</a>
            </p>
            @if (doc().kind === 'terms') {
              <a class="legal-foot-link" routerLink="/privacy">Read the Privacy Policy</a>
            } @else {
              <a class="legal-foot-link" routerLink="/terms">Read the Terms &amp; Conditions</a>
            }
          </footer>
        </article>
      </div>
    </div>
  `,
})
export class LegalDocumentComponent {
  readonly doc = input.required<LegalDoc>()
  readonly active = signal<string | null>(null)
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)

  readonly sections = computed(() =>
    this.doc().sections.map((s, i) => {
      const m = /^(\d+)\.\s*(.*)$/.exec(s.title)
      const num = m ? m[1] : String(i + 1)
      return { id: `${this.doc().kind}-${num}`, num, heading: m ? m[2] : s.title, paragraphs: s.paragraphs }
    }),
  )

  constructor() {
    const destroyRef = inject(DestroyRef)
    afterNextRender(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting)
          if (visible.length) {
            visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
            this.active.set((visible[0].target as HTMLElement).id)
          }
        },
        { rootMargin: '-20% 0px -60% 0px' },
      )
      this.host.nativeElement.querySelectorAll('.legal-clause').forEach((el) => observer.observe(el))
      destroyRef.onDestroy(() => observer.disconnect())
    })
  }

  jump(event: Event, id: string): void {
    event.preventDefault()
    const target = document.getElementById(id)
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
    this.active.set(id)
  }
}
