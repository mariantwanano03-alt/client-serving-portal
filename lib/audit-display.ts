// Server-only presentation of audit records.
//
// Raw audit rows contain internal action codes, table names, UUIDs and JSON
// snapshots. Nothing in this module is allowed to leak those values to the UI:
// every returned string is a curated, human-readable description.

export type AuditLookups = {
  profiles: Map<string, { name: string; email: string | null }>
  projects: Map<string, string>
  clients: Map<string, string>
  documents: Map<string, string>
}

export type AuditDescription = {
  activityType: string
  summary: string
  subjectType: string
  subject: string
  affectsUser: boolean
  affectedUser: string | null
  context: string[]
}

type AuditRow = {
  action: string
  entity_type: string
  entity_id: string | null
  before_value: unknown
  after_value: unknown
}

const ROLE_LABELS: Record<string, string> = {
  administrator: 'Administrator',
  senior_dev_pm: 'Senior Developer / Project Manager',
  junior_developer: 'Junior Developer',
  client: 'Client',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  pending_role_assignment: 'Awaiting role assignment',
}

const ENTITY_LABELS: Record<string, string> = {
  profile: 'User account',
  user: 'User account',
  pts_users: 'User account',
  pts_staff: 'Staff member',
  client: 'Client',
  project: 'Project',
  document: 'Document',
  quotation: 'Quotation',
  discovery_meeting: 'Discovery meeting',
  pts_attachments: 'Attachment',
  pts_deposit_details: 'Deposit record',
  pts_milestones: 'Milestone',
  pts_payments: 'Payment record',
  pts_settings: 'Workspace setting',
  pts_user_scopes: 'Access scope',
}

const ACTION_LABELS: Record<string, string> = {
  'user.registered': 'Account registered',
  'user.default_role_assigned': 'Default role assigned',
  'user.account_activated': 'Account activated',
  'user.account_suspended': 'Pending account suspended',
  'user.admin_action_denied': 'Administrative change blocked',
  'user.role_assigned': 'Role assigned',
  'user.role_changed': 'Role changed',
  'user.role_reactivated': 'Account reactivated',
  'user.role_suspended': 'Account suspended',
  'document.generated': 'Document generated',
  'document.draft_created': 'Document draft created',
  'document.edited': 'Document edited',
  'document.submitted_for_review': 'Document submitted for review',
  'document.sent_to_client': 'Document sent to client',
  'document.approved': 'Document approved',
  'document.rejected': 'Document rejected',
  'sla.signature_verified': 'Signed SLA verified',
  'client.agreement_confirmed': 'Client agreement confirmed',
  'development.readiness_changed': 'Development readiness changed',
  'development.gate_denied': 'Development access blocked',
  'project.created': 'Project created',
  'project.created_provisional': 'Provisional project created',
  'project.created_from_meeting': 'Project created from meeting',
  'project.developer_assigned': 'Developer assigned',
  'project.development_started': 'Development started',
  'discovery_meeting.created': 'Discovery meeting recorded',
  'discovery_meeting.transcript_recorded': 'Transcript added',
  'discovery_meeting.transcript_processed': 'Transcript processed',
  'discovery_meeting.approved_existing_client': 'Meeting linked to client',
  'discovery_meeting.approved_client_created': 'Client created from meeting',
  'discovery_meeting.approved': 'Discovery meeting approved',
  'discovery_meeting.documents_generated': 'Documents generated from meeting',
  'discovery_meeting.rejected': 'Discovery meeting rejected',
  'pts_attachments.insert': 'Attachment added',
  'pts_attachments.download': 'Attachment downloaded',
  'pts_deposit_details.insert': 'Deposit record created',
  'pts_deposit_details.update': 'Deposit record updated',
  'pts_deposit_details.closed': 'Deposit record closed',
  'pts_milestones.insert': 'Milestone added',
  'pts_payments.insert': 'Payment recorded',
  'pts_payments.update': 'Payment updated',
  'pts_payments.confirmed': 'Payment confirmed',
  'pts_payments.void': 'Payment voided',
  'pts_settings.insert': 'Workspace setting added',
  'pts_settings.update': 'Workspace setting updated',
  'pts_staff.insert': 'Staff member added',
  'pts_staff.update': 'Staff sign-in recorded',
  'pts_user_scopes.insert': 'Access scope granted',
  'pts_user_scopes.delete': 'Access scope removed',
  'pts_users.insert': 'User account added',
  'pts_users.update': 'User account updated',
  'pts_users.delete': 'User account removed',
}

/** Human-facing activity types used by the filter dropdown. */
export const ACTIVITY_LABELS = Array.from(new Set(Object.values(ACTION_LABELS))).sort((a, b) => a.localeCompare(b))
/** Human-facing record types used by the filter dropdown. */
export const ENTITY_LABEL_LIST = Array.from(new Set(Object.values(ENTITY_LABELS))).sort((a, b) => a.localeCompare(b))

export function activityLabelFor(action: string) {
  return ACTION_LABELS[action] || 'Recorded activity'
}

export function entityLabelFor(entityType: string) {
  return ENTITY_LABELS[entityType] || 'Workspace record'
}

export function codesForActivityLabel(label: string) {
  return Object.keys(ACTION_LABELS).filter((code) => ACTION_LABELS[code] === label)
}

export function codesForEntityLabel(label: string) {
  return Object.keys(ENTITY_LABELS).filter((code) => ENTITY_LABELS[code] === label)
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function firstText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(source[key])
    if (value) return value
  }
  return ''
}

function money(cents: unknown) {
  const amount = Number(cents)
  if (!Number.isFinite(amount)) return ''
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ZAR`
  }
}

function formatAuditDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'the recorded date' : date.toLocaleDateString('en-ZA')
}

function role(value: unknown) {
  const raw = text(value)
  return ROLE_LABELS[raw] || ''
}

function status(value: unknown) {
  const raw = text(value)
  return STATUS_LABELS[raw] || ''
}

function person(id: unknown, lookups: AuditLookups, fallback = '') {
  const key = text(id)
  const found = key ? lookups.profiles.get(key) : undefined
  if (found) return found.name || found.email || 'a user account'
  if (fallback) return fallback
  return key ? 'a former user account' : 'a user account'
}

function projectLabel(id: unknown, payload: Record<string, unknown>, lookups: AuditLookups) {
  const key = text(id)
  return (key && lookups.projects.get(key)) ||
    firstText(payload, ['project_name', 'project_reference', 'project']) ||
    'a project'
}

function clientLabel(id: unknown, payload: Record<string, unknown>, lookups: AuditLookups) {
  const key = text(id)
  return (key && lookups.clients.get(key)) ||
    firstText(payload, ['client_name', 'client']) ||
    'a client'
}

function documentLabel(id: unknown, payload: Record<string, unknown>, lookups: AuditLookups) {
  const key = text(id)
  return (key && lookups.documents.get(key)) ||
    firstText(payload, ['title', 'document_title']) ||
    'a document'
}

function paymentReference(...sources: Record<string, unknown>[]) {
  for (const source of sources) {
    const value = firstText(source, ['reference'])
    if (value) return value
  }
  return 'a payment record'
}

function depositReference(...sources: Record<string, unknown>[]) {
  for (const source of sources) {
    const value = firstText(source, ['reference'])
    if (value) return value
  }
  return 'a deposit record'
}

export function affectedUserId(row: AuditRow): string | null {
  const after = record(row.after_value)
  const before = record(row.before_value)
  switch (row.action) {
    case 'user.registered':
    case 'user.default_role_assigned':
    case 'user.admin_action_denied':
    case 'user.account_activated':
    case 'user.account_suspended':
    case 'user.role_assigned':
    case 'user.role_changed':
    case 'user.role_reactivated':
    case 'user.role_suspended':
      return row.entity_id
    case 'pts_users.insert':
    case 'pts_users.update':
    case 'pts_users.delete':
    case 'pts_staff.insert':
    case 'pts_staff.update':
      return firstText(after, ['user_id']) || firstText(before, ['user_id']) || row.entity_id || null
    case 'pts_user_scopes.insert':
    case 'pts_user_scopes.delete':
      return firstText(after, ['user_id']) || firstText(before, ['user_id']) || null
    case 'project.developer_assigned':
      return firstText(after, ['developer_user_id']) || null
    default:
      return null
  }
}

function denyReason(reason: string) {
  if (reason === 'self_modification_denied') return 'attempted self-modification'
  if (reason === 'last_active_administrator') return 'attempted change to the last administrator'
  return ''
}

export function describeAudit(row: AuditRow, lookups: AuditLookups): AuditDescription {
  const before = record(row.before_value)
  const after = record(row.after_value)
  const subjectType = entityLabelFor(row.entity_type)
  const affectedId = affectedUserId(row)
  const affectedUser = affectedId ? person(affectedId, lookups, firstText(after, ['full_name']) || firstText(before, ['full_name'])) : null

  // Final safety net: free-text values from stored snapshots must never carry
  // UUIDs or internal event/column names into the UI.
  const clean = (value: string) => value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'a record')
    .replace(/\b(?:pts_[a-z_]+|(?:user|project|document|discovery_meeting|sla|client|development)\.[a-z_]+)\b/gi, 'a record')

  const base = (summary: string, subject: string, context: string[] = []): AuditDescription => ({
    activityType: activityLabelFor(row.action),
    summary: clean(summary),
    subjectType,
    subject: clean(subject),
    affectsUser: Boolean(affectedId),
    affectedUser: affectedUser ? clean(affectedUser) : null,
    context: context.filter(Boolean).map(clean),
  })

  switch (row.action) {
    case 'user.registered':
      return base(`New account registered for ${affectedUser || 'a new user'}.`, affectedUser || 'a new user')
    case 'user.default_role_assigned':
      return base(
        `Assigned ${affectedUser || 'a new user'} the default ${role(after.role) || 'starter'} role.`,
        affectedUser || 'a new user',
      )
    case 'user.admin_action_denied': {
      const reason = denyReason(firstText(after, ['reason']))
      return base(
        `Blocked an attempt to change ${affectedUser || "a user's"} account${reason ? ` (${reason})` : ''}.`,
        affectedUser || 'a user account',
      )
    }
    case 'user.role_assigned':
      return base(
        `Assigned ${affectedUser || 'a user'} the ${role(firstText(after, ['new_role']) || after.role) || 'new'} role.`,
        affectedUser || 'a user account',
        status(after.account_status) ? [`Account status: ${status(after.account_status)}`] : [],
      )
    case 'user.account_activated':
      return base(`Activated ${affectedUser || "a user's"} account.`, affectedUser || 'a user account')
    case 'user.role_changed':
      return base(
        `Changed ${affectedUser || "a user's"} role to ${role(after.role) || 'the selected role'}.`,
        affectedUser || 'a user account',
        status(after.account_status) ? [`Account status: ${status(after.account_status)}`] : [],
      )
    case 'user.role_reactivated':
      return base(`Reactivated ${affectedUser || "a user's"} account.`, affectedUser || 'a user account')
    case 'user.role_suspended':
      return base(`Suspended ${affectedUser || "a user's"} account.`, affectedUser || 'a user account')
    case 'user.account_suspended':
      return base(`Suspended ${affectedUser || "a pending user's"} account.`, affectedUser || 'a user account')

    case 'document.generated': {
      const title = firstText(after, ['title'])
      const project = projectLabel(firstText(after, ['project_id']), after, lookups)
      return base(`Generated ${title ? `the document ${title}` : 'a document'} for ${project}.`, title || 'a document')
    }
    case 'document.sent_to_client': {
      const title = firstText(after, ['document_title', 'title'])
      const project = projectLabel(firstText(after, ['project_id']), after, lookups)
      const failed = Boolean(after.delivery_status === 'failed' || after.sent === false)
      return base(
        failed
          ? `Document delivery failed for ${title || 'a document'} on ${project}.`
          : `Sent ${title || 'a document'} to the client for ${project}.`,
        title || 'a document',
      )
    }
    case 'document.draft_created': {
      const title = firstText(after, ['title'])
      return base(`Created an editable draft${title ? ` for ${title}` : ''}.`, title || 'a document')
    }
    case 'document.edited': {
      const title = firstText(after, ['title'])
      return base(`Saved edits${title ? ` to ${title}` : ''} inside the portal.`, title || 'a document')
    }
    case 'document.submitted_for_review': {
      const title = firstText(after, ['title'])
      return base(`Submitted ${title || 'a document'} for senior review.`, title || 'a document')
    }
    case 'document.approved':
    case 'document.rejected': {
      const label = documentLabel(row.entity_id, after, lookups)
      return base(`${row.action.endsWith('approved') ? 'Approved' : 'Rejected'} ${label}.`, label)
    }
    case 'sla.signature_verified': {
      const project = projectLabel(row.entity_id, after, lookups)
      const verifiedDate = firstText(after, ['verified_date'])
      return base(
        `Confirmed the client's signed SLA for ${project}${verifiedDate ? ` with a verified date of ${formatAuditDate(verifiedDate)}` : ''}.`,
        project,
      )
    }
    case 'client.agreement_confirmed': {
      const project = projectLabel(row.entity_id, after, lookups)
      return base(`Confirmed the client agreement for ${project}.`, project)
    }
    case 'development.readiness_changed': {
      const project = projectLabel(row.entity_id, after, lookups)
      const outcome = firstText(after, ['outcome']) === 'ready' ? 'ready' : 'locked'
      return base(`Development readiness for ${project} changed to ${outcome}.`, project)
    }
    case 'development.gate_denied': {
      const project = projectLabel(row.entity_id, after, lookups)
      return base(`Blocked an attempt to begin development on ${project} before prerequisites were complete.`, project)
    }
    case 'project.development_started': {
      const project = projectLabel(row.entity_id, after, lookups)
      return base(`Started development on ${project}.`, project)
    }
    case 'project.created':
    case 'project.created_provisional': {
      const label = projectLabel(row.entity_id, after, lookups)
      return base(
        row.action.endsWith('provisional')
          ? `Created a provisional project, ${label}.`
          : `Created project ${label}.`,
        label,
      )
    }
    case 'project.created_from_meeting': {
      const label = projectLabel(row.entity_id, after, lookups)
      const count = Number(after.documents)
      return base(
        `Created project ${label} from a discovery meeting${Number.isFinite(count) && count > 0 ? ` with ${count} documents` : ''}.`,
        label,
      )
    }
    case 'project.developer_assigned': {
      const project = projectLabel(row.entity_id, after, lookups)
      return base(`Assigned ${affectedUser || 'a developer'} to ${project}.`, project)
    }

    case 'discovery_meeting.created':
    case 'discovery_meeting.approved':
    case 'discovery_meeting.approved_existing_client':
    case 'discovery_meeting.approved_client_created': {
      const client = clientLabel(firstText(after, ['client_id']), after, lookups)
      const verb =
        row.action.endsWith('created') ? 'Recorded a discovery meeting for' :
        row.action.endsWith('approved_existing_client') ? 'Approved a discovery meeting and linked it to' :
        row.action.endsWith('approved_client_created') ? 'Approved a discovery meeting and created client' :
        'Approved a discovery meeting for'
      return base(`${verb} ${client}.`, 'a discovery meeting')
    }
    case 'discovery_meeting.transcript_recorded':
      return base('Added a transcript to a discovery meeting.', 'a discovery meeting')
    case 'discovery_meeting.transcript_processed':
      return base('Processed a discovery meeting transcript.', 'a discovery meeting')
    case 'discovery_meeting.documents_generated':
      return base(
        `Generated documents for ${projectLabel(firstText(after, ['project_id']), after, lookups)}.`,
        'a project',
      )
    case 'discovery_meeting.rejected':
      return base('Rejected a discovery meeting.', 'a discovery meeting')

    case 'pts_attachments.insert': {
      const name = firstText(after, ['file_name'])
      return base(`Added ${name ? `attachment ${name}` : 'an attachment'} to a payment record.`, name || 'an attachment')
    }
    case 'pts_attachments.download': {
      const name = firstText(after, ['file_name'])
      return base(`Downloaded ${name ? `attachment ${name}` : 'an attachment'}.`, name || 'an attachment')
    }
    case 'pts_deposit_details.insert': {
      const reference = depositReference(after)
      return base(`Created deposit record ${reference}.`, reference)
    }
    case 'pts_deposit_details.update': {
      const reference = depositReference(after, before)
      return base(`Updated deposit record ${reference}.`, reference, money(firstText(after, ['total_cents']) || firstText(before, ['total_cents'])) ? [`Amount: ${money(after.total_cents ?? before.total_cents)}`] : [])
    }
    case 'pts_deposit_details.closed': {
      const reference = depositReference(after, before)
      const reason = firstText(after, ['closed_reason'])
      return base(`Closed deposit record ${reference}${reason ? ` (${reason})` : ''}.`, reference)
    }
    case 'pts_milestones.insert': {
      const label = firstText(after, ['label'])
      return base(
        `Added ${label ? `milestone ${label}` : 'a milestone'}${money(after.amount_cents) ? ` (${money(after.amount_cents)})` : ''}.`,
        label || 'a milestone',
      )
    }
    case 'pts_payments.insert': {
      const reference = paymentReference(after)
      return base(
        `Recorded payment ${reference}${money(after.amount_cents) ? ` (${money(after.amount_cents)})` : ''}.`,
        reference,
      )
    }
    case 'pts_payments.update':
      return base('Updated a payment record.', paymentReference(after, before))
    case 'pts_payments.confirmed':
      return base(`Confirmed payment ${paymentReference(after, before)}.`, paymentReference(after, before))
    case 'pts_payments.void': {
      const reference = paymentReference(after, before)
      const reason = firstText(after, ['void_reason'])
      return base(`Voided payment ${reference}${reason ? ` (${reason})` : ''}.`, reference)
    }
    case 'pts_settings.insert':
      return base('A workspace setting was added.', 'a workspace setting')
    case 'pts_settings.update':
      return base('A workspace setting was updated.', 'a workspace setting')
    case 'pts_staff.insert':
      return base(`Added ${affectedUser || 'a user'} as a staff member.`, affectedUser || 'a staff member')
    case 'pts_staff.update':
      return base(`Recorded a sign-in for ${affectedUser || 'a staff member'}.`, affectedUser || 'a staff member')

    case 'pts_user_scopes.insert': {
      const scope = firstText(after, ['project_id'])
        ? projectLabel(firstText(after, ['project_id']), after, lookups)
        : clientLabel(firstText(after, ['client_id']), after, lookups)
      return base(`Granted ${affectedUser || 'a user'} access to ${scope}.`, 'an access scope')
    }
    case 'pts_user_scopes.delete': {
      const scope = firstText(before, ['project_id'])
        ? projectLabel(firstText(before, ['project_id']), before, lookups)
        : clientLabel(firstText(before, ['client_id']), before, lookups)
      return base(`Removed ${affectedUser || "a user's"} access to ${scope}.`, 'an access scope')
    }
    case 'pts_users.insert': {
      const name = affectedUser || firstText(after, ['full_name']) || 'a user'
      return base(`Added ${name} to the workspace.`, name)
    }
    case 'pts_users.update': {
      const name = affectedUser || firstText(after, ['full_name']) || 'a user'
      return base(`Updated the details for ${name}.`, name)
    }
    case 'pts_users.delete': {
      const name = affectedUser || firstText(before, ['full_name']) || 'a former user account'
      return base(`Removed ${name} from the workspace.`, name)
    }
    default:
      return base('An activity was recorded.', genericSubject(subjectType))
  }
}

function genericSubject(subjectType: string) {
  const subjects: Record<string, string> = {
    'User account': 'a user account',
    'Staff member': 'a staff member',
    Client: 'a client',
    Project: 'a project',
    Document: 'a document',
    Quotation: 'a quotation',
    'Discovery meeting': 'a discovery meeting',
    Attachment: 'an attachment',
    'Deposit record': 'a deposit record',
    Milestone: 'a milestone',
    'Payment record': 'a payment record',
    'Workspace setting': 'a workspace setting',
    'Access scope': 'an access scope',
  }
  return subjects[subjectType] || 'a workspace record'
}
