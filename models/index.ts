// TypeScript models mirroring the Client Serving Portal database schema (SRS).

export type UserRole = 'administrator' | 'senior_dev_pm' | 'junior_developer'

export interface Profile {
  id: string
  full_name: string
  surname: string | null
  username: string | null
  role: UserRole
  is_active: boolean
  failed_login_count: number
  created_at: string
}

export interface Role {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface Permission {
  id: string
  code: string
  description: string | null
}

export interface Client {
  id: string
  client_code: string
  name: string
  email: string | null
  phone: string | null
  primary_contact: string | null
  billing_details: string | null
  created_by: string | null
  created_at: string
}

export interface ClientContact {
  id: string
  client_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export interface Project {
  id: string
  project_reference: string
  client_id: string
  name: string
  description: string | null
  stage: string
  status: string
  created_by: string | null
  created_at: string
}

export interface ProjectStageHistory {
  id: string
  project_id: string
  from_stage: string | null
  to_stage: string
  status: string | null
  changed_by: string | null
  changed_at: string
}

export interface DiscoveryRecord {
  id: string
  project_id: string
  meeting_date: string | null
  attendees: string | null
  summary: string | null
  notes: string | null
  transcript_ref: string | null
  created_by: string | null
  created_at: string
}

export interface Attachment {
  id: string
  owner_type: string
  owner_id: string
  file_name: string
  content_type: string | null
  size: number | null
  storage_ref: string
  uploaded_by: string | null
  uploaded_at: string
}

export interface Requirement {
  id: string
  project_id: string
  requirement_ref: string
  title: string
  description: string | null
  priority: string | null
  status: string
  current_version_id: string | null
  created_at: string
}

export interface RequirementVersion {
  id: string
  requirement_id: string
  version_no: number
  title: string
  description: string | null
  priority: string | null
  changed_by: string | null
  changed_at: string
}

export interface Document {
  id: string
  project_id: string
  type: string | null
  title: string
  current_revision_id: string | null
  status: string
  created_at: string
}

export interface DocumentRevision {
  id: string
  document_id: string
  revision_no: number
  storage_ref: string | null
  ai_generated: boolean
  created_by: string | null
  created_at: string
  status: string
}

export interface Review {
  id: string
  revision_id: string
  reviewer_id: string | null
  outcome: string | null
  comment: string | null
  review_date: string
}

export interface Approval {
  id: string
  revision_id: string
  approver_id: string | null
  decision: string | null
  comment: string | null
  approval_date: string
}

export interface Quotation {
  id: string
  project_id: string
  type: string
  title: string
  currency: string
  validity_date: string | null
  status: string
  current_revision_id: string | null
  created_at: string
}

export interface QuotationLineItem {
  id: string
  quotation_id: string
  description: string
  quantity: number
  unit_amount: number
  amount: number
  tax_rate: number
}

export interface SLA {
  id: string
  project_id: string
  terms: string | null
  start_date: string | null
  end_date: string | null
  document_ref: string | null
  created_at: string
}

export interface PurchaseOrder {
  id: string
  project_id: string
  po_number: string
  amount: number
  currency: string
  po_date: string | null
  document_ref: string | null
  created_at: string
}

export interface Deposit {
  id: string
  project_id: string
  amount: number
  currency: string
  due_date: string | null
  trigger: string | null
  status: string
  created_at: string
}

export interface PaymentConfirmation {
  id: string
  project_id: string
  deposit_id: string | null
  amount: number
  payment_date: string | null
  reference: string | null
  confirmed_by: string | null
  created_at: string
}

export interface ReadinessCheck {
  id: string
  project_id: string
  run_by: string | null
  run_at: string
  result: string | null
}

export interface ReadinessItem {
  id: string
  readiness_check_id: string
  criterion: string
  mandatory: boolean
  overridable: boolean
  result: string
  override_reason: string | null
  overridden_by: string | null
  created_at: string
}

export interface Assignment {
  id: string
  project_id: string
  developer_user_id: string | null
  assigned_by: string | null
  assigned_at: string
}

export interface Handover {
  id: string
  project_id: string
  scope_summary: string | null
  notes: string | null
  prepared_by: string | null
  prepared_at: string
}

export interface DevelopmentLink {
  id: string
  project_id: string
  link_type: string | null
  url: string
  recorded_by: string | null
  recorded_at: string
  verified: boolean
  verified_by: string | null
  verified_at: string | null
}

export interface AIRequest {
  id: string
  project_id: string
  capability: string | null
  provider: string | null
  requested_by: string | null
  requested_at: string
  result_ref: string | null
}

export interface Notification {
  id: string
  recipient_user_id: string | null
  project_id: string | null
  type: string | null
  message: string
  created_at: string
  read_at: string | null
}

export interface AuditEntry {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_value: unknown
  after_value: unknown
  created_at: string
}
