// Types shared by the payment-progress API and its UI.
// These mirror the existing database views/tables exactly — no new financial
// fields are introduced here.

export type DepositOverviewRow = {
  deposit_id: string
  reference: string | null
  project_id: string
  project_name: string | null
  project_reference: string | null
  client_id: string | null
  client_name: string | null
  currency: string | null
  due_date: string | null
  required_cents: number
  paid_cents: number
  outstanding_cents: number
  unconfirmed_count: number
  requirement_status: string | null
  notes: string | null
  status: string | null
  awaiting_confirmation: boolean
  is_overdue: boolean
  overdue_days: number
}

export type PaymentRow = {
  id: string
  deposit_id: string
  amount_cents: number
  payment_date: string
  method: string
  reference: string
  notes: string | null
  status: string
  recorded_at: string | null
}

export type FinancialResponse = {
  overview: DepositOverviewRow[]
  payments: PaymentRow[]
}
