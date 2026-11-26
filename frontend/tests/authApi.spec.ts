// Runtime validation coverage for mandatory TOTP authentication contracts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../src/app/shared/services/authApi'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sessionResponse() {
  return {
    ok: true,
    user: {
      id: 'user-1',
      email: 'operator@example.com',
      name: 'Test Operator',
      email_verified: true,
      totp_enabled: true,
      role: 'operator',
    },
  }
}

function assertCsrfRequest(path: string, body: unknown, callIndex = 0) {
  const [url, init] = fetchMock.mock.calls[callIndex]!
  expect(url).toBe(`/api${path}`)
  expect(init?.credentials).toBe('same-origin')
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test')
  expect(JSON.parse(String(init?.body))).toEqual(body)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('document', { cookie: 'guardian_csrf=csrf-test' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mandatory TOTP auth API', () => {
  it.each(['totp', 'totp_setup'] as const)('maps the %s login challenge without authenticating', async (method) => {
    const challenge = { ok: true, mfa_required: true as const, method, ticket: 'ticket-1234567890123456' }
    fetchMock.mockResolvedValueOnce(jsonResponse(challenge))

    const result = await authApi.login({
      email: 'operator@example.com',
      password: 'password',
      remember: false,
    })

    expect(result).toEqual({
      challenge: { ticket: challenge.ticket, method, remember: false },
    })
    expect('user' in result).toBe(false)
    assertCsrfRequest('/auth/login', {
      email: 'operator@example.com',
      password: 'password',
      remember: false,
    })
  })

  it('returns only the setup QR image, not its provisioning URI', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      otpauth_uri: 'otpauth://totp/Guardian%20AI:user?secret=PRIVATE',
      qr_png_base64: 'cWItcG5n',
    }))

    const setup = await authApi.setupTotpLogin('ticket-1234567890123456')

    expect(setup).toEqual({ qrPngBase64: 'cWItcG5n' })
    expect('otpauthUri' in setup).toBe(false)
    assertCsrfRequest('/auth/login/totp/setup', { ticket: 'ticket-1234567890123456' })
  })

  it('posts login verification and setup confirmation to their matching endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(sessionResponse()))
      .mockResolvedValueOnce(jsonResponse(sessionResponse()))

    const login = await authApi.loginTotp({
      ticket: 'ticket-1234567890123456',
      code: '123456',
      remember: true,
    })
    expect(login.user.totpEnabled).toBe(true)
    assertCsrfRequest('/auth/login/totp', {
      ticket: 'ticket-1234567890123456',
      code: '123456',
      remember: true,
    })

    const setup = await authApi.enableTotpLogin({
      ticket: 'ticket-1234567890123456',
      code: '654321',
      remember: false,
    })
    expect(setup.totpEnabled).toBe(true)
    assertCsrfRequest('/auth/login/totp/enable', {
      ticket: 'ticket-1234567890123456',
      code: '654321',
      remember: false,
    }, 1)
  })

  it('routes email verification and invitation acceptance into setup challenges', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        mfa_required: true,
        method: 'totp_setup',
        ticket: 'ticket-1234567890123456',
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        mfa_required: true,
        method: 'totp_setup',
        ticket: 'ticket-abcdefghijklmnop',
      }))

    const verification = await authApi.verifyEmail({ email: 'operator@example.com', code: '123456' })
    expect(verification.challenge.method).toBe('totp_setup')
    assertCsrfRequest('/auth/verify-email', { email: 'operator@example.com', code: '123456' })

    const invitation = await authApi.acceptInvitation({
      token: 'invitation-token-123456',
      name: 'Test Operator',
      password: 'password',
    })
    expect(invitation.challenge.method).toBe('totp_setup')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/invitations/accept')
  })

  it('maps persisted TOTP status from /auth/me without exposing extra fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...sessionResponse().user,
      totp_secret: 'PRIVATE',
      otpauth_uri: 'otpauth://private',
    }))

    const user = await authApi.me()

    expect(user.totpEnabled).toBe(true)
    expect(user).not.toHaveProperty('totp_secret')
    expect(user).not.toHaveProperty('otpauth_uri')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me')
  })

  it('preserves backend status and detail for invalid TOTP codes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Invalid code.' }, 401))

    await expect(
      authApi.loginTotp({
        ticket: 'ticket-1234567890123456',
        code: '000000',
        remember: true,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid code.' })
  })
})
