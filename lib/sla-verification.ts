import type { SupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY. Reads the sister system's `signed_documents` table through the
// trusted server client only after the caller has passed the project-access
// gate. No filename, upload, sent status or bare timestamp is treated as a
// signature.

export type SlaState = 'signed' | 'awaiting_signature' | 'in_progress' | 'unconfirmed' | 'invalidated'

export type SlaVerificationResult = {
  verified: boolean
  state: SlaState
  signedAt: string | null
  message: string
}

type SignedDocumentRow = {
  id: string
  external_status: string | null
  external_pulled_at: string | null
  created_at: string | null
  updated_at: string | null
  source_document_id: string | null
  revision_id: string | null
}

type SlaDocumentRow = {
  id: string
  type: string | null
  status: string | null
}

// Only an explicit completion status from the sister system can establish a
// signature. Unknown or ambiguous values deliberately fail closed.
const SIGNED_STATUSES = new Set([
  'signed',
  'completed',
  'fully_signed',
  'signature_complete',
  'signature_completed',
  'agreement_signed',
  'executed',
])

const INVALID_STATUSES = new Set([
  'cancelled',
  'canceled',
  'replaced',
  'invalidated',
  'superseded',
  'void',
  'voided',
  'declined',
  'rejected',
  'expired',
])

const IN_PROGRESS_STATUSES = new Set([
  'in_progress',
  'pending',
  'awaiting_signature',
  'sent',
  'sent_to_client',
  'ready_to_pull',
  'pulled',
  'downloaded',
  'shared',
])

function normalizeStatus(value: string | null): string {
  if (!value) return ''
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function sortTime(row: SignedDocumentRow): string {
  return row.external_pulled_at || row.updated_at || row.created_at || ''
}

function compareRows(a: SignedDocumentRow, b: SignedDocumentRow): number {
  const byActivity = sortTime(b).localeCompare(sortTime(a))
  if (byActivity !== 0) return byActivity
  return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
}

function result(state: SlaState, message: string, signedAt: string | null = null): SlaVerificationResult {
  return { verified: state === 'signed', state, message, signedAt }
}

export async function verifySignedSla(
  admin: SupabaseClient,
  projectId: string
): Promise<SlaVerificationResult> {
  const { data: projectDocuments } = await admin
    .from('documents')
    .select('id, type, status')
    .eq('project_id', projectId)

  const slaDocuments = (projectDocuments || []).filter((doc) =>
    /sla|service\s*level\s*agreement/i.test(doc.type || '')
  ) as SlaDocumentRow[]

  if (slaDocuments.length === 0) {
    return result('awaiting_signature', 'SLA Awaiting Client Signature. No SLA draft has been generated for this project.')
  }

  const slaDocumentIds = slaDocuments.map((doc) => doc.id)
  let slaRevisionIds: string[] = []
  const { data: revisions } = await admin
    .from('document_revisions')
    .select('id, document_id')
    .in('document_id', slaDocumentIds)
  slaRevisionIds = (revisions || []).map((revision) => revision.id)

  const { data: signedRows } = await admin
    .from('signed_documents')
    .select('id, external_status, external_pulled_at, created_at, updated_at, source_document_id, revision_id')
    .eq('project_id', projectId)

  const candidates = (signedRows || []).filter((row) => {
    const byDocument = Boolean(row.source_document_id && slaDocumentIds.includes(row.source_document_id))
    const byRevision = Boolean(row.revision_id && slaRevisionIds.includes(row.revision_id))
    return byDocument || byRevision
  }) as SignedDocumentRow[]

  if (candidates.length === 0) {
    return result('awaiting_signature', 'SLA Awaiting Client Signature. No matching signed record is available.')
  }

  // The latest record for this SLA determines the current agreement state. An
  // older signed record cannot keep development unlocked after a replacement,
  // cancellation or a new in-progress signing attempt.
  const latest = [...candidates].sort(compareRows)[0]
  const status = normalizeStatus(latest.external_status)

  if (INVALID_STATUSES.has(status)) {
    return result('invalidated', 'The SLA was cancelled, replaced or invalidated. Client agreement is not confirmed.')
  }

  if (SIGNED_STATUSES.has(status)) {
    if (!latest.external_pulled_at) {
      return result('unconfirmed', 'The sister system has not supplied a verified signing completion date. Development remains locked.')
    }
    return result('signed', 'SLA Signed: ✓ Client signed through the external signing service.', latest.external_pulled_at)
  }

  if (IN_PROGRESS_STATUSES.has(status)) {
    return result('in_progress', 'SLA signing is in progress. Development remains locked.')
  }

  return result('unconfirmed', 'SLA Awaiting Client Signature. The signing status could not be verified.')
}
