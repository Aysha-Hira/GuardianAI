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
  /** Two-step sign-in with an emailed code. */
  mfaEnabled: boolean
}

/** Password accepted; an emailed code is still needed to finish signing in. */
export interface MfaChallenge {
  ticket: string
  sentTo: string
  devCode: string | null
  remember: boolean
}
