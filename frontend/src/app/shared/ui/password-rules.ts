import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { evaluatePasswordRules, passwordStrength } from '../utils/passwordValidation'

@Component({
  selector: 'div[appPasswordRules]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"auth-pw-rules" + (password() ? " has-input" : "")',
    role: 'group',
    'aria-label': 'Password requirements',
  },
  template: `
    <div class="auth-pw-rules-head">
      <div class="auth-pw-strength-meter" aria-hidden="true">
        <svg viewBox="0 0 36 36" class="auth-pw-strength-ring">
          <circle class="auth-pw-strength-track" cx="18" cy="18" r="15.5" />
          <circle
            [attr.class]="'auth-pw-strength-fill tone-' + (strength().tone || 'empty')"
            cx="18"
            cy="18"
            r="15.5"
            [style.stroke-dasharray]="dash()"
          />
        </svg>
        <span class="auth-pw-strength-count">{{ strength().metCount }}/{{ strength().total }}</span>
      </div>
      <div class="auth-pw-rules-copy">
        <p class="auth-pw-rules-title">Password strength</p>
        <p [class]="'auth-pw-rules-status tone-' + (strength().tone || 'empty')">{{ statusText() }}</p>
      </div>
    </div>

    <ul class="auth-pw-rules-list">
      @for (rule of rules(); track rule.id; let index = $index) {
        <li
          [class]="'auth-pw-rule' + (rule.met ? ' is-met' : '')"
          [style.animation-delay.ms]="index * 55"
        >
          <span
            [class]="'auth-pw-rule-icon' + (rule.met ? ' is-met' : '')"
            [style.animation-delay.ms]="rule.met ? index * 40 : null"
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" fill="none" class="auth-pw-rule-svg">
              <circle class="auth-pw-rule-circle" cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.25" />
              <path
                [attr.class]="'auth-pw-rule-check' + (rule.met ? ' is-drawn' : '')"
                d="M5 8.2l2 2 4-4.2"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="auth-pw-rule-label">{{ rule.label }}</span>
          @if (rule.met) {
            <span class="auth-pw-rule-spark" aria-hidden="true"></span>
          } @else {
            <span class="auth-pw-rule-dot" aria-hidden="true"></span>
          }
        </li>
      }
    </ul>
  `,
})
export class PasswordRulesComponent {
  readonly password = input.required<string>()
  protected readonly rules = computed(() => evaluatePasswordRules(this.password()))
  protected readonly strength = computed(() => passwordStrength(this.password()))
  protected readonly dash = computed(() => {
    const s = this.strength()
    const progress = s.total > 0 ? (s.metCount / s.total) * 100 : 0
    return `${(progress / 100) * 97.4} 97.4`
  })
  protected readonly statusText = computed(() => {
    const s = this.strength()
    if (!this.password()) return 'Use a strong unique password'
    if (!s.label) return 'Start typing…'
    return `${s.label} — ${s.metCount === s.total ? 'ready to go' : 'keep going'}`
  })
}

@Component({
  selector: 'p[appPasswordMatch]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"auth-pw-match" + (matches() ? " is-match" : " is-mismatch")',
    role: 'status',
    'aria-live': 'polite',
  },
  template: `
    <span class="auth-pw-match-icon" aria-hidden="true">
      @if (matches()) {
        <svg viewBox="0 0 16 16" fill="none">
          <path class="auth-pw-match-check" d="M4 8.5l2.5 2.5 5.5-5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      } @else {
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      }
    </span>
    {{ matches() ? 'Passwords match' : 'Passwords do not match yet' }}
  `,
})
export class PasswordMatchComponent {
  readonly password = input.required<string>()
  readonly confirm = input.required<string>()
  protected readonly matches = computed(
    () => this.password() === this.confirm() && this.password().length > 0,
  )
}
