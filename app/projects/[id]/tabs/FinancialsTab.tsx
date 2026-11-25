'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { FinancialResponse, PaymentRow } from '@/lib/financial-types'
import { displayStatus, formatDate, formatMoney, paymentStatusLabel } from '@/lib/financial-format'

type FinancialsTabProps = {
  projectId: string
}

export default function FinancialsTab({ projectId }: FinancialsTabProps) {
  const [data, setData] = useState<FinancialResponse>({ overview: [], payments: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setError('Your session has expired. Please sign in again.')
        return
      }

      const response = await fetch(`/api/financials?projectId=${encodeURIComponent(projectId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || 'Could not load payment information.')
        return
      }
      setData({
        overview: Array.isArray(payload.overview) ? payload.overview : [],
        payments: Array.isArray(payload.payments) ? payload.payments : [],
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load payment information.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // Defer the initial read to a task: no setState runs synchronously in the
    // effect body, and StrictMode's first cleanup cancels the duplicate read.
    const timeout = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const { overview, payments } = data

  return (
    <div className="financials-tab" data-testid="financials-tab">
      <div className="financials-toolbar">
        <div>
          <h2 className="financials-heading">Financial Overview</h2>
          <p className="financials-subheading">
            Deposit balances and payment history from the portal financial records.
          </p>
        </div>
        <button
          type="button"
          className="portal-btn-secondary financials-refresh"
          data-testid="financials-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="financials-loading" data-testid="financials-loading">
          Loading payment information…
        </div>
      )}

      {!loading && error && (
        <div className="financials-error" role="alert" data-testid="financials-error">
          {error}
        </div>
      )}

      {!loading && !error && overview.length === 0 && (
        <div className="financials-empty" data-testid="financials-empty">
          <span className="financials-empty-icon" aria-hidden="true">◇</span>
          <strong>Payment information unavailable</strong>
          <span>There is no deposit record for this project yet.</span>
        </div>
      )}

      {!loading && !error && overview.map((row) => {
        const status = displayStatus(row)
        const required = Number(row.required_cents) || 0
        const paid = Number(row.paid_cents) || 0
        const remaining = Math.max(Number(row.outstanding_cents) || 0, 0)
        const percent = required > 0
          ? Math.min(100, Math.max(0, Math.round((paid / required) * 100)))
          : 0
        const rowPayments = payments.filter((payment) => payment.deposit_id === row.deposit_id)

        return (
          <section
            className="financial-card"
            data-testid="financial-overview"
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
              </div>
              <span
                className={`financial-status financial-status-${status.tone}`}
                data-testid="financial-status"
              >
                {status.label}
              </span>
            </header>

            <div className="financial-progress-block">
              <div className="financial-progress-labels">
                <span data-testid="financial-paid">{formatMoney(paid, row.currency)}</span>
                <span className="financial-progress-of">paid of</span>
                <span data-testid="financial-required">{formatMoney(required, row.currency)}</span>
                <span className="financial-progress-percent" data-testid="financial-percentage">
                  {percent}%
                </span>
              </div>
              <div
                className="financial-progress-track"
                data-testid="financial-progress"
                role="progressbar"
                aria-label="Payment progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className={`financial-progress-fill${status.complete ? ' is-complete' : ''}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className={`financial-remaining${status.complete ? ' is-complete' : ''}`} data-testid="financial-remaining">
                {status.complete
                  ? 'Nothing remaining'
                  : `${formatMoney(remaining, row.currency)} remaining`}
              </p>
            </div>

            {(status.complete || status.overdue) && (
              <div
                className={`financial-state-callout ${status.complete ? 'is-complete' : 'is-overdue'}`}
                data-testid={status.complete ? 'financial-complete' : 'financial-overdue'}
              >
                <span aria-hidden="true">{status.complete ? '✓' : '!'}</span>
                {status.complete ? 'Payment Complete' : 'Payment Overdue'}
              </div>
            )}

            <div className="financial-stats">
              <div className="financial-stat">
                <span className="financial-stat-label">Amount Required</span>
                <strong data-testid="stat-required">{formatMoney(required, row.currency)}</strong>
              </div>
              <div className="financial-stat">
                <span className="financial-stat-label">Amount Paid</span>
                <strong data-testid="stat-paid">{formatMoney(paid, row.currency)}</strong>
              </div>
              <div className="financial-stat">
                <span className="financial-stat-label">Amount Remaining</span>
                <strong data-testid="stat-remaining">{formatMoney(remaining, row.currency)}</strong>
              </div>
              <div className="financial-stat">
                <span className="financial-stat-label">Due Date</span>
                <strong data-testid="financial-due-date">{formatDate(row.due_date)}</strong>
              </div>
            </div>

            <div className="financial-history">
              <h4 className="financial-history-heading">Payment History</h4>
              {rowPayments.length === 0 ? (
                <p className="financial-history-empty" data-testid="payment-history-empty">
                  No payments recorded yet
                </p>
              ) : (
                <div className="financial-table-wrap">
                  <table className="financial-table" data-testid="payment-history">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowPayments.map((payment: PaymentRow) => (
                        <tr key={payment.id} data-testid="payment-row">
                          <td>{formatDate(payment.payment_date)}</td>
                          <td className="financial-table-amount">
                            {formatMoney(payment.amount_cents, row.currency)}
                          </td>
                          <td className="financial-table-reference">{payment.reference}</td>
                          <td>
                            <span className={`financial-payment-status is-${payment.status.toLowerCase()}`}>
                              {paymentStatusLabel(payment.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
