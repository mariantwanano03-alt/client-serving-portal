'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'
import type { DepositOverviewRow, FinancialResponse, PaymentRow } from '@/lib/financial-types'
import { displayStatus, formatDate, formatMoney, paymentStatusLabel } from '@/lib/financial-format'

type Filters = {
  client: string
  project: string
  status: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { client: '', project: '', status: '', from: '', to: '' }

export default function FinancialRecordsPage() {
  return (
    <PortalShell title="Financial Records" breadcrumb="WORKSPACE / FINANCIAL RECORDS">
      <FinancialRecordsContent />
    </PortalShell>
  )
}

function FinancialRecordsContent() {
  const { isAdministrator, role, loading: profileLoading, signingOut } = usePortal()
  const [data, setData] = useState<FinancialResponse>({ overview: [], payments: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

  const load = useCallback(async (signal?: AbortSignal) => {
    // Wait until the shell has resolved the signed-in role. The shell redirects
    // clients away from this route; firing this request during profile loading
    // would produce a guaranteed 401 before that redirect completes.
    if (profileLoading || signingOut) return
    // Only fetch after a staff/admin role is resolved. During sign-out the
    // profile is cleared and role becomes '', which otherwise fires a request
    // with an invalidated session and logs a 401 before the login redirect.
    if (!['administrator', 'senior_dev_pm', 'junior_developer'].includes(role)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (signal?.aborted) return
      const token = sessionData.session?.access_token
      if (!token) {
        setError('Your session has expired. Please sign in again.')
        return
      }

      // No projectId: the API returns every deposit the caller may read.
      // Abort on sign-out or role change: a response that lands after the next
      // login must not log a stale 401 against the new session.
      const response = await fetch('/api/financials', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (signal?.aborted) return
      if (!response.ok) {
        setError(payload?.error || 'Could not load financial records.')
        return
      }
      setData({
        overview: Array.isArray(payload.overview) ? payload.overview : [],
        payments: Array.isArray(payload.payments) ? payload.payments : [],
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load financial records.')
    } finally {
      setLoading(false)
    }
  }, [role, profileLoading, signingOut])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [load])

  const { overview, payments } = data

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    overview.forEach((row) => {
      if (row.client_id) map.set(row.client_id, row.client_name || 'Unnamed client')
    })
    return Array.from(map.entries())
  }, [overview])

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    overview.forEach((row) => {
      if (row.project_id) {
        map.set(row.project_id, row.project_reference || row.project_name || 'Unnamed project')
      }
    })
    return Array.from(map.entries())
  }, [overview])

  const statusOptions = useMemo(
    () => Array.from(new Set(overview.map((row) => displayStatus(row).label))),
    [overview],
  )

  const filteredOverview = useMemo(() => overview.filter((row) => {
    if (filters.client && row.client_id !== filters.client) return false
    if (filters.project && row.project_id !== filters.project) return false
    if (filters.status && displayStatus(row).label !== filters.status) return false
    return true
  }), [overview, filters])

  const visibleDepositIds = useMemo(
    () => new Set(filteredOverview.map((row) => row.deposit_id)),
    [filteredOverview],
  )

  const filteredPayments = useMemo(() => payments.filter((payment) => {
    if (!visibleDepositIds.has(payment.deposit_id)) return false
    if (filters.from && payment.payment_date < filters.from) return false
    if (filters.to && payment.payment_date > filters.to) return false
    return true
  }), [payments, visibleDepositIds, filters.from, filters.to])

  const totals = useMemo(() => {
    const required = filteredOverview.reduce((sum, row) => sum + (Number(row.required_cents) || 0), 0)
    const paid = filteredOverview.reduce((sum, row) => sum + (Number(row.paid_cents) || 0), 0)
    const outstanding = filteredOverview.reduce(
      (sum, row) => sum + Math.max(Number(row.outstanding_cents) || 0, 0),
      0,
    )
    const percent = required > 0
      ? Math.min(100, Math.max(0, Math.round((paid / required) * 100)))
      : 0
    return { required, paid, outstanding, percent }
  }, [filteredOverview])

  const currency = filteredOverview.find((row) => row.currency)?.currency || 'ZAR'
  const hasFilters = Object.values(filters).some(Boolean)

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  return (
    <div className="admin-design">
      <div className="oversight-page">
        <div className="readonly-banner" data-testid="financial-records-readonly">
          <span aria-hidden="true">🛡️</span>
          <span>
            {isAdministrator
              ? 'Read-only administrator oversight. These figures are gathered from the existing deposit and payment records; nothing can be created, edited or confirmed here.'
              : 'Read-only financial records. Balances and payment history come from the existing project financial records; nothing can be changed here.'}
          </span>
        </div>

        {error && (
          <div className="auth-alert-error" data-testid="financial-records-error" role="alert">
            <span aria-hidden="true">⚠️</span><span>{error}</span>
          </div>
        )}

        <section className="admin-metric-grid" data-testid="financial-records-summary" aria-label="Financial summary">
          <div className="admin-metric">
            <span className="admin-metric-label">Deposits</span>
            <strong className="admin-metric-value">{filteredOverview.length}</strong>
            <span className="admin-metric-note">Matching the current filters</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Total required</span>
            <strong className="admin-metric-value">{formatMoney(totals.required, currency)}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Total paid</span>
            <strong className="admin-metric-value">{formatMoney(totals.paid, currency)}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Outstanding</span>
            <strong className="admin-metric-value">{formatMoney(totals.outstanding, currency)}</strong>
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <h2 className="admin-surface-title">Deposit position</h2>
              <p className="admin-surface-desc">
                Progress against each deposit requirement, using the same figures as the project Financials tab.
              </p>
            </div>
            <button
              type="button"
              className="portal-btn-secondary"
              data-testid="financial-records-refresh"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="admin-filters">
            <label className="admin-filter-field">
              <span>Client</span>
              <select
                className="admin-filter-input"
                data-testid="financial-record-filter-client"
                aria-label="Filter by client"
                value={filters.client}
                onChange={(event) => updateFilter('client', event.target.value)}
              >
                <option value="">All clients</option>
                {clientOptions.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Project</span>
              <select
                className="admin-filter-input"
                data-testid="financial-record-filter-project"
                aria-label="Filter by project"
                value={filters.project}
                onChange={(event) => updateFilter('project', event.target.value)}
              >
                <option value="">All projects</option>
                {projectOptions.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Status</span>
              <select
                className="admin-filter-input"
                data-testid="financial-record-filter-status"
                aria-label="Filter by status"
                value={filters.status}
                onChange={(event) => updateFilter('status', event.target.value)}
              >
                <option value="">All statuses</option>
                {statusOptions.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Payment date from</span>
              <input
                type="date"
                className="admin-filter-input"
                data-testid="financial-record-filter-from"
                aria-label="Payment date from"
                value={filters.from}
                onChange={(event) => updateFilter('from', event.target.value)}
              />
            </label>
            <label className="admin-filter-field">
              <span>Payment date to</span>
              <input
                type="date"
                className="admin-filter-input"
                data-testid="financial-record-filter-to"
                aria-label="Payment date to"
                value={filters.to}
                onChange={(event) => updateFilter('to', event.target.value)}
              />
            </label>
            <div className="admin-filter-actions">
              <button
                type="button"
                className="portal-btn-secondary"
                data-testid="financial-records-reset"
                disabled={!hasFilters}
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Reset filters
              </button>
            </div>
          </div>

          <div className="admin-progress">
            <div className="admin-progress-meta">
              <span>{formatMoney(totals.paid, currency)} paid of {formatMoney(totals.required, currency)}</span>
              <span>{totals.percent}%</span>
            </div>
            <div
              className="admin-progress-track"
              role="progressbar"
              aria-label="Overall payment progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totals.percent}
            >
              <div
                className={`admin-progress-fill${totals.percent >= 100 ? ' is-complete' : ''}`}
                style={{ width: `${totals.percent}%` }}
              />
            </div>
          </div>

          {loading ? (
            <div className="portal-empty-state" data-testid="financial-records-loading">
              <div className="portal-empty-icon">⏳</div>
              <p className="portal-empty-title">Loading financial records...</p>
            </div>
          ) : filteredOverview.length === 0 ? (
            <div className="portal-empty-state" data-testid="financial-records-empty">
              <div className="portal-empty-icon">◇</div>
              <p className="portal-empty-title">
                {hasFilters ? 'No records match these filters' : 'No financial records available'}
              </p>
              <p className="portal-empty-desc">
                {hasFilters
                  ? 'Try a different client, project, status or date range.'
                  : 'Deposit records will appear here once they exist and are visible to your role.'}
              </p>
            </div>
          ) : (
            <div className="financial-records-list">
              {filteredOverview.map((row: DepositOverviewRow) => {
                const status = displayStatus(row)
                const required = Number(row.required_cents) || 0
                const paid = Number(row.paid_cents) || 0
                const remaining = Math.max(Number(row.outstanding_cents) || 0, 0)
                const percent = required > 0
                  ? Math.min(100, Math.max(0, Math.round((paid / required) * 100)))
                  : 0
                return (
                  <section
                    className="financial-card"
                    data-testid="financial-record-card"
                    data-deposit-id={row.deposit_id}
                    key={row.deposit_id}
                  >
                    <header className="financial-card-header">
                      <div>
                        <span className="financial-card-eyebrow">Deposit Payment</span>
                        <h3 className="financial-card-title">
                          {row.reference || 'Deposit'}
                          {row.project_reference && (
                            <span className="financial-card-reference"> · {row.project_reference}</span>
                          )}
                        </h3>
                        <p className="financial-card-reference">
                          {row.client_name || 'Unassigned client'} · Due {formatDate(row.due_date)}
                        </p>
                      </div>
                      <span className={`financial-status financial-status-${status.tone}`}>
                        {status.label}
                      </span>
                    </header>

                    <div className="financial-progress-block">
                      <div className="financial-progress-labels">
                        <span>{formatMoney(paid, row.currency)}</span>
                        <span className="financial-progress-of">paid of</span>
                        <span>{formatMoney(required, row.currency)}</span>
                        <span className="financial-progress-percent">{percent}%</span>
                      </div>
                      <div
                        className="financial-progress-track"
                        role="progressbar"
                        aria-label={`Payment progress for ${row.reference || 'deposit'}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <div
                          className={`financial-progress-fill${status.complete ? ' is-complete' : ''}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className={`financial-remaining${status.complete ? ' is-complete' : ''}`}>
                        {status.complete ? 'Nothing remaining' : `${formatMoney(remaining, row.currency)} remaining`}
                      </p>
                    </div>

                    <div className="financial-stats">
                      <div className="financial-stat">
                        <span className="financial-stat-label">Amount Required</span>
                        <strong>{formatMoney(required, row.currency)}</strong>
                      </div>
                      <div className="financial-stat">
                        <span className="financial-stat-label">Amount Paid</span>
                        <strong>{formatMoney(paid, row.currency)}</strong>
                      </div>
                      <div className="financial-stat">
                        <span className="financial-stat-label">Amount Remaining</span>
                        <strong>{formatMoney(remaining, row.currency)}</strong>
                      </div>
                      <div className="financial-stat">
                        <span className="financial-stat-label">Due Date</span>
                        <strong>{formatDate(row.due_date)}</strong>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <h2 className="admin-surface-title">Payment history</h2>
              <p className="admin-surface-desc">
                Recorded payments for the deposits above, newest first. Void entries are excluded from totals and history.
              </p>
            </div>
            <span className="admin-badge">{filteredPayments.length} payments</span>
          </div>

          {filteredPayments.length === 0 ? (
            <div className="portal-empty-state" data-testid="financial-records-history-empty">
              <div className="portal-empty-icon">◇</div>
              <p className="portal-empty-title">No payments in this view</p>
              <p className="portal-empty-desc">Adjust the filters or refresh to see recorded payments.</p>
            </div>
          ) : (
            <div className="admin-table-scroll">
              <table className="portal-table" data-testid="financial-records-history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Project</th>
                    <th>Deposit</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((payment: PaymentRow) => {
                    const deposit = overview.find((row) => row.deposit_id === payment.deposit_id)
                    return (
                      <tr key={payment.id} data-testid="financial-records-payment-row">
                        <td>{formatDate(payment.payment_date)}</td>
                        <td>
                          <span className="admin-cell-truncate is-contact" title={deposit?.client_name || ''}>
                            {deposit?.client_name || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="admin-cell-truncate" title={deposit?.project_reference || ''}>
                            {deposit?.project_reference || deposit?.project_name || '—'}
                          </span>
                        </td>
                        <td>{deposit?.reference || '—'}</td>
                        <td>
                          <span className="admin-cell-truncate is-code" title={payment.reference}>
                            {payment.reference}
                          </span>
                        </td>
                        <td>{formatMoney(payment.amount_cents, deposit?.currency || 'ZAR')}</td>
                        <td>
                          <span className={`financial-payment-status is-${payment.status.toLowerCase()}`}>
                            {paymentStatusLabel(payment.status)}
                          </span>
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
    </div>
  )
}
