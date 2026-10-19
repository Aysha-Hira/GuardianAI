const LEGACY_SESSION_KEY = 'guardian_auth_session'
const PENDING_EMAIL_KEY = 'guardian_pending_email'
const CSRF_COOKIE = 'guardian_csrf'

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function getCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function getPendingEmail() {
  return sessionStorage.getItem(PENDING_EMAIL_KEY)
}

export function setPendingEmail(email: string | null) {
  if (email) sessionStorage.setItem(PENDING_EMAIL_KEY, normalizeEmail(email))
  else sessionStorage.removeItem(PENDING_EMAIL_KEY)
}

export function purgeLegacyTokens() {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY)
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
  }
}

export function clearSession() {
  setPendingEmail(null)
  purgeLegacyTokens()
}
