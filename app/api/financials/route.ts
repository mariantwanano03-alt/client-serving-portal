import { NextRequest, NextResponse } from 'next/server'
import { resolveCaller } from '@/lib/authz'
import type { DepositOverviewRow, FinancialResponse, PaymentRow } from '@/lib/financial-types'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// Always read the latest database values; never cache a financial snapshot.
export const dynamic = 'force-dynamic'

const OVERVIEW_SELECT = [
  'deposit_id',
  'reference',
  'project_id',
  'project_name',
  'project_reference',
  'client_id',
  'client_name',
  'currency',
  'due_date',
  'required_cents',
  'paid_cents',
  'outstanding_cents',
  'unconfirmed_count',
  'requirement_status',
  'notes',
  'status',
  'awaiting_confirmation',
  'is_overdue',
  'overdue_days',
].join(', ')

const PAYMENT_SELECT = [
  'id',
  'deposit_id',
  'amount_cents',
  'payment_date',
  'method',
  'reference',
  'notes',
  'status',
  'recorded_at',
].join(', ')

/**
 * GET /api/financials?projectId=<uuid>
 *
 * Read-only view over the existing `pts_deposit_overview` view and
 * `pts_payments` table. No financial values are computed or stored here.
 *
 * - All non-admin callers keep using their own Supabase client, so RLS remains
 *   the enforcement boundary (seniors see their authorised projects, scoped
 *   clients see their own, other roles see nothing they are entitled to).
 * - Active administrators use a trusted server-side client for read-only
 *   oversight. This follows the existing administrator oversight model: it
 *   grants no mutation capability and does not change any role's RLS policies.
 *
 * `projectId` is optional so the central Financial Records page can load all
 * records visible to the caller. Project-level views continue to pass it.
 */
export async function GET(req: NextRequest) {
  const { caller, response } = await resolveCaller(req)
  if (response) return response

  const projectId = new URL(req.url).searchParams.get('projectId')

  // Administrators are oversight-only readers here; the client never receives
  // the service-role key and this route exposes no write operations.
  const db = caller.role === 'administrator' ? getSupabaseAdmin() : caller.db

  let overviewQuery = db
    .from('pts_deposit_overview')
    .select(OVERVIEW_SELECT)
    .order('reference', { ascending: true })

  if (projectId) overviewQuery = overviewQuery.eq('project_id', projectId)

  const overviewResult = await overviewQuery
  if (overviewResult.error) {
    return NextResponse.json({ error: 'Could not load payment information.' }, { status: 500 })
  }

  const overview = (overviewResult.data ?? []) as unknown as DepositOverviewRow[]
  const depositIds = overview.map((row) => row.deposit_id)
  let payments: PaymentRow[] = []

  if (depositIds.length > 0) {
    const paymentResult = await db
      .from('pts_payments')
      .select(PAYMENT_SELECT)
      .in('deposit_id', depositIds)
      // VOID rows are excluded from the overview's paid_cents too, so they are
      // not actual payments and must not appear in payment history.
      .neq('status', 'VOID')
      .order('payment_date', { ascending: false })
      .order('recorded_at', { ascending: false })

    if (paymentResult.error) {
      return NextResponse.json({ error: 'Could not load payment history.' }, { status: 500 })
    }
    payments = (paymentResult.data ?? []) as unknown as PaymentRow[]
  }

  const body: FinancialResponse = { overview, payments }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
