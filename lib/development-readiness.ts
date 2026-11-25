import type { SupabaseClient } from '@supabase/supabase-js'
import { verifySignedSla, type SlaVerificationResult } from './sla-verification'

// SERVER-ONLY. Derives development readiness from existing records only:
// approved documents, the verified external SLA signature, and the existing
// deposit/purchase-order records. No new prerequisite or business record is
// invented here.

export type ReadinessPrerequisite = {
  key: 'requirements' | 'commercial' | 'sla' | 'financial'
  label: string
  complete: boolean
  detail: string
}

export type DevelopmentReadinessResult = {
  ready: boolean
  development: 'ready' | 'locked'
  clientAgreement: {
    verified: boolean
    label: string
    detail: string
    signedAt: string | null
  }
  prerequisites: ReadinessPrerequisite[]
}

type DocumentStatusRow = { type: string | null; status: string | null }
type DepositRow = {
  reference: string | null
  status: string | null
  requirement_status: string | null
  outstanding_cents: number | null
  awaiting_confirmation: boolean | null
}
type PurchaseOrderRow = { id: string; amount: number | null }

const SATISFIED_DEPOSIT_STATUSES = new Set(['confirmed', 'closed', 'paid', 'completed'])

function hasApprovedDocument(documents: DocumentStatusRow[], pattern: RegExp): boolean {
  return documents.some((doc) => pattern.test(doc.type || '') && doc.status === 'approved')
}

function financialPrerequisite(deposits: DepositRow[], purchaseOrders: PurchaseOrderRow[]): ReadinessPrerequisite {
  const activeDeposits = deposits.filter((row) => {
    const requirement = (row.requirement_status || '').toUpperCase()
    return requirement !== 'CANCELLED' && requirement !== 'VOID'
  })

  const depositsSatisfied = activeDeposits.every((row) => {
    const status = (row.status || '').trim().toLowerCase()
    const outstanding = Number(row.outstanding_cents) || 0
    return SATISFIED_DEPOSIT_STATUSES.has(status) || outstanding <= 0
  }) && !activeDeposits.some((row) => row.awaiting_confirmation === true)

  const purchaseOrderSatisfied = purchaseOrders.length === 0 || purchaseOrders.some((row) => (Number(row.amount) || 0) > 0)

  if (activeDeposits.length === 0 && purchaseOrders.length === 0) {
    return {
      key: 'financial',
      label: 'Deposit or purchase order requirements',
      complete: true,
      detail: 'No deposit or purchase order requirement is recorded.',
    }
  }

  if (activeDeposits.length === 0 && purchaseOrderSatisfied) {
    return {
      key: 'financial',
      label: 'Deposit or purchase order requirements',
      complete: true,
      detail: 'A purchase order is recorded for this project.',
    }
  }

  if (depositsSatisfied && purchaseOrderSatisfied) {
    return {
      key: 'financial',
      label: 'Deposit or purchase order requirements',
      complete: true,
      detail: activeDeposits.length
        ? 'The recorded deposit requirements are satisfied.'
        : 'The recorded purchase order requirement is satisfied.',
    }
  }

  const waitingDeposit = activeDeposits.find((row) => {
    const status = (row.status || '').trim().toLowerCase()
    const outstanding = Number(row.outstanding_cents) || 0
    return !SATISFIED_DEPOSIT_STATUSES.has(status) && outstanding > 0
  })

  const detail = waitingDeposit
    ? `Deposit ${waitingDeposit.reference || 'record'} is still outstanding or awaiting confirmation.`
    : 'A recorded purchase order requirement is incomplete.'

  return {
    key: 'financial',
    label: 'Deposit or purchase order requirements',
    complete: false,
    detail,
  }
}

export async function getDevelopmentReadiness(
  admin: SupabaseClient,
  projectId: string
): Promise<DevelopmentReadinessResult> {
  const [{ data: documents }, { data: deposits }, { data: purchaseOrders }] = await Promise.all([
    admin.from('documents').select('type, status').eq('project_id', projectId),
    admin
      .from('pts_deposit_overview')
      .select('reference, status, requirement_status, outstanding_cents, awaiting_confirmation')
      .eq('project_id', projectId),
    admin.from('purchase_orders').select('id, amount').eq('project_id', projectId),
  ])

  const documentRows = (documents || []) as DocumentStatusRow[]
  const sla: SlaVerificationResult = await verifySignedSla(admin, projectId)

  const prerequisites: ReadinessPrerequisite[] = [
    {
      key: 'requirements',
      label: 'Requirements confirmed',
      complete: hasApprovedDocument(documentRows, /requirements|prd|srs/i),
      detail: hasApprovedDocument(documentRows, /requirements|prd|srs/i)
        ? 'An approved requirements document is recorded.'
        : 'No approved requirements document is recorded.',
    },
    {
      key: 'commercial',
      label: 'Quotation or proposal approved',
      complete: hasApprovedDocument(documentRows, /quotation|proposal/i),
      detail: hasApprovedDocument(documentRows, /quotation|proposal/i)
        ? 'An approved quotation or proposal is recorded.'
        : 'No approved quotation or proposal is recorded.',
    },
    {
      key: 'sla',
      label: 'SLA signed by client',
      complete: sla.verified,
      detail: sla.message,
    },
    financialPrerequisite(
      (deposits || []) as DepositRow[],
      (purchaseOrders || []) as PurchaseOrderRow[]
    ),
  ]

  const ready = prerequisites.every((item) => item.complete)

  return {
    ready,
    development: ready ? 'ready' : 'locked',
    clientAgreement: {
      verified: sla.verified,
      label: sla.verified ? 'Client Approved & Agreed to Terms: ✓' : 'Client Approved & Agreed to Terms: ✗',
      detail: sla.verified ? 'SLA Signed: ✓' : 'SLA Awaiting Client Signature.',
      signedAt: sla.signedAt,
    },
    prerequisites,
  }
}
