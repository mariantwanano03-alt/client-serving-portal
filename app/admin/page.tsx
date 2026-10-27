'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Profile = {
  id: string
  full_name: string
  role: 'administrator' | 'senior_dev_pm' | 'junior_developer'
  is_active: boolean
  created_at?: string
}

type AuditEntry = {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_value: unknown
  after_value: unknown
  created_at: string
}

export default function AdminPage() {
  return (
    <PortalShell title="System Administration" breadcrumb="WORKSPACE / ADMIN">
      <AdminContent />
    </PortalShell>
  )
}

function AdminContent() {
  const { role, user } = usePortal()

  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchUser, setSearchUser] = useState('')
  const [auditFilter, setAuditFilter] = useState('all')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isAdmin = role === 'administrator'

  const loadAdminData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: profs, error: profsErr } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active, created_at')
        .order('created_at', { ascending: false })

      if (profsErr) {
        setStatusMessage({ type: 'error', text: 'Could not load users: ' + profsErr.message })
      } else {
        setProfiles((profs as Profile[]) ?? [])
      }

      const { data: audits, error: auditErr } = await supabase
        .from('audit_entries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (!auditErr && audits) {
        setAuditEntries(audits as AuditEntry[])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let ignore = false

    async function init() {
      try {
        const { data: profs, error: profsErr } = await supabase
          .from('profiles')
          .select('id, full_name, role, is_active, created_at')
          .order('created_at', { ascending: false })

        if (ignore) return

        if (profsErr) {
          setStatusMessage({ type: 'error', text: 'Could not load users: ' + profsErr.message })
        } else {
          setProfiles((profs as Profile[]) ?? [])
        }

        const { data: audits, error: auditErr } = await supabase
          .from('audit_entries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)

        if (!ignore && !auditErr && audits) {
          setAuditEntries(audits as AuditEntry[])
        }
        setLoading(false)
      } catch (err: unknown) {
        if (!ignore) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          setStatusMessage({ type: 'error', text: msg })
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      ignore = true
    }
  }, [])

  async function handleUpdateRole(userId: string, newRole: Profile['role'], currentRole: string) {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'Only administrators can modify roles.' })
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)

    if (error) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Failed to update role: ' + error.message })
      return
    }

    // Record audit entry
    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'user.role_changed',
      entity_type: 'profile',
      entity_id: userId,
      before_value: { role: currentRole },
      after_value: { role: newRole },
    })

    setSubmitting(false)
    setStatusMessage({ type: 'success', text: `User role updated to ${formatRole(newRole)}.` })
    await loadAdminData()
  }

  async function handleToggleUserStatus(userId: string, currentStatus: boolean) {
    if (!isAdmin) return
    const nextStatus = !currentStatus

    setSubmitting(true)
    const { error } = await supabase.from('profiles').update({ is_active: nextStatus }).eq('id', userId)

    if (error) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Failed to update status: ' + error.message })
      return
    }

    setSubmitting(false)
    setStatusMessage({ type: 'success', text: `User marked as ${nextStatus ? 'active' : 'suspended'}.` })
    await loadAdminData()
  }

  const filteredUsers = useMemo(() => {
    if (!searchUser.trim()) return profiles
    const q = searchUser.toLowerCase()
    return profiles.filter((p) => p.full_name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
  }, [profiles, searchUser])

  const filteredAudits = useMemo(() => {
    if (auditFilter === 'all') return auditEntries
    return auditEntries.filter((a) => a.entity_type === auditFilter)
  }, [auditEntries, auditFilter])

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Notice for non-admins */}
      {!isAdmin && (
        <div className="auth-alert-error" style={{ marginBottom: 20 }}>
          <span>ℹ️</span>
          <div>
            <strong>Administrator Access Notice:</strong> You are signed in as a{' '}
            <strong>{formatRole(role)}</strong>. Role modifications and user governance are restricted to Administrators.
          </div>
        </div>
      )}

      {/* Notifications */}
      {statusMessage && (
        <div
          className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'}
          style={{ marginBottom: 20 }}
          role="alert"
        >
          <span>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Stats Row */}
      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon home-tone">👥</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Total Team Members</span>
            <span className="portal-stat-value">{profiles.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon projects-tone">📜</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">System Audit Events</span>
            <span className="portal-stat-value">{auditEntries.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon clients-tone">🛡️</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Admins</span>
            <span className="portal-stat-value">
              {profiles.filter((p) => p.role === 'administrator').length}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="portal-tabs">
        <button
          type="button"
          className={`portal-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <span>👥 User & Role Governance</span>
          <span className="portal-tab-count">{profiles.length}</span>
        </button>
        <button
          type="button"
          className={`portal-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>📜 Audit Trail Stream</span>
          <span className="portal-tab-count">{auditEntries.length}</span>
        </button>
      </div>

      {loading && (
        <div className="portal-card" style={{ marginBottom: 20 }}>
          <div className="portal-empty-state">
            <div className="portal-empty-icon">⏳</div>
            <p className="portal-empty-title">Loading system records...</p>
          </div>
        </div>
      )}

      {/* Tab 1: Users */}
      {activeTab === 'users' && (
        <div className="portal-card">
          <div className="portal-card-header">
            <div>
              <h3>Workspace Team Directory</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Role assignment, user access statuses, and permission tiers.
              </p>
            </div>
            <div className="portal-search-wrap" style={{ maxWidth: 260 }}>
              <span className="portal-search-icon">🔍</span>
              <input
                className="portal-search-input"
                placeholder="Search team member..."
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
              />
            </div>
          </div>

          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Current Role</th>
                  <th>Account Status</th>
                  {isAdmin && <th style={{ textAlign: 'right' }}>Role Assignment</th>}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const initials = u.full_name
                    ? u.full_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()
                    : 'U'
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 8,
                              background: '#14213d',
                              color: '#fff',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <strong>{u.full_name}</strong>
                            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>ID: {u.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`portal-badge ${
                            u.role === 'administrator'
                              ? 'badge-purple'
                              : u.role === 'senior_dev_pm'
                              ? 'badge-blue'
                              : 'badge-gray'
                          }`}
                        >
                          {formatRole(u.role)}
                        </span>
                      </td>
                      <td>
                        <span className={`portal-badge ${u.is_active ? 'badge-green' : 'badge-amber'}`}>
                          {u.is_active ? '● Active' : '○ Suspended'}
                        </span>
                      </td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <select
                              className="form-input"
                              style={{ width: 'auto', height: 32, fontSize: 12 }}
                              value={u.role}
                              onChange={(e) =>
                                handleUpdateRole(u.id, e.target.value as Profile['role'], u.role)
                              }
                              disabled={submitting}
                            >
                              <option value="junior_developer">Junior Developer</option>
                              <option value="senior_dev_pm">Senior Dev / PM</option>
                              <option value="administrator">Administrator</option>
                            </select>

                            <button
                              type="button"
                              className="portal-btn-secondary"
                              style={{ height: 32, padding: '0 8px', fontSize: 11 }}
                              onClick={() => handleToggleUserStatus(u.id, u.is_active)}
                              disabled={submitting}
                            >
                              {u.is_active ? 'Suspend' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Audit Trail Stream */}
      {activeTab === 'audit' && (
        <div className="portal-card">
          <div className="portal-card-header">
            <div>
              <h3>System Event Audit Trail</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Immutable log of user operations, permissions, stage changes, and financial records.
              </p>
            </div>
            <select
              className="form-input"
              style={{ width: 'auto', height: 36, fontSize: 12 }}
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
            >
              <option value="all">All Entities</option>
              <option value="client">Clients</option>
              <option value="project">Projects</option>
              <option value="quotation">Quotations</option>
              <option value="profile">Profiles / Users</option>
            </select>
          </div>

          {filteredAudits.length === 0 ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">📜</div>
              <p className="portal-empty-title">No audit records found</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {filteredAudits.map((entry) => (
                <div key={entry.id} className="audit-entry-card">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span className="audit-action-tag">{entry.action}</span>
                      <span className="code-badge" style={{ fontSize: 10 }}>
                        {entry.entity_type}
                      </span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                      {entry.after_value ? (
                        <code
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            padding: '4px 8px',
                            borderRadius: 6,
                            display: 'inline-block',
                            fontFamily: 'monospace',
                            fontSize: 11,
                          }}
                        >
                          Payload: {JSON.stringify(entry.after_value)}
                        </code>
                      ) : (
                        <span>Action performed</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Actor: {entry.actor_user_id ? entry.actor_user_id.slice(0, 8) + '...' : 'System'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
