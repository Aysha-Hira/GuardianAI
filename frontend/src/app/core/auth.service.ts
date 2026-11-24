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
import type { AuthUser, LoginInput, SignupInput, TotpChallenge } from '../shared/types/auth'

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null)
  readonly pendingEmail = signal<string | null>(null)
  readonly pendingTotpChallenge = signal<TotpChallenge | null>(null)
  readonly isAuthenticated = computed(() => Boolean(this.user()?.emailVerified && this.user()?.totpEnabled))
  readonly isAdmin = computed(() => this.user()?.role === 'admin')
  readonly roleLabel = computed(() => (this.user()?.role === 'admin' ? 'Administrator' : 'Operator'))

  constructor() {
    setUnauthorizedHandler(() => this.endLocalSession())
  }

  async bootstrap(): Promise<void> {
    purgeLegacyTokens()
    this.pendingEmail.set(getPendingEmail())
    try {
      await this.loadAuthenticatedUser()
    } catch {
      this.endLocalSession()
    }
  }

  private endLocalSession() {
    clearSession()
    this.user.set(null)
    this.pendingEmail.set(null)
    this.pendingTotpChallenge.set(null)
  }

  private setTotpChallenge(challenge: TotpChallenge) {
    clearSession()
    this.user.set(null)
    this.pendingEmail.set(null)
    this.pendingTotpChallenge.set(challenge)
  }

  private async loadAuthenticatedUser(): Promise<AuthUser> {
    const user = await authApi.me()
    if (!user.emailVerified || !user.totpEnabled) {
      throw new Error('Authenticator setup must be completed before accessing Guardian AI.')
    }
    this.user.set(user)
    return user
  }

  logout() {
    void authApi.logout().catch(() => {})
    this.endLocalSession()
  }

  async login(input: LoginInput): Promise<TotpChallenge | null> {
    const result = await authApi.login({
      email: input.email,
      password: input.password,
      remember: input.remember !== false,
    })
    if (result.challenge) {
      this.setTotpChallenge(result.challenge)
      return result.challenge
    }
    this.pendingTotpChallenge.set(null)
    setPendingEmail(null)
    this.pendingEmail.set(null)
    try {
      await this.loadAuthenticatedUser()
    } catch (error) {
      this.endLocalSession()
      throw error
    }
    return null
  }

  loadTotpSetup() {
    const challenge = this.pendingTotpChallenge()
    if (!challenge || challenge.method !== 'totp_setup') {
      throw new Error('There is no Authenticator setup challenge to continue.')
    }
    return authApi.setupTotpLogin(challenge.ticket)
  }

  async completeTotpChallenge(code: string): Promise<AuthUser> {
    const challenge = this.pendingTotpChallenge()
    if (!challenge) throw new Error('The Authenticator challenge is no longer available. Sign in again.')

    let verifiedUser: AuthUser
    if (challenge.method === 'totp_setup') {
      verifiedUser = await authApi.enableTotpLogin({
        ticket: challenge.ticket,
        code,
        remember: challenge.remember,
      })
    } else {
      const result = await authApi.loginTotp({
        ticket: challenge.ticket,
        code,
        remember: challenge.remember,
      })
      verifiedUser = result.user
    }

    this.pendingTotpChallenge.set(null)
    if (!verifiedUser.totpEnabled) {
      this.endLocalSession()
      throw new Error('Authenticator verification did not establish an enabled account. Sign in again.')
    }

    try {
      return await this.loadAuthenticatedUser()
    } catch {
      this.endLocalSession()
      throw new Error('Authenticator was verified, but the session could not be confirmed. Sign in again.')
    }
  }

  clearTotpChallenge() {
    this.pendingTotpChallenge.set(null)
  }

  async acceptInvitation(input: { token: string; name: string; password: string }) {
    const { challenge } = await authApi.acceptInvitation(input)
    this.setTotpChallenge(challenge)
  }

  async signup(input: SignupInput) {
    const { verificationCode, email } = await authApi.register(input)
    setPendingEmail(email)
    this.pendingEmail.set(normalizeEmail(email))
    return { demoVerificationCode: verificationCode }
  }

  async verifyEmail(email: string, code: string) {
    const { challenge } = await authApi.verifyEmail({ email, code })
    this.setTotpChallenge(challenge)
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
