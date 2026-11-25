// Shared, client-safe formatting for every financial surface. Keeping these
// helpers in one place makes the central Financial Records page and the
// project-level Financials tab render the same values from the same source data.

import type { DepositOverviewRow } from '@/lib/financial-types'

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted'

export type DisplayStatus = {
  label: string
  tone: StatusTone
  complete?: boolean
  overdue?: boolean
}

export function formatMoney(cents: number | null | undefined, currency: string | null | undefined) {
  const amount = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency || 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `ZAR ${amount.toFixed(2)}`
  }
}

export function formatDate(value: string | null | undefined) {
  if (!value) return 'Not specified'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Map the database status/flags to the four states shown in the UI. */
export function displayStatus(row: DepositOverviewRow): DisplayStatus {
  if (row.status === 'CANCELLED') return { label: 'Cancelled', tone: 'muted' }
  if (row.status === 'DRAFT') return { label: 'Draft', tone: 'muted' }

  const required = Number(row.required_cents) || 0
  const paid = Number(row.paid_cents) || 0
  if (required > 0 && paid >= required) {
    return { label: 'Paid', tone: 'success', complete: true }
  }
  if (row.is_overdue) {
    return { label: 'Overdue', tone: 'danger', overdue: true }
  }
  if (paid <= 0 || row.status === 'AWAITING_PAYMENT') {
    return { label: 'Unpaid', tone: 'warning' }
  }
  return { label: 'Partially Paid', tone: 'warning' }
}

export function paymentStatusLabel(status: string) {
  switch (status) {
    case 'CONFIRMED':
      return 'Paid'
    case 'RECORDED':
      return 'Recorded'
    case 'VOID':
      return 'Void'
    default:
      return status
  }
}
