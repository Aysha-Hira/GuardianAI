import { inject } from '@angular/core'
import { type CanActivateFn, RedirectCommand, Router } from '@angular/router'
import { AuthService } from './auth.service'

/** Port of React's ProtectedRoute. */
export const protectedGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService)
  const router = inject(Router)
  if (auth.isAuthenticated()) return true

  const pending = auth.pendingEmail()
  const target = pending
    ? router.createUrlTree(['/verify-email'], { queryParams: { email: pending } })
    : router.parseUrl('/login')
  return new RedirectCommand(target, { replaceUrl: true, state: { from: state.url } })
}

/** Port of React's GuestRoute (login, signup, forgot/reset password). */
export const guestGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService)
  const router = inject(Router)

  if (auth.isAuthenticated()) {
    const from = (router.getCurrentNavigation()?.extras.state?.['from'] as string | undefined) ?? '/'
    return new RedirectCommand(router.parseUrl(from), { replaceUrl: true })
  }

  const path = state.url.split('?')[0]
  const pending = auth.pendingEmail()
  if (
    pending &&
    !path.startsWith('/verify-email') &&
    path !== '/reset-password' &&
    path !== '/login'
  ) {
    return new RedirectCommand(
      router.createUrlTree(['/verify-email'], { queryParams: { email: pending } }),
      { replaceUrl: true },
    )
  }
  return true
}

/** Port of React's VerifyEmailRoute. */
export const verifyEmailGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService)
  const router = inject(Router)
  if (auth.isAuthenticated()) return new RedirectCommand(router.parseUrl('/'), { replaceUrl: true })
  if (!auth.pendingEmail() && !route.queryParamMap.get('email')) {
    return new RedirectCommand(router.parseUrl('/login'), { replaceUrl: true })
  }
  return true
}
