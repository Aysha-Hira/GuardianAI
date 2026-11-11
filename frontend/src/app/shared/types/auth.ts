export interface SignupInput {
  name: string
  email: string
  password: string
}

export interface SignupInfo {
  firstAccount: boolean
  signupOpen: boolean
}

export interface Invitation {
  id: string
  email: string
  name: string | null
  role: UserRole
  status: 'pending' | 'expired' | 'accepted'
  invitedBy: string | null
  expiresAt: string | null
  createdAt: string | null
}

export interface InviteResult {
  invitation: Invitation
  emailSent: boolean
  invitePath: string | null
}

export interface InviteLookup {
  email: string
  name: string | null
  role: UserRole
  invitedBy: string | null
}

export interface LoginInput {
  email: string
  password: string
  remember?: boolean
}

export type UserRole = 'admin' | 'operator'

export interface AuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  mfaEnabled: boolean
  role: UserRole
}

export interface TeamMember extends AuthUser {
  createdAt: string | null
}

export interface RoleInfo {
  id: UserRole
  permissions: string[]
}

export interface MfaChallenge {
  ticket: string
  sentTo: string
  devCode: string | null
  remember: boolean
}
