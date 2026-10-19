import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { routes } from './app.routes'
import { AuthService } from './core/auth.service'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    // Ask the backend who is logged in (via the HttpOnly cookie) before the first route renders.
    // The loader inside <app-root> in index.html is shown meanwhile, like React's LoadingState.
    provideAppInitializer(() => inject(AuthService).bootstrap()),
  ],
}
