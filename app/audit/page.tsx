'use client'

import React, { useEffect, useState } from 'react'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type AuditEntry = {
  key: string
  activityType: string
  summary: string
  entity: { typeLabel: string; label: string }
  actor: { displayName: string; isSystem: boolean }
  affectsUser: boolean
  affectedUser: string | null
  occurredAt: string
  occurredAtLabel: string
  context: string[]
}

type Facets = {
  activityTypes: string[]
  entityTypes: string[]
  users: string[]
}

type Filters = {
  q: string
  user: string
  userScope: 'any' | 'actor' | 'affected'
  activity: string
  entityType: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = {
  q: '', user: '', userScope: 'any', activity: '', entityType: '', from: '', to: '',
}

const EMPTY_FACETS: Facets = { activityTypes: [], entityTypes: [], users: [] }

export default function AuditPage() {
  return (
    <PortalShell title="Audit Trails" breadcrumb="WORKSPACE / AUDIT TRAILS">
      <AuditContent />
    </PortalShell>
  )
}

function AuditContent() {
  const { isAdministrator } = usePortal()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(100)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!isAdministrator) return
    let ignore = false

    async function loadAudit() {
      setLoading(true)
      setErrorMessage('')
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) {
          setErrorMessage('Your session has expired. Please sign in again.')
          setLoading(false)
          return
        }

        const params = new URLSearchParams()
        if (filters.q) params.set('q', filters.q)
        if (filters.user) params.set('user', filters.user)
        if (filters.userScope !== 'any') params.set('userScope', filters.userScope)
        if (filters.activity) params.set('activity', filters.activity)
        if (filters.entityType) params.set('entityType', filters.entityType)
        if (filters.from) params.set('from', filters.from)
        if (filters.to) params.set('to', filters.to)
        params.set('limit', String(limit))

        const response = await fetch(`/api/admin/audit?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (response.status === 401 || response.status === 403) {
          setErrorMessage('You are not authorized to view audit trails. Please sign in again.')
          setLoading(false)
          return
        }

        const json = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(json?.error || 'Could not load audit trails.')
        if (!ignore) {
          setEntries(Array.isArray(json.entries) ? json.entries : [])
          setFacets(json.facets || EMPTY_FACETS)
          setTotal(Number(json.total) || 0)
        }
      } catch (err: unknown) {
        if (!ignore) setErrorMessage(err instanceof Error ? err.message : 'Could not load audit trails.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    const timeout = window.setTimeout(() => { void loadAudit() }, 200)
    return () => { ignore = true; window.clearTimeout(timeout) }
  }, [isAdministrator, filters, limit])

  if (!isAdministrator) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">🔒</div>
          <p className="portal-empty-title">Access Restricted</p>
          <p className="portal-empty-desc">Audit trails are available to administrators only.</p>
        </div>
      </div>
    )
  }

  const hasFilters = Object.entries(filters).some(([key, value]) => key === 'userScope' ? value !== 'any' : Boolean(value))

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setLimit(100)
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  return (
    <div className="admin-design">
      <div className="oversight-page">
        <div className="readonly-banner" data-testid="audit-readonly">
          <span aria-hidden="true">📜</span>
          <span>
            Read-only activity history. Entries are recorded automatically by the server and
            cannot be created, edited or deleted here.
          </span>
        </div>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <h2 className="admin-surface-title">Activity history</h2>
              <p className="admin-surface-desc">
                Search who did what, which record was affected, and when. Newest activity appears first.
              </p>
            </div>
            <span className="admin-badge">{total} activities</span>
          </div>

          <div className="admin-filters">
            <label className="admin-filter-field">
              <span>Search activities</span>
              <input
                className="admin-filter-input"
                aria-label="Search activities"
                placeholder="Describe an activity..."
                value={filters.q}
                onChange={(event) => updateFilter('q', event.target.value)}
              />
            </label>
            <label className="admin-filter-field">
              <span>User name or email</span>
              <input
                className="admin-filter-input"
                aria-label="Search by user name or email"
                placeholder="Search people..."
                value={filters.user}
                onChange={(event) => updateFilter('user', event.target.value)}
              />
            </label>
            <label className="admin-filter-field">
              <span>User involvement</span>
              <select
                className="admin-filter-input"
                aria-label="User involvement"
                value={filters.userScope}
                onChange={(event) => updateFilter('userScope', event.target.value as Filters['userScope'])}
              >
                <option value="any">By or affecting a user</option>
                <option value="actor">Actions by a user</option>
                <option value="affected">Actions affecting a user</option>
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Activity</span>
              <select
                className="admin-filter-input"
                aria-label="Filter by activity"
                value={filters.activity}
                onChange={(event) => updateFilter('activity', event.target.value)}
              >
                <option value="">All activities</option>
                {facets.activityTypes.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Record type</span>
              <select
                className="admin-filter-input"
                aria-label="Filter by record type"
                value={filters.entityType}
                onChange={(event) => updateFilter('entityType', event.target.value)}
              >
                <option value="">All record types</option>
                {facets.entityTypes.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
            <label className="admin-filter-field">
              <span>From date</span>
              <input
                type="date"
                className="admin-filter-input"
                aria-label="Activity from date"
                value={filters.from}
                onChange={(event) => updateFilter('from', event.target.value)}
              />
            </label>
            <label className="admin-filter-field">
              <span>To date</span>
              <input
                type="date"
                className="admin-filter-input"
                aria-label="Activity to date"
                value={filters.to}
                onChange={(event) => updateFilter('to', event.target.value)}
              />
            </label>
            <div className="admin-filter-actions">
              <button
                type="button"
                className="portal-btn-secondary"
                data-testid="audit-reset-filters"
                disabled={!hasFilters}
                onClick={() => { setLimit(100); setFilters(EMPTY_FILTERS) }}
              >
                Reset filters
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="auth-alert-error" data-testid="audit-error" role="alert">
              <span aria-hidden="true">⚠️</span><span>{errorMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="portal-empty-state" data-testid="audit-loading">
              <div className="portal-empty-icon">⏳</div>
              <p className="portal-empty-title">Loading activity history...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="portal-empty-state" data-testid="audit-empty">
              <div className="portal-empty-icon">📜</div>
              <p className="portal-empty-title">No activity found</p>
              <p className="portal-empty-desc">Try a different search term or reset the filters.</p>
            </div>
          ) : (
            <>
              <div className="admin-activity-list">
                {entries.map((entry) => (
                  <article key={entry.key} className="admin-activity-item" data-testid="audit-row">
                    <div className="admin-activity-actor">
                      <span>{entry.actor.displayName}</span>
                      <span className="admin-activity-type">{entry.activityType}</span>
                    </div>
                    <time className="admin-activity-time" dateTime={entry.occurredAt}>
                      {entry.occurredAtLabel}
                    </time>
                    <div className="admin-activity-action">
                      {entry.summary}
                      {entry.context.length > 0 && ` · ${entry.context.join(' · ')}`}
                    </div>
                    <div className="admin-activity-subject">
                      {entry.entity.typeLabel}: {entry.entity.label}
                      {entry.affectedUser && ` · ${entry.affectedUser}`}
                    </div>
                  </article>
                ))}
              </div>
              {entries.length < total && (
                <div className="admin-surface-foot">
                  <button
                    type="button"
                    className="portal-btn-secondary"
                    data-testid="audit-show-more"
                    onClick={() => setLimit((previous) => previous + 100)}
                  >
                    Show more activity
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
