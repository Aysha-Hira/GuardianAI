import type { AuthUser, MfaChallenge } from '../types/auth'
import { getCsrfToken } from './authStorage'

const API_BASE = '/api'

export class AuthApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

function parseDetail(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return 'Request failed'
  }
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && item !== null && 'msg' in item) {
          return String((item as { msg: unknown }).msg)
        }
        return 'Validation error'
      })
      .join('; ')
  }
  return 'Request failed'
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const csrf = getCsrfToken()
  if (csrf) headers.set('X-CSRF-Token', csrf)
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new AuthApiError('Unable to connect to Guardian AI services.', 0)
  }

  if (!response.ok) {
    let message = response.statusText
    try {
      message = parseDetail(await response.json())
    } catch {
    }
    throw new AuthApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

interface UserResponse {
  id: string
  email: string
  name: string
  email_verified: boolean
  mfa_enabled?: boolean
}

interface SessionResponse {
  ok: boolean
  user: UserResponse
}

interface RegisterResponse {
  ok: boolean
  message: string
  email: string
  name: string
  verification_code?: string | null
}

function mapUser(user: UserResponse): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.email_verified,
    mfaEnabled: Boolean(user.mfa_enabled),
  }
}

export const authApi = {
  register: async (input: { name: string; email: string; password: string }) => {
    const data = await authRequest<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return {
      email: data.email,
      name: data.name,
      verificationCode: data.verification_code ?? null,
    }
  },

  login: async (
    input: { email: string; password: string; remember?: boolean },
  ): Promise<{ user: AuthUser; mfa?: undefined } | { user?: undefined; mfa: MfaChallenge }> => {
    const data = await authRequest<
      SessionResponse | { ok: boolean; mfa_required: true; ticket: string; sent_to: string; dev_code?: string }
    >('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if ('mfa_required' in data && data.mfa_required) {
      return {
        mfa: { ticket: data.ticket, sentTo: data.sent_to, devCode: data.dev_code ?? null, remember: input.remember !== false },
      }
    }
    return { user: mapUser((data as SessionResponse).user) }
  },

  loginMfa: async (input: { ticket: string; code: string; remember: boolean }) => {
    const data = await authRequest<SessionResponse>('/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return { user: mapUser(data.user) }
  },

  resendLoginMfa: async (ticket: string) => {
    const data = await authRequest<{ ok: boolean; dev_code?: string }>('/auth/login/mfa/resend', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    })
    return { devCode: data.dev_code ?? null }
  },

  mfaSetup: async () => {
    const data = await authRequest<{ ok: boolean; sent_to: string; dev_code?: string }>('/auth/mfa/setup', { method: 'POST' })
    return { sentTo: data.sent_to, devCode: data.dev_code ?? null }
  },

  mfaEnable: async (code: string) => {
    const data = await authRequest<SessionResponse>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) })
    return mapUser(data.user)
  },

  mfaDisable: async (password: string) => {
    const data = await authRequest<SessionResponse>('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password }) })
    return mapUser(data.user)
  },

  verifyEmail: async (input: { email: string; code: string }) => {
    const data = await authRequest<SessionResponse>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return { user: mapUser(data.user) }
  },

  logout: async () => {
    await authRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' })
  },

  resendVerification: async (email: string) => {
    const data = await authRequest<{ ok: boolean; verification_code?: string }>(
      '/auth/resend-verification',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    )
    return { verificationCode: data.verification_code ?? null }
  },

  forgotPassword: async (email: string) => {
    const data = await authRequest<{ ok: boolean; reset_path?: string | null }>(
      '/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    )
    return { resetPath: data.reset_path ?? null }
  },

  resetPassword: async (input: { token: string; password: string }) => {
    await authRequest<{ ok: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  me: async () => {
    const data = await authRequest<UserResponse>('/auth/me', { method: 'GET' })
    return mapUser(data)
  },

  updateProfile: async (name: string) => {
    const data = await authRequest<UserResponse>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    return mapUser(data)
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    await authRequest<{ ok: boolean; message: string }>(
      '/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      },
    )
  },
}
