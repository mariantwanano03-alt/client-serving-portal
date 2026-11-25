'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type AdminUser = {
  id: string
  email: string
  full_name: string
  role: 'administrator' | 'senior_dev_pm' | 'junior_developer'
  is_active: boolean
  created_at: string | null
}

type AuditEntry = {
  key: string
  activityType: string
  summary: string
  entity: { typeLabel: string; label: string }
  actor: { displayName: string; isSystem: boolean }
  occurredAt: string
  occurredAtLabel: string
}

export default function DashboardPage() {
  return (
    <PortalShell title="Dashboard" breadcrumb="WORKSPACE / OVERVIEW">
      <DashboardContent />
    </PortalShell>
  )
}

function DashboardContent() {
  const { profile, isAdministrator, loading, signingOut } = usePortal()
  const [unreadMessages, setUnreadMessages] = useState<number | null>(null)

  // The count comes from the RLS-scoped messages API, so a junior only ever
  // sees unread messages from projects they are assigned to.
  useEffect(() => {
    if (loading || signingOut || !profile || isAdministrator) return
    let active = true
    const controller = new AbortController()

    async function loadUnread() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const response = await fetch('/api/messages', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const payload = (await response.json()) as { total_unread?: number }
        if (active) setUnreadMessages(payload.total_unread ?? 0)
      } catch {
        // Leave the count blank rather than showing a wrong number.
      }
    }

    loadUnread()
    window.addEventListener('client-messages:changed', loadUnread)
    return () => {
      active = false
      controller.abort()
      window.removeEventListener('client-messages:changed', loadUnread)
    }
  }, [loading, signingOut, profile, isAdministrator])

  if (isAdministrator) return <AdminOversightDashboard />

  const displayName = profile?.full_name?.trim() || 'User'
  const firstName = displayName.split(' ')[0]

  return (
    <>
      <section className="dashboard-welcome">
        <div className="dashboard-welcome-content">
          <span className="dashboard-pill">YOUR WORKSPACE</span>
          <h2>Welcome back, {firstName}!</h2>
          <p>
            Here is your workspace. Manage your clients and keep
            track of your projects from one place.
          </p>
          <Link href="/projects" className="dashboard-button">
            View projects <span>→</span>
          </Link>
        </div>

        <div className="dashboard-welcome-art" aria-hidden="true">
          <div className="dashboard-art-circle" />
          <div className="dashboard-art-card">
            <span>✳</span>
            <div />
            <div />
            <div />
            <b>✓</b>
          </div>
          <div className="dashboard-art-badge">Workspace ready ✓</div>
        </div>
      </section>

      <section className="dashboard-section-heading">
        <div>
          <h2>Your workspace</h2>
          <p>Quick access to your day-to-day work.</p>
        </div>
        <span className="dashboard-role-badge">
          {formatRole(profile?.role)}
        </span>
      </section>

      <section className="dashboard-feature-grid">
        <Link href="/clients" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon clients-tone">♙</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Clients</h3>
          <p>Access your client information and manage relationships.</p>
          <span className="dashboard-card-action">Open clients →</span>
        </Link>

        <Link href="/projects" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon projects-tone">▤</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Projects</h3>
          <p>View your projects and follow their progress.</p>
          <span className="dashboard-card-action">View projects →</span>
        </Link>

        <Link href="/" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">⌂</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Home</h3>
          <p>Return to the Client Serving Portal home page.</p>
          <span className="dashboard-card-action">Go to home →</span>
        </Link>

        <Link
          href="/messages"
          className="dashboard-feature-card"
          data-testid="dashboard-unread-messages-card"
        >
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon messages-tone">✉</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Unread client messages</h3>
          <p data-testid="dashboard-unread-messages-count">
            {unreadMessages === null
              ? 'Loading…'
              : `${unreadMessages} unread message${unreadMessages === 1 ? '' : 's'}`}
          </p>
          <span className="dashboard-card-action">Open messages →</span>
        </Link>
      </section>
    </>
  )
}

function AdminOversightDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [clientCount, setClientCount] = useState<number | null>(null)
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadOversight() {
      setLoading(true)
      setErrorMessage('')

      const [clientResult, projectResult, tokenResult] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.auth.getSession(),
      ])

      if (ignore) return

      if (clientResult.error || projectResult.error) {
        setErrorMessage('Could not load record counts: ' + (clientResult.error?.message || projectResult.error?.message))
      } else {
        setClientCount((clientResult as unknown as { count: number | null }).count ?? 0)
        setProjectCount((projectResult as unknown as { count: number | null }).count ?? 0)
      }

      const token = tokenResult.data.session?.access_token
      if (!token) {
        setErrorMessage('Your session has expired. Please sign in again.')
        setLoading(false)
        return
      }

      try {
        const [usersRes, auditRes] = await Promise.all([
          fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/audit?limit=5', { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (usersRes.status === 401 || usersRes.status === 403 || auditRes.status === 401 || auditRes.status === 403) {
          setErrorMessage('You are not authorized to view oversight data. Please sign in again.')
          setLoading(false)
          return
        }

        const usersJson = await usersRes.json()
        const auditJson = await auditRes.json()

        if (!usersRes.ok) throw new Error(usersJson?.error || 'Could not load users.')
        if (!auditRes.ok) throw new Error(auditJson?.error || 'Could not load audit activity.')

        if (!ignore) {
          setUsers(usersJson.users ?? [])
          setEntries(auditJson.entries ?? [])
        }
      } catch (err: unknown) {
        if (!ignore) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not load oversight data.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadOversight()

    return () => { ignore = true }
  }, [])

  const activeCount = users.filter((u) => u.is_active).length
  const suspendedCount = users.length - activeCount

  return (
    <div className="oversight-page">
      <div className="readonly-banner" data-testid="admin-readonly-banner">
        <span aria-hidden="true">🛡️</span>
        <span>
          Read-only oversight dashboard. Business operations are not available to administrators.
        </span>
      </div>

      {errorMessage && (
        <div className="auth-alert-error" role="alert" data-testid="admin-dashboard-error">
          <span aria-hidden="true">⚠️</span><span>{errorMessage}</span>
        </div>
      )}

      <section className="dashboard-section-heading">
        <div>
          <h2>Oversight at a glance</h2>
          <p>{loading ? 'Loading oversight records…' : 'Read-only totals from the workspace.'}</p>
        </div>
        <Link href="/audit" className="portal-btn-secondary">View audit trails →</Link>
      </section>

      <section className="oversight-stats-grid">
        <div className="oversight-stat-card" data-testid="admin-stat-clients">
          <span className="portal-stat-label">Total clients</span>
          <strong className="portal-stat-value">{clientCount ?? '—'}</strong>
        </div>
        <div className="oversight-stat-card" data-testid="admin-stat-projects">
          <span className="portal-stat-label">Total projects</span>
          <strong className="portal-stat-value">{projectCount ?? '—'}</strong>
        </div>
        <div className="oversight-stat-card" data-testid="admin-stat-users">
          <span className="portal-stat-label">Total users</span>
          <strong className="portal-stat-value">{users.length}</strong>
        </div>
        <div className="oversight-stat-card" data-testid="admin-stat-active">
          <span className="portal-stat-label">Active users</span>
          <strong className="portal-stat-value">{activeCount}</strong>
        </div>
        <div className="oversight-stat-card" data-testid="admin-stat-suspended">
          <span className="portal-stat-label">Suspended roles</span>
          <strong className="portal-stat-value">{suspendedCount}</strong>
        </div>
        <div className="oversight-stat-card" data-testid="admin-stat-audit">
          <span className="portal-stat-label">Recent audit activity</span>
          <strong className="portal-stat-value">{entries.length}</strong>
        </div>
      </section>

      <section className="portal-card oversight-audit-card" data-testid="admin-audit-list">
        <div className="portal-card-header">
          <div>
            <h3>Recent audit activity</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Latest recorded governance actions. Read-only.
            </p>
          </div>
          <Link href="/audit" className="dashboard-card-action">Open full trail →</Link>
        </div>

        {entries.length === 0 ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">📜</div>
            <p className="portal-empty-title">No recent audit activity</p>
          </div>
        ) : (
          <div className="oversight-audit-list">
            {entries.map((entry) => (
              <div key={entry.key} className="oversight-audit-item">
                <span className="audit-action-tag">{entry.activityType}</span>
                <span className="code-badge">{entry.entity.typeLabel}</span>
                <span className="oversight-audit-actor">{entry.actor.displayName}</span>
                <time dateTime={entry.occurredAt}>{entry.occurredAtLabel}</time>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="oversight-link-grid">
        <Link href="/clients" className="oversight-link-card">
          <span className="dashboard-feature-icon clients-tone" aria-hidden="true">♙</span>
          <h2>Clients</h2>
          <p>Browse client records.</p>
          <span className="dashboard-card-action">View clients →</span>
        </Link>
        <Link href="/projects" className="oversight-link-card">
          <span className="dashboard-feature-icon projects-tone" aria-hidden="true">▤</span>
          <h2>Projects</h2>
          <p>Review project workspaces.</p>
          <span className="dashboard-card-action">View projects →</span>
        </Link>
        <Link href="/admin" className="oversight-link-card">
          <span className="dashboard-feature-icon home-tone" aria-hidden="true">🛡</span>
          <h2>User Management</h2>
          <p>Manage roles and account status.</p>
          <span className="dashboard-card-action">Open user management →</span>
        </Link>
      </section>
    </div>
  )
}
