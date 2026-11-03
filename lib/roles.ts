// Shared role capabilities and approval wording for the Client Serving Portal.

export const PENDING_APPROVAL_LABEL = 'Pending Review / Awaiting Senior Approval'
export const DRAFT_LABEL = 'Draft'
export const INTERNAL_REVIEW_PENDING_LABEL = 'Internal Review Pending'
export const APPROVED_INTERNAL_LABEL = 'Approved (Internal)'
export const INTERNAL_ONLY_LABEL = 'Approved (Internal Only)'
export const SENT_TO_CLIENT_LABEL = 'Sent to Client'

const PENDING_STATUSES = ['draft', 'pending', 'pending_review', 'submitted', 'awaiting_review']

/**
 * Document types that are auto-approved and never delivered to the client —
 * they live inside the portal only. Keyed on the `type` label the AI document
 * pipeline writes for Dev Prompt (.md) files.
 */
const INTERNAL_ONLY_DOC_TYPES = new Set(['prompt file'])

/**
 * Only a Senior Developer / PM can hold approval authority.
 */
export function canApproveDeliverables(role?: string | null): boolean {
  return role === 'senior_dev_pm'
}

/**
 * Approval is project-scoped: a Senior Developer / PM may only approve work on
 * a project where they are actively assigned and hold approval authority.
 * Administrators have global oversight but do not approve deliverables.
 */
export function canApproveProject(
  role?: string | null,
  hasProjectApprovalAuthority = false
): boolean {
  return canApproveDeliverables(role) && hasProjectApprovalAuthority
}

/**
 * Junior Developers may draft deliverables, but their work stays in review
 * until a Senior Developer / PM approves it.
 */
export function canDraftDeliverables(role?: string | null): boolean {
  return role === 'junior_developer' || canApproveDeliverables(role)
}

export function formatApprovalStatus(status?: string | null): string {
  const normalized = (status ?? '').trim().toLowerCase()

  // A draft (e.g. a project just created by the Senior Developer / PM) has not
  // been submitted for review yet, so it must not read as awaiting approval.
  if (normalized === 'draft') return DRAFT_LABEL

  if (!normalized || PENDING_STATUSES.includes(normalized)) {
    return PENDING_APPROVAL_LABEL
  }

  if (normalized === 'approved') return '✓ Approved'
  if (normalized === 'rejected') return '✕ Rejected'

  return normalized.replace(/_/g, ' ')
}

export function approvalBadgeClass(status?: string | null): string {
  const normalized = (status ?? '').trim().toLowerCase()

  if (normalized === 'approved') return 'portal-badge badge-green'
  if (normalized === 'rejected') return 'portal-badge badge-red'
  if (!normalized || PENDING_STATUSES.includes(normalized)) {
    return 'portal-badge badge-amber'
  }

  return 'portal-badge badge-gray'
}

export function formatLinkStatus(verified: boolean): string {
  return verified ? '✓ Verified' : PENDING_APPROVAL_LABEL
}

/**
 * Document statuses carry a client-delivery meaning on top of the internal
 * review state. An approval by the Senior Developer / PM is an internal
 * milestone only — the document becomes client-bound when it is sent to the
 * client. Pass the document's `type` so internal-only documents (Dev Prompt
 * .md files, never delivered to clients) are labelled accordingly.
 * AI-generated drafts are explicitly labelled as internal review
 * work until a Senior Developer / PM approves them.
 *
 * Per the PRD workflow, a document (or revision) is submitted for review as
 * soon as it is created / drafted, so draft statuses read as the pending
 * review notice. "Draft" is reserved for freshly created PROJECTS (§6.1 step 2),
 * which is why formatApprovalStatus keeps its own draft handling.
 */
export function formatDocumentStatus(
  status?: string | null,
  aiGenerated = false,
  documentType?: string | null
): string {
  const normalized = (status ?? '').trim().toLowerCase()

  // PRD §8.1: Draft = created but not submitted for review. A document is
  // only 'draft' while it has no submitted content; saving a revision (or
  // generating via AI) submits it for review, which then reads as the
  // pending-approval notice.
  if (normalized === 'draft') return DRAFT_LABEL

  if (!normalized || PENDING_STATUSES.includes(normalized)) {
    return aiGenerated ? INTERNAL_REVIEW_PENDING_LABEL : PENDING_APPROVAL_LABEL
  }

  if (normalized === 'approved') {
    // Dev Prompt (.md) files are auto-approved and never sent to the client,
    // so distinguish them from internal approvals that can still go out.
    if (documentType && INTERNAL_ONLY_DOC_TYPES.has(documentType.trim().toLowerCase())) {
      return INTERNAL_ONLY_LABEL
    }
    return APPROVED_INTERNAL_LABEL
  }
  if (normalized === 'sent_to_client') return SENT_TO_CLIENT_LABEL
  if (normalized === 'rejected') return '✕ Rejected'

  return normalized.replace(/_/g, ' ')
}

export function documentStatusBadgeClass(status?: string | null): string {
  const normalized = (status ?? '').trim().toLowerCase()

  if (normalized === 'approved') return 'portal-badge badge-green'
  if (normalized === 'sent_to_client') return 'portal-badge badge-blue'
  if (normalized === 'rejected') return 'portal-badge badge-red'
  if (!normalized || PENDING_STATUSES.includes(normalized)) {
    return 'portal-badge badge-amber'
  }

  return 'portal-badge badge-gray'
}

export function formatAiOrigin(model?: string | null, version?: string | null): string {
  const modelName = model?.trim() || 'Portal AI'
  const versionLabel = version?.trim()
  return versionLabel ? `${modelName} ${versionLabel}` : modelName
}
