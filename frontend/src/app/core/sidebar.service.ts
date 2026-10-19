import { effect, Injectable, signal } from '@angular/core'

const STORAGE_KEY = 'guardian_sidebar_collapsed'

@Injectable({ providedIn: 'root' })
export class SidebarService {
  readonly collapsed = signal<boolean>(readCollapsed())
  readonly mobileOpen = signal(false)

  constructor() {
    effect(() => {
      const value = String(this.collapsed())
      try {
        localStorage.setItem(STORAGE_KEY, value)
      } catch {
      }
    })
  }

  toggleCollapsed() {
    this.collapsed.update((v) => !v)
  }

  setMobileOpen(open: boolean) {
    this.mobileOpen.set(open)
  }

  closeMobile() {
    this.mobileOpen.set(false)
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}
