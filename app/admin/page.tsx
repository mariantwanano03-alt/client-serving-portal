'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Role = 'administrator' | 'senior_dev_pm' | 'junior_developer' | 'client'
type AccountStatus = 'pending_role_assignment' | 'active' | 'suspended'
type StatusFilter = 'all' | 'pending' | 'active' | 'suspended'

type ManagedUser = {
  id: string
  email: string | null
  full_name: string
  role: Role
  is_active: boolean
  account_status: AccountStatus
  created_at: string | null
}

type Confirmation = {
  kind: 'role' | 'status' | 'assign'
  user: ManagedUser
  nextRole?: Role
  nextStatus?: boolean
  message: string
}

type StatusMessage = { type: 'success' | 'error'; text: string }

const SUSPEND_MESSAGE =
  "Are you sure you want to suspend this user's role? Their permissions associated with this role will be revoked."
const REACTIVATE_MESSAGE = "Are you sure you want to reactivate this user's role?"

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'junior_developer', label: 'Junior Developer' },
  { value: 'senior_dev_pm', label: 'Senior Developer / Project Manager' },
  { value: 'client', label: 'Client' },
  { value: 'administrator', label: 'Administrator' },
]

const FILTERS: { value: StatusFilter; label: string; testId: string }[] = [
  { value: 'all', label: 'All users', testId: 'user-filter-all' },
  { value: 'pending', label: 'Pending role assignment', testId: 'user-filter-pending' },
  { value: 'active', label: 'Active', testId: 'user-filter-active' },
  { value: 'suspended', label: 'Suspended', testId: 'user-filter-suspended' },
]

function formatRegistered(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function roleBadgeClass(role: Role) {
  return `admin-badge role-${role}`
}

function statusLabel(status: AccountStatus) {
  if (status === 'pending_role_assignment') return 'Pending Role Assignment'
  return status === 'active' ? 'Active' : 'Suspended'
}

function statusBadgeClass(status: AccountStatus) {
  return `admin-badge status-${status}`
}

export default function AdminPage() {
  return (
    <PortalShell title="User Management" breadcrumb="WORKSPACE / USER MANAGEMENT">
      <AdminContent />
    </PortalShell>
  )
}

function AdminContent() {
  const { user, isAdministrator, canManageUsers } = usePortal()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [assignmentRole, setAssignmentRole] = useState<Role>('junior_developer')

  useEffect(() => {
    if (!canManageUsers) return
    let ignore = false

    async function loadUsers() {
      setLoading(true)
      setStatusMessage(null)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) {
          setStatusMessage({ type: 'error', text: 'Your session has expired. Please sign in again.' })
          return
        }

        const response = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (response.status === 401 || response.status === 403) {
          setStatusMessage({ type: 'error', text: 'You are not authorized to manage users. Please sign in again.' })
          return
        }

        const json = await response.json()
        if (!response.ok) throw new Error(json?.error || 'Could not load users.')
        if (!ignore) setUsers((json.users ?? []) as ManagedUser[])
      } catch (err: unknown) {
        if (!ignore) {
          setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not load users.' })
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadUsers()
    return () => { ignore = true }
  }, [canManageUsers])

  const activeAdminCount = useMemo(
    () => users.filter((item) => (
      item.is_active && item.account_status === 'active' && item.role === 'administrator'
    )).length,
    [users],
  )

  const pendingCount = useMemo(
    () => users.filter((item) => item.account_status === 'pending_role_assignment').length,
    [users],
  )

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((item) => {
      const matchesFilter =
        statusFilter === 'all' ||
        (statusFilter === 'pending' && item.account_status === 'pending_role_assignment') ||
        (statusFilter === 'active' && item.account_status === 'active') ||
        (statusFilter === 'suspended' && item.account_status === 'suspended')
      if (!matchesFilter) return false
      if (!q) return true
      return [item.full_name, item.email, formatRole(item.role), statusLabel(item.account_status)]
        .some((value) => (value || '').toLowerCase().includes(q))
    })
  }, [users, search, statusFilter])

  function requestRoleChange(target: ManagedUser, nextRole: Role) {
    if (nextRole === target.role) return
    if (target.id === user?.id) {
      setStatusMessage({ type: 'error', text: 'You cannot change your own role.' })
      return
    }
    if (target.role === 'administrator' && target.is_active && activeAdminCount <= 1 && nextRole !== 'administrator') {
      setStatusMessage({
        type: 'error',
        text: 'The last active administrator cannot be demoted. Promote another user first.',
      })
      return
    }

    setStatusMessage(null)
    setConfirmation({
      kind: 'role',
      user: target,
      nextRole,
      message: `Change role from ${formatRole(target.role)} to ${formatRole(nextRole)}?`,
    })
  }

  function requestAssignment(target: ManagedUser) {
    if (target.id === user?.id) {
      setStatusMessage({ type: 'error', text: 'You cannot change your own role.' })
      return
    }
    if (target.account_status !== 'pending_role_assignment') return

    setStatusMessage(null)
    setAssignmentRole('junior_developer')
    setConfirmation({
      kind: 'assign',
      user: target,
      message: `Choose the confirmed role for ${target.full_name || target.email}. The account will become active once you confirm.`,
    })
  }

  function requestStatusToggle(target: ManagedUser) {
    if (target.id === user?.id) {
      setStatusMessage({ type: 'error', text: 'You cannot change your own account status.' })
      return
    }
    if (target.is_active && target.role === 'administrator' && activeAdminCount <= 1) {
      setStatusMessage({
        type: 'error',
        text: 'The last active administrator cannot be suspended. Promote another user first.',
      })
      return
    }

    const nextStatus = !target.is_active
    setStatusMessage(null)
    setConfirmation({
      kind: 'status',
      user: target,
      nextStatus,
      message: nextStatus ? REACTIVATE_MESSAGE : SUSPEND_MESSAGE,
    })
  }

  async function confirmAction() {
    if (!confirmation || submitting) return

    const target = confirmation.user
    setSubmitting(true)
    setStatusMessage(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Your session has expired. Please sign in again.')

      const payload =
        confirmation.kind === 'assign'
          ? { role: assignmentRole }
          : confirmation.kind === 'role'
            ? { role: confirmation.nextRole }
            : { account_status: confirmation.nextStatus ? 'active' : 'suspended' }

      const response = await fetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (response.status === 401 || response.status === 403) {
        throw new Error('You are not authorized to manage users. Please sign in again.')
      }

      const json = await response.json()
      if (!response.ok) throw new Error(json?.error || 'Could not update user.')

      const updated = json.user as ManagedUser
      setUsers((previous) => previous.map((item) => (item.id === updated.id ? updated : item)))
      setConfirmation(null)

      const label = updated.full_name || updated.email || 'User'
      const text =
        confirmation.kind === 'assign'
          ? `Role assigned as ${formatRole(updated.role)}; ${label} is now active.`
          : confirmation.kind === 'role'
            ? `Role updated to ${formatRole(updated.role)} for ${label}.`
            : `User ${updated.is_active ? 'reactivated' : 'suspended'}: ${label}.`
      setStatusMessage({ type: 'success', text })
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not update user.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (!isAdministrator || !canManageUsers) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">🔒</div>
          <p className="portal-empty-title">Access Restricted</p>
          <p className="portal-empty-desc">User management is available to active administrators only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-design">
      <div className="oversight-page">
        <div className="readonly-banner">
          <span aria-hidden="true">🛡️</span>
          <span>
            Administrative oversight only. Role and status changes are audited automatically
            by the server; no business operations are available here.
          </span>
        </div>

        {statusMessage && (
          <div
            className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'}
            data-testid={statusMessage.type === 'error' ? 'admin-error' : 'admin-success'}
            role="alert"
          >
            <span aria-hidden="true">{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        <section className="admin-metric-grid" aria-label="User summary">
          <div className="admin-metric">
            <span className="admin-metric-label">Total users</span>
            <strong className="admin-metric-value">{users.length}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Pending role assignment</span>
            <strong className="admin-metric-value" data-testid="pending-user-count">{pendingCount}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Active users</span>
            <strong className="admin-metric-value">
              {users.filter((item) => item.account_status === 'active').length}
            </strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Administrators</span>
            <strong className="admin-metric-value">{activeAdminCount}</strong>
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <h2 className="admin-surface-title">User directory</h2>
              <p className="admin-surface-desc">
                Search users and manage roles or account status. Changes take effect immediately.
              </p>
            </div>
            <div className="portal-search-wrap admin-search">
              <span className="portal-search-icon" aria-hidden="true">🔍</span>
              <input
                className="portal-search-input"
                aria-label="Search users"
                placeholder="Search name, email or role..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="admin-tabs" role="group" aria-label="Filter users by status">
            {FILTERS.map((filter) => {
              const count = filter.value === 'all'
                ? users.length
                : filter.value === 'pending'
                  ? pendingCount
                  : filter.value === 'active'
                    ? users.filter((item) => item.account_status === 'active').length
                    : users.filter((item) => item.account_status === 'suspended').length
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={`portal-tab-btn ${statusFilter === filter.value ? 'active' : ''}`}
                  data-testid={filter.testId}
                  aria-label={filter.label}
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                  <span className="admin-tab-count" aria-hidden="true">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="admin-notice">
            <span aria-hidden="true">🛡️</span>
            <span>
              You cannot modify your own role or status, and the last active administrator cannot be
              suspended or demoted. Every change is recorded in the{' '}
              <Link href="/audit" className="portal-table-link">Audit Trail</Link>.
            </span>
          </div>

          {loading ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">⏳</div>
              <p className="portal-empty-title">Loading users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">👥</div>
              <p className="portal-empty-title">
                {search
                  ? 'No matching users'
                  : statusFilter === 'pending'
                    ? 'No users awaiting role assignment'
                    : 'No users found'}
              </p>
              <p className="portal-empty-desc">
                {search
                  ? 'Try a different search term.'
                  : statusFilter === 'pending'
                    ? 'New registrations appear here until an Administrator confirms their role.'
                    : 'User profiles will appear here once registered.'}
              </p>
            </div>
          ) : (
            <div className="portal-table-container admin-table-scroll">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Registered</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Controls</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item) => {
                    const isSelf = item.id === user?.id
                    const isPending = item.account_status === 'pending_role_assignment'
                    const isLastActiveAdmin = item.is_active && item.role === 'administrator' && activeAdminCount <= 1
                    return (
                      <tr
                        key={item.id}
                        data-testid="user-row"
                        className={isPending ? 'user-row-pending' : undefined}
                        data-status={item.account_status}
                      >
                        <td>
                          <strong className="admin-cell-truncate is-name" title={item.full_name || 'Unnamed user'}>
                            {item.full_name || 'Unnamed user'}
                          </strong>
                        </td>
                        <td>
                          <span className="admin-cell-truncate" title={item.email || ''}>{item.email || '—'}</span>
                        </td>
                        <td className="admin-registered-at">{formatRegistered(item.created_at)}</td>
                        <td>
                          <span className={roleBadgeClass(item.role)}>{formatRole(item.role)}</span>
                        </td>
                        <td>
                          <span
                            className={statusBadgeClass(item.account_status)}
                            data-testid="user-status-badge"
                          >
                            {statusLabel(item.account_status)}
                          </span>
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <select
                              className="form-input"
                              data-testid="user-role-select"
                              aria-label={`Role for ${item.full_name || item.email}`}
                              value={item.role}
                              disabled={submitting || isSelf}
                              onChange={(event) => requestRoleChange(item, event.target.value as Role)}
                            >
                              {ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            {isPending ? (
                              <button
                                type="button"
                                className="portal-btn-primary"
                                data-testid="assign-role-button"
                                disabled={submitting || isSelf}
                                aria-label={`Assign Role for ${item.full_name || item.email}`}
                                onClick={() => requestAssignment(item)}
                              >
                                Assign Role
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="portal-btn-secondary"
                                data-testid="user-status-toggle"
                                disabled={submitting || isSelf || isLastActiveAdmin}
                                aria-label={`${item.is_active ? 'Suspend' : 'Activate'} ${item.full_name || item.email}`}
                                onClick={() => requestStatusToggle(item)}
                              >
                                {item.is_active ? 'Suspend' : 'Activate'}
                              </button>
                            )}
                          </div>
                          {isSelf && <small className="admin-row-note">Your own account cannot be modified.</small>}
                          {!isSelf && isLastActiveAdmin && (
                            <small className="admin-row-note">Last active administrator safeguard.</small>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {confirmation && (
        <div className="confirm-backdrop" data-testid="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-dialog">
            <h3 id="confirm-title">
              Confirm {confirmation.kind === 'assign'
                ? 'role assignment'
                : confirmation.kind === 'role' ? 'role change' : 'status change'}
            </h3>
            <p>{confirmation.message}</p>
            {confirmation.kind === 'assign' && (
              <label className="form-group">
                <span className="form-label">Confirmed role</span>
                <select
                  className="form-input"
                  data-testid="assign-role-select"
                  aria-label="Role to assign"
                  value={assignmentRole}
                  disabled={submitting}
                  onChange={(event) => setAssignmentRole(event.target.value as Role)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small className="admin-row-note">
                  This activates the account and applies the role&apos;s permissions on their next request.
                </small>
              </label>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="portal-btn-secondary"
                data-testid="confirm-cancel"
                disabled={submitting}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="portal-btn-primary"
                data-testid="confirm-accept"
                disabled={submitting}
                onClick={confirmAction}
              >
                {submitting
                  ? 'Saving…'
                  : confirmation.kind === 'assign' ? 'Assign Role' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
