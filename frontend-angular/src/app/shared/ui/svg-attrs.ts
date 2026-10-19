import { Directive, effect, ElementRef, inject, input } from '@angular/core'

export type SvgAttrs = Record<string, string | number | undefined | null>

/** Sets arbitrary SVG attributes from a record (geometry computed in TypeScript). */
@Directive({ selector: '[appSvgAttrs]' })
export class SvgAttrsDirective {
  readonly appSvgAttrs = input.required<SvgAttrs>()

  constructor() {
    const el = inject<ElementRef<SVGElement>>(ElementRef).nativeElement
    let previous: string[] = []
    effect(() => {
      const attrs = this.appSvgAttrs()
      for (const name of previous) if (!(name in attrs)) el.removeAttribute(name)
      previous = []
      for (const [name, value] of Object.entries(attrs)) {
        if (value == null) {
          el.removeAttribute(name)
        } else {
          el.setAttribute(name, String(value))
          previous.push(name)
        }
      }
    })
  }
}

export interface SvgShape {
  t: 'ellipse' | 'rect' | 'circle' | 'line' | 'path' | 'polygon'
  a: SvgAttrs
}

export interface SvgGroup {
  a: SvgAttrs
  shapes: SvgShape[]
}
