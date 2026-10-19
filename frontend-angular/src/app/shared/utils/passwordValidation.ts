export interface PasswordRule {
  id: string
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export interface PasswordStrength {
  score: number
  label: '' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  tone: '' | 'weak' | 'fair' | 'good' | 'strong'
  metCount: number
  total: number
}

export function evaluatePasswordRules(password: string) {
  return PASSWORD_RULES.map((rule) => ({
    ...rule,
    met: rule.test(password),
  }))
}

export function allPasswordRulesMet(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: '', tone: '', metCount: 0, total: PASSWORD_RULES.length }
  }

  const metCount = PASSWORD_RULES.filter((rule) => rule.test(password)).length
  const labels: PasswordStrength['label'][] = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const tones: PasswordStrength['tone'][] = ['', 'weak', 'fair', 'good', 'strong']

  return {
    score: metCount,
    label: labels[metCount] ?? '',
    tone: tones[metCount] ?? '',
    metCount,
    total: PASSWORD_RULES.length,
  }
}
