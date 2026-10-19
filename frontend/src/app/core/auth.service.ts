import { computed, Injectable, signal } from '@angular/core'
import { setUnauthorizedHandler } from '../shared/services/api'
import { authApi } from '../shared/services/authApi'
import {
  clearSession,
  getPendingEmail,
  normalizeEmail,
  purgeLegacyTokens,
  setPendingEmail,
} from '../shared/services/authStorage'
import type { AuthUser, LoginInput, MfaChallenge, SignupInput } from '../shared/types/auth'

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null)
  readonly pendingEmail = signal<string | null>(null)
  readonly isAuthenticated = computed(() => Boolean(this.user()?.emailVerified))

  constructor() {
    setUnauthorizedHandler(() => this.endLocalSession())
  }

  async bootstrap(): Promise<void> {
    purgeLegacyTokens()
    this.pendingEmail.set(getPendingEmail())
    try {
      this.user.set(await authApi.me())
    } catch {
      clearSession()
      this.user.set(null)
    }
  }

  private endLocalSession() {
    clearSession()
    this.user.set(null)
    this.pendingEmail.set(null)
  }

  logout() {
    void authApi.logout().catch(() => {})
    this.endLocalSession()
  }

  async login(input: LoginInput): Promise<MfaChallenge | null> {
    const result = await authApi.login({
      email: input.email,
      password: input.password,
      remember: input.remember !== false,
    })
    if (result.mfa) return result.mfa
    setPendingEmail(null)
    this.pendingEmail.set(null)
    this.user.set(result.user)
    return null
  }

  async completeMfaLogin(challenge: MfaChallenge, code: string) {
    const { user } = await authApi.loginMfa({ ticket: challenge.ticket, code, remember: challenge.remember })
    setPendingEmail(null)
    this.pendingEmail.set(null)
    this.user.set(user)
  }

  resendMfaLogin(challenge: MfaChallenge) {
    return authApi.resendLoginMfa(challenge.ticket)
  }

  startMfaSetup() {
    return authApi.mfaSetup()
  }

  async enableMfa(code: string) {
    this.user.set(await authApi.mfaEnable(code))
  }

  async disableMfa(password: string) {
    this.user.set(await authApi.mfaDisable(password))
  }

  async signup(input: SignupInput) {
    const { verificationCode, email } = await authApi.register(input)
    setPendingEmail(email)
    this.pendingEmail.set(normalizeEmail(email))
    return { demoVerificationCode: verificationCode }
  }

  async verifyEmail(email: string, code: string) {
    const { user } = await authApi.verifyEmail({ email, code })
    setPendingEmail(null)
    this.pendingEmail.set(null)
    this.user.set(user)
  }

  async resendVerification(email: string) {
    const { verificationCode } = await authApi.resendVerification(email)
    setPendingEmail(email)
    this.pendingEmail.set(normalizeEmail(email))
    return { demoVerificationCode: verificationCode }
  }

  async forgotPassword(email: string) {
    const { resetPath } = await authApi.forgotPassword(email)
    return { demoResetPath: resetPath }
  }

  async completePasswordReset(token: string, password: string) {
    await authApi.resetPassword({ token, password })
  }

  async updateProfile(name: string) {
    this.user.set(await authApi.updateProfile(name))
  }

  async changePassword(current: string, next: string) {
    await authApi.changePassword(current, next)
  }
}
