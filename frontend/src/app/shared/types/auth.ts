export interface SignupInput {
  name: string
  email: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
  remember?: boolean
}

export interface AuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  mfaEnabled: boolean
}

export interface MfaChallenge {
  ticket: string
  sentTo: string
  devCode: string | null
  remember: boolean
}
