import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { AuthService } from '../core/auth.service'
import { authApi } from '../shared/services/authApi'
import type { Invitation, TeamMember, UserRole } from '../shared/types/auth'
import { PageHeaderComponent } from '../shared/ui/common'

const ROLE_TITLES: Record<UserRole, string> = {
  admin: 'Administrator',
  operator: 'Operator',
}

@Component({
  selector: 'app-team',
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="space-y-6">
      <div appPageHeader eyebrow="System" heading="Team & Roles"
        description="Invite people to your security team and choose their role.">
        <div class="shrink-0 pt-1">
          <span class="rounded-full border border-guardian-border bg-guardian-panel px-3 py-1.5 font-mono text-xs text-guardian-muted">
            {{ adminCount() }} admin · {{ operatorCount() }} operator
          </span>
        </div>
      </div>

      <div class="team-grid">
        <div class="team-role-card">
          <p class="team-card-title">Invite by email</p>
          <p class="role-note">They get an email with a link to set their name and password. The link works for 7 days.</p>
          <form class="team-invite-form" (submit)="sendInvite($event)">
            <input type="email" placeholder="name@company.com" [value]="inviteEmail()" (input)="inviteEmail.set($any($event.target).value)" required />
            <input type="text" placeholder="Name (optional)" [value]="inviteName()" (input)="inviteName.set($any($event.target).value)" />
            <select [value]="inviteRole()" (change)="inviteRole.set($any($event.target).value)" aria-label="Role for the invited person">
              <option value="operator">Operator</option>
              <option value="admin">Administrator</option>
            </select>
            <div class="team-invite-actions">
              <button type="submit" class="btn-primary team-invite-btn" [disabled]="inviting()">{{ inviting() ? 'Sending…' : 'Send invite' }}</button>
            </div>
          </form>
          @if (inviteLink(); as link) {
            <p class="role-note team-link">Email could not be sent. Share this link: <span class="font-mono">{{ link }}</span></p>
          }
        </div>

      </div>

      @if (invitations().length > 0) {
        <section class="panel">
          <div class="panel-header">
            <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">Pending invitations</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="team-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Status</th><th>Invited by</th><th>Expires</th><th></th></tr>
              </thead>
              <tbody>
                @for (inv of invitations(); track inv.id) {
                  <tr>
                    <td>{{ inv.email }}@if (inv.name) {<span class="role-note"> · {{ inv.name }}</span>}</td>
                    <td><span [class]="'role-chip ' + (inv.role === 'admin' ? 'role-chip-admin' : 'role-chip-operator')">{{ title(inv.role) }}</span></td>
                    <td class="text-guardian-muted">{{ inv.status === 'expired' ? 'Expired' : 'Waiting' }}</td>
                    <td class="text-guardian-muted">{{ inv.invitedBy || '—' }}</td>
                    <td class="text-guardian-muted">{{ joined(inv.expiresAt) }}</td>
                    <td class="team-actions">
                      <button type="button" class="btn-ghost text-xs" (click)="resendInvite(inv)">Resend</button>
                      <button type="button" class="btn-ghost text-xs text-guardian-danger" (click)="revokeInvite(inv)">Cancel</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="panel">
        <div class="panel-header">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-guardian-muted">Team members</h3>
          @if (message(); as msg) {
            <span [class]="'text-xs ' + (error() ? 'text-guardian-danger' : 'text-guardian-accent')">{{ msg }}</span>
          }
        </div>
        @if (loading()) {
          <p class="p-5 text-sm text-guardian-muted">Loading team…</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="team-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Two-step sign-in</th>
                  <th>Joined</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                @for (member of members(); track member.id) {
                  <tr>
                    <td>
                      {{ member.name }}
                      @if (member.id === auth.user()?.id) {
                        <span class="role-note"> (you)</span>
                      }
                    </td>
                    <td class="text-guardian-muted">{{ member.email }}</td>
                    <td class="text-guardian-muted">{{ member.mfaEnabled ? 'On' : 'Off' }}</td>
                    <td class="text-guardian-muted">{{ joined(member.createdAt) }}</td>
                    <td>
                      <select
                        [value]="member.role"
                        [disabled]="member.id === auth.user()?.id || savingId() === member.id"
                        (change)="changeRole(member, $any($event.target).value)"
                        [attr.aria-label]="'Role for ' + member.name"
                      >
                        <option value="operator">Operator</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="text-guardian-muted">No team members yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class TeamPage {
  protected readonly auth = inject(AuthService)
  protected readonly members = signal<TeamMember[]>([])
  protected readonly loading = signal(true)
  protected readonly savingId = signal<string | null>(null)
  protected readonly message = signal<string | null>(null)
  protected readonly error = signal(false)
  protected readonly invitations = signal<Invitation[]>([])
  protected readonly inviteEmail = signal('')
  protected readonly inviteName = signal('')
  protected readonly inviteRole = signal<UserRole>('operator')
  protected readonly inviting = signal(false)
  protected readonly inviteLink = signal<string | null>(null)

  protected readonly adminCount = computed(() => this.members().filter((m) => m.role === 'admin').length)
  protected readonly operatorCount = computed(() => this.members().filter((m) => m.role !== 'admin').length)

  constructor() {
    void this.load()
  }

  protected title(role: UserRole) {
    return ROLE_TITLES[role]
  }

  protected joined(value: string | null) {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  private flash(text: string, isError = false) {
    this.message.set(text)
    this.error.set(isError)
    window.setTimeout(() => this.message.set(null), 3500)
  }

  private async load() {
    this.loading.set(true)
    try {
      const [members, invitations] = await Promise.all([authApi.listUsers(), authApi.listInvitations()])
      this.members.set(members)
      this.invitations.set(invitations)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not load the team.', true)
    } finally {
      this.loading.set(false)
    }
  }

  protected async changeRole(member: TeamMember, role: UserRole) {
    if (role === member.role) return
    this.savingId.set(member.id)
    try {
      const updated = await authApi.updateUserRole(member.id, role)
      this.members.update((list) => list.map((m) => (m.id === updated.id ? updated : m)))
      this.flash(`${updated.name} is now ${ROLE_TITLES[updated.role].toLowerCase()}.`)
    } catch (err) {
      this.members.update((list) => [...list])
      this.flash(err instanceof Error ? err.message : 'Role update failed.', true)
    } finally {
      this.savingId.set(null)
    }
  }

  private absoluteLink(path: string | null) {
    return path ? `${window.location.origin}${path}` : null
  }

  protected async sendInvite(event: Event) {
    event.preventDefault()
    this.inviting.set(true)
    this.inviteLink.set(null)
    try {
      const result = await authApi.createInvitation({ email: this.inviteEmail(), name: this.inviteName(), role: this.inviteRole() })
      this.invitations.update((list) => [result.invitation, ...list.filter((i) => i.email !== result.invitation.email)])
      this.flash(result.emailSent ? `Invitation sent to ${result.invitation.email}.` : `Invitation created for ${result.invitation.email}.`)
      if (!result.emailSent) this.inviteLink.set(this.absoluteLink(result.invitePath))
      this.inviteEmail.set('')
      this.inviteName.set('')
      this.inviteRole.set('operator')
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not send the invitation.', true)
    } finally {
      this.inviting.set(false)
    }
  }

  protected async resendInvite(inv: Invitation) {
    try {
      const result = await authApi.resendInvitation(inv.id)
      this.invitations.update((list) => list.map((i) => (i.id === inv.id ? result.invitation : i)))
      this.inviteLink.set(result.emailSent ? null : this.absoluteLink(result.invitePath))
      this.flash(result.emailSent ? `Invitation re-sent to ${inv.email}.` : `New link created for ${inv.email}.`)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not resend the invitation.', true)
    }
  }

  protected async revokeInvite(inv: Invitation) {
    if (!window.confirm(`Cancel the invitation for ${inv.email}?`)) return
    try {
      await authApi.revokeInvitation(inv.id)
      this.invitations.update((list) => list.filter((i) => i.id !== inv.id))
      this.flash(`Invitation for ${inv.email} cancelled.`)
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Could not cancel the invitation.', true)
    }
  }
}
