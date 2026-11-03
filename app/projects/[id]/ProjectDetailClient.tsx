'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'
import {
  approvalBadgeClass,
  canApproveProject,
  canDraftDeliverables,
  documentStatusBadgeClass,
  formatAiOrigin,
  formatApprovalStatus,
  formatDocumentStatus,
  formatLinkStatus,
} from '@/lib/roles'

type Project = {
  id: string
  client_id: string
  project_reference: string
  name: string
  description: string | null
  stage: string
  status: string
  clients: { client_code: string; name: string } | null
}

type Discovery = {
  id: string
  meeting_date: string | null
  summary: string | null
  notes: string | null
  audio_url?: string | null
  transcript?: string | null
  transcription_status?: string | null
  status?: string | null
  created_at?: string
}

type Requirement = {
  id: string
  requirement_ref: string
  title: string
  priority: string | null
  status: string
  created_at?: string
}

type Quotation = {
  id: string
  title: string
  currency: string
  status: string
  validity_date: string | null
  created_at?: string
  quotation_line_items?: QuotationLineItem[]
}

type QuotationLineItem = {
  id?: string
  description: string
  quantity: number
  unit_amount: number
  amount: number
  tax_rate: number
}

type Deposit = {
  id: string
  amount: number
  currency: string
  due_date: string | null
  trigger: string | null
  status: string
  external_reference?: string | null
  verified_at?: string | null
  verified_by_provider?: string | null
}

type PaymentConfirmation = {
  id: string
  deposit_id: string | null
  amount: number
  reference: string | null
  provider: string | null
  external_reference: string | null
  actor_type: string | null
  confirmed_by: string | null
  verified_at: string | null
  created_at: string
}

type PurchaseOrder = {
  id: string
  po_number: string
  amount: number
  currency: string
  po_date: string | null
}

type DocumentRecord = {
  id: string
  title: string
  type: string | null
  status: string
  current_revision_id?: string | null
  sent_to_client_at?: string | null
  sent_to_client_by?: string | null
  created_at?: string
  document_revisions?: DocumentRevision[]
}

type DocumentRevision = {
  id: string
  revision_no: number
  ai_generated: boolean
  status: string
  content?: string | null
  storage_ref?: string | null
  ai_model?: string | null
  ai_model_version?: string | null
  ai_generated_at?: string | null
  created_at?: string
}

type ReadinessCheck = {
  id: string
  result: string | null
  readiness_items?: ReadinessItem[]
}

function getCurrentRevision(doc: DocumentRecord): DocumentRevision | undefined {
  return (
    doc.document_revisions?.find((revision) => revision.id === doc.current_revision_id) ||
    doc.document_revisions?.[0]
  )
}

const AI_ORIGIN_MODEL = 'Portal AI'
const AI_ORIGIN_VERSION = 'v1'

function formatGeneratedAt(value?: string | null): string {
  if (!value) return 'Generation time not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Generation time not recorded'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatVerifiedAt(value?: string | null): string {
  if (!value) return 'Time not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time not recorded'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type DiffLine = {
  type: 'same' | 'added' | 'removed'
  text: string
}

function buildLineDiff(previous: string, current: string): DiffLine[] {
  const before = previous.split('\n')
  const after = current.split('\n')
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  )

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ type: 'same', text: before[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: 'removed', text: before[i] })
      i += 1
    } else {
      lines.push({ type: 'added', text: after[j] })
      j += 1
    }
  }

  while (i < before.length) {
    lines.push({ type: 'removed', text: before[i] })
    i += 1
  }
  while (j < after.length) {
    lines.push({ type: 'added', text: after[j] })
    j += 1
  }

  return lines
}

type ReadinessItem = {
  id: string
  criterion: string
  mandatory: boolean
  overridable: boolean
  result: string
  override_reason?: string | null
}

type Assignment = {
  id: string
  developer_user_id: string | null
  assignment_role: 'lead' | 'developer'
  approval_authority: boolean
  is_active: boolean
  assigned_at: string
}

type Handover = {
  id: string
  scope_summary: string | null
  notes: string | null
  prepared_at: string
}

type DevLink = {
  id: string
  link_type: string | null
  url: string
  verified: boolean
}

function isRepositoryLink(link: Pick<DevLink, 'link_type' | 'url'>): boolean {
  const type = (link.link_type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
  const url = link.url.trim().toLowerCase()

  return type.includes('repository') || type.includes('github') || type === 'git' ||
    /(?:github\.com|gitlab\.com|bitbucket\.org)/.test(url)
}

type Profile = {
  id: string
  full_name: string
  role: string
  is_active?: boolean
}

const PROJECT_STAGES = [
  { id: 'discovery', label: '1. Discovery' },
  { id: 'scoping', label: '2. Scoping' },
  { id: 'commercial', label: '3. Commercial' },
  { id: 'readiness', label: '4. Readiness' },
  { id: 'development', label: '5. Development' },
  { id: 'handover', label: '6. Handover' },
  { id: 'completed', label: '7. Completed' },
]

function getBlankTemplate(type: string) {
  if (type === 'Quotation') {
    return `QUOTATION\n\nQUOTATION NO: XS-2026-[Quote Number]\nDATE: [DD/MM/YYYY]\nVALID UNTIL: [DD/MM/YYYY] (Valid for 30 Days)\nCURRENCY: ZAR (R)\n\n1. COMPANY DETAILS\nService Provider: X Spark (Pty) Ltd\nRegistration No: [Registration Number]\nB-BBEE Status: Level 1 Contributor\nCertifications: ISO/IEC 27001 Certified\nAddress: 546 16th Road, Building 2, Constantia Park, Midrand, Johannesburg, 1685, South Africa\nContact Person: Khaya Cokoto (CEO)\nEmail: info@xspark.co.za / khaya@xspark.co.za\nWebsite: www.xspark.co.za\n\n2. CLIENT DETAILS\nClient Name: [Client Representative Name]\nCompany: [Client Company Name]\nAddress: [Client Physical Address]\nEmail: [Client Email Address]\nPhone: [Client Phone Number]\n\n3. PROJECT OVERVIEW & SCOPE\nProject Name: [Project/Application Name]\nDescription: [Custom Business Logic / Mobile Application / AI Integration]\nScope of Work Included:\n• Phase 1: UI/UX Design & Architecture Blueprints\n• Phase 2: Core Frontend & Backend Software Development\n• Phase 3: Third-party System API Integrations\n• Phase 4: Quality Assurance, ISO 27001 Compliance Testing & Data Security Audits\n• Phase 5: Deployment (AWS/Azure Cloud Infrastructure) & UAT Signing\n\n4. COST BREAKDOWN\nItem # | Phase / Deliverable Description | Est. Hours | Rate (ZAR/hr) | Total (Excl. VAT)\n1 | Discovery, Architecture & UI/UX Design | [00] | [R 0.00] | [R 0.00]\n2 | Core Software Development (Frontend/Backend) | [00] | [R 0.00] | [R 0.00]\n3 | AI / Fintech Integrations (if applicable) | [00] | [R 0.00] | [R 0.00]\n4 | QA, Security Auditing & Compliance Testing | [00] | [R 0.00] | [R 0.00]\n5 | Cloud Setup, Deployment & DevOps Support | [00] | [R 0.00] | [R 0.00]\nSubtotal: [R 0.00]\nVAT (15%): [R 0.00]\nTOTAL INVESTMENT: [R 0.00]\n\n5. PROJECT SCHEDULE & TIMELINE\n• Project Kickoff: [Date]\n• Milestone 1 (UI/UX Approval): Weeks 1–[X]\n• Milestone 2 (Beta Build / Core Logic): Weeks [X]–[Y]\n• Milestone 3 (Final UAT & Security Sign-off): Weeks [Y]–[Z]\n• Estimated Launch Date: [Date]\n\n6. TERMS AND CONDITIONS\n1. Payment Milestones:\n   • Upfront Deposit: 40% upon quote acceptance and project kickoff.\n   • Development Milestone: 30% upon delivery of the Beta / Core feature build.\n   • Final Delivery: 30% upon successful User Acceptance Testing (UAT) and prior to production environment deployment.\n2. Scope Changes: Any adjustments or additions to the scope items listed in Section 3 will be billed at an ad-hoc rate of [R 0.00] per hour, managed through a formal Change Request (CR) process.\n3. Intellectual Property: Full ownership of the custom software code shifts completely to the Client upon final settlement of all outstanding invoices.\n\n7. ACCEPTANCE & SIGN-OFF\nPrepared By: Khaya Cokoto (CEO, X Spark) Date: [DD/MM/YYYY]\nAccepted By: [Client Representative Name] Date: [DD/MM/YYYY]`
  }

  if (type === 'Specification (SOW)') {
    return `SOFTWARE REQUIREMENTS SPECIFICATION (SRS)\n\n1. SYSTEM OVERVIEW & OBJECTIVE\n[Describe the purpose of the system and what it aims to achieve.]\n\n2. SCOPE AND EXCLUSIONS\nIn Scope:\n[List what the system will do]\nOut of Scope:\n[List what the system will NOT do]\n\n3. SYSTEM ASSUMPTIONS\n[List any assumptions made about the environment, users, or technology.]\n\n4. STAKEHOLDERS\n[List the user roles, e.g., Administrator, Senior Developer, Junior Developer.]\n\n5. FUNCTIONAL REQUIREMENTS\n[Break down into categories like AUTH, PROJ, DISC, REQ, FIN, AUD]\nFR-001: [Requirement description]\nFR-002: [Requirement description]\n\n6. WORKFLOW AND STATUS TRANSITIONS\n[Describe the workflow stages and statuses, e.g., Draft -> In Review -> Approved.]\n\n7. DATA REQUIREMENTS\n[List the key entities and their relationships.]\n\n8. ACCEPTANCE CRITERIA\n[List the conditions under which the system will be accepted.]\n\n9. ASSUMPTIONS, DEPENDENCIES, RISKS\n[Detail any assumptions, dependencies, or risks.]`
  }

  if (type === 'Service Agreement') {
    return `SERVICE LEVEL AGREEMENT (SLA)\n\n1. PARTIES INVOLVED\nService Provider: X Spark (Pty) Ltd\nClient: [Client Company Name]\n\n2. SCOPE OF SERVICES\n[Describe the services to be provided, referencing the quotation and SRS.]\n\n3. SERVICE LEVEL TARGETS\nUptime: [e.g., 99.9%]\nResponse Times: [e.g., P1 issues within 1 hour]\n\n4. CLIENT RESPONSIBILITIES\n[List the client's responsibilities, e.g., providing timely feedback, access to systems.]\n\n5. PAYMENT TERMS\n[Detail the payment terms, referencing the quotation and deposit milestones.]`
  }

  return '';
}

function ProjectDetailInner({ id }: { id: string }) {
  const router = useRouter()
  const { role, user, profile } = usePortal()

  const [project, setProject] = useState<Project | null>(null)
  const [teamProfiles, setTeamProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<
    'discovery' | 'requirements' | 'commercials' | 'documents' | 'readiness' | 'devlinks'
  >('discovery')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sub-records
  const [discoveries, setDiscoveries] = useState<Discovery[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [paymentConfirmations, setPaymentConfirmations] = useState<PaymentConfirmation[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [readinessCheck, setReadinessCheck] = useState<ReadinessCheck | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [handover, setHandover] = useState<Handover | null>(null)
  const [devLinks, setDevLinks] = useState<DevLink[]>([])
  const [clientContactCount, setClientContactCount] = useState(0)

  // Form states
  const [showAddDiscovery, setShowAddDiscovery] = useState(false)
  const [discDate, setDiscDate] = useState('')
  const [discSummary, setDiscSummary] = useState('')
  const [discNotes, setDiscNotes] = useState('')
  
  // Audio States
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)

  const [showAddReq, setShowAddReq] = useState(false)
  const [reqRef, setReqRef] = useState('')
  const [reqTitle, setReqTitle] = useState('')
  const [reqPriority, setReqPriority] = useState('medium')

  const [showAddQuote, setShowAddQuote] = useState(false)
  const [quoteTitle, setQuoteTitle] = useState('')
  const [quoteCurrency, setQuoteCurrency] = useState('ZAR')
  const [quoteValidity, setQuoteValidity] = useState('')
  const [quoteLines, setQuoteLines] = useState<QuotationLineItem[]>([
    { description: 'Initial Scope Deliverable', quantity: 1, unit_amount: 15000, amount: 15000, tax_rate: 15 },
  ])

  const [showAddDeposit, setShowAddDeposit] = useState(false)
  const [depAmount, setDepAmount] = useState('')
  const [depTrigger, setDepTrigger] = useState('50% Upfront on Signing')
  const [depDue, setDepDue] = useState('')

  const [showAddPO, setShowAddPO] = useState(false)
  const [poNumber, setPoNumber] = useState('')
  const [poAmount, setPoAmount] = useState('')
  const [poDate, setPoDate] = useState('')

  const [showAddDoc, setShowAddDoc] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docType, setDocType] = useState('Specification (SOW)')
  const [docAiGenerated, setDocAiGenerated] = useState(false)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [docDraftContent, setDocDraftContent] = useState('')
  const [docDraftAiGenerated, setDocDraftAiGenerated] = useState(false)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [docReviewNotes, setDocReviewNotes] = useState('')

  const [showHandoverForm, setShowHandoverForm] = useState(false)
  const [handoverSummary, setHandoverSummary] = useState('')
  const [handoverNotes, setHandoverNotes] = useState('')

  const [showAddLink, setShowAddLink] = useState(false)
  const [linkType, setLinkType] = useState('repository')
  const [linkUrl, setLinkUrl] = useState('')

  const [submitting, setSubmitting] = useState(false)

  const effectiveRole = profile?.role || role
  const leadAssignment = assignments.find(
    (assignment) => assignment.assignment_role === 'lead' && assignment.is_active
  )
  const developerAssignments = assignments.filter(
    (assignment) => assignment.assignment_role === 'developer' && assignment.is_active
  )
  const currentUserAssignment = assignments.find(
    (assignment) => assignment.developer_user_id === user?.id && assignment.is_active
  )
  const canApprove =
    profile?.is_active !== false &&
    canApproveProject(effectiveRole, Boolean(currentUserAssignment?.approval_authority))
  const canDraft = Boolean(
    currentUserAssignment &&
    canDraftDeliverables(effectiveRole) &&
    (effectiveRole !== 'senior_dev_pm' || !currentUserAssignment.approval_authority)
  )
  const leadProfile = leadAssignment?.developer_user_id
    ? teamProfiles.find((member) => member.id === leadAssignment.developer_user_id)
    : undefined
  const approverNames = assignments
    .filter((assignment) => assignment.is_active && assignment.approval_authority)
    .map((assignment) => {
      const member = teamProfiles.find(
        (candidate) => candidate.id === assignment.developer_user_id
      )
      return member?.is_active !== false ? member?.full_name : undefined
    })
    .filter((name): name is string => Boolean(name))
  const confirmationByDeposit = useMemo(() => {
    const byDeposit = new Map<string, PaymentConfirmation>()
    for (const confirmation of paymentConfirmations) {
      if (confirmation.deposit_id && !byDeposit.has(confirmation.deposit_id)) {
        byDeposit.set(confirmation.deposit_id, confirmation)
      }
    }
    return byDeposit
  }, [paymentConfirmations])
  const editingDoc = documents.find((doc) => doc.id === editingDocId) || null
  const editingRevision = editingDoc ? getCurrentRevision(editingDoc) : undefined
  const editingNextRevisionNo = editingDoc
    ? (editingDoc.document_revisions ?? []).reduce(
        (highest, revision) => Math.max(highest, revision.revision_no),
        0
      ) + 1
    : 1

  const previewDoc = documents.find((doc) => doc.id === previewDocId) || null
  const previewRevision = previewDoc ? getCurrentRevision(previewDoc) : undefined
  const previewPreviousRevision = previewDoc
    ? (previewDoc.document_revisions ?? [])
        .filter((revision) => revision.revision_no < (previewRevision?.revision_no ?? 0))
        .sort((a, b) => b.revision_no - a.revision_no)[0]
    : undefined
  const previewDiff = buildLineDiff(
    previewPreviousRevision?.content ?? '',
    previewRevision?.content ?? ''
  )
  const previewStatus = previewDoc
    ? previewDoc.status === 'sent_to_client'
      ? 'sent_to_client'
      : previewRevision?.status || previewDoc.status
    : ''
  const previewSender = previewDoc?.sent_to_client_by
    ? teamProfiles.find((profile) => profile.id === previewDoc.sent_to_client_by)
    : undefined

  const refreshAllProjectData = useCallback(async () => {
    try {
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .select('id, client_id, project_reference, name, description, stage, status, clients(client_code, name)')
        .eq('id', id)
        .single()

      if (projErr) {
        setStatusMessage({ type: 'error', text: 'Could not load project: ' + projErr.message })
        return
      }

      setProject(proj as unknown as Project)

      const { count: contactCount } = await supabase
        .from('client_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', proj.client_id)
      setClientContactCount(contactCount ?? 0)

      // Discovery
      const { data: d } = await supabase
        .from('discovery_records')
        .select('id, meeting_date, summary, notes, audio_url, transcript, transcription_status, status, created_at')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setDiscoveries((d ?? []) as Discovery[])

      // Requirements
      const { data: r } = await supabase
        .from('requirements')
        .select('id, requirement_ref, title, priority, status, created_at')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setRequirements((r ?? []) as Requirement[])

      // Quotations
      const { data: q } = await supabase
        .from('quotations')
        .select('id, title, currency, status, validity_date, created_at, quotation_line_items(*)')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setQuotations((q ?? []) as Quotation[])

      // Deposits
      const { data: dep } = await supabase
        .from('deposits')
        .select(
          'id, amount, currency, due_date, trigger, status, external_reference, verified_at, verified_by_provider'
        )
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setDeposits((dep ?? []) as Deposit[])

      // External payment confirmations (written by the payment webhook)
      const { data: confirmations } = await supabase
        .from('payment_confirmations')
        .select(
          'id, deposit_id, amount, reference, provider, external_reference, actor_type, confirmed_by, verified_at, created_at'
        )
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setPaymentConfirmations((confirmations ?? []) as PaymentConfirmation[])

      // POs
      const { data: po } = await supabase
        .from('purchase_orders')
        .select('id, po_number, amount, currency, po_date')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setPurchaseOrders((po ?? []) as PurchaseOrder[])

      // Documents
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .select('id, title, type, status, current_revision_id, sent_to_client_at, sent_to_client_by, created_at, document_revisions:document_revisions_document_id_fkey(*)')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      if (!docErr && doc) {
        setDocuments(doc as unknown as DocumentRecord[])
      }

      // Readiness Check
      const { data: rc } = await supabase
        .from('readiness_checks')
        .select('id, result, readiness_items(*)')
        .eq('project_id', id)
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setReadinessCheck((rc ?? null) as ReadinessCheck | null)

      // Project assignment matrix
      const { data: asgn } = await supabase
        .from('assignments')
        .select(
          'id, developer_user_id, assignment_role, approval_authority, is_active, assigned_at'
        )
        .eq('project_id', id)
        .eq('is_active', true)
        .order('assignment_role', { ascending: false })
        .order('assigned_at', { ascending: true })
      setAssignments((asgn ?? []) as Assignment[])

      // Handover
      const { data: hov } = await supabase
        .from('handovers')
        .select('id, scope_summary, notes, prepared_at')
        .eq('project_id', id)
        .order('prepared_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setHandover((hov ?? null) as Handover | null)

      // Dev Links
      const { data: l } = await supabase
        .from('development_links')
        .select('id, link_type, url, verified')
        .eq('project_id', id)
        .order('recorded_at', { ascending: false })
      setDevLinks((l ?? []) as DevLink[])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
  }, [id])

  useEffect(() => {
    let ignore = false

    async function loadInitial() {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active')
      if (!ignore && profs) {
        setTeamProfiles(profs as Profile[])
      }

      await refreshAllProjectData()
      if (!ignore) setLoading(false)
    }

    if (id) {
      loadInitial()
    }

    return () => {
      ignore = true
    }
  }, [id, refreshAllProjectData])

  useEffect(() => {
    if (!previewDocId) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPreviewDocId(null)
        setDocReviewNotes('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewDocId])

  async function handleAdvanceStage(newStage: string) {
    if (!project) return
    if (!canApprove) {
      setStatusMessage({ type: 'error', text: 'Only the project’s assigned approver can advance project stages.' })
      return
    }
    const prevStage = project.stage

    if (newStage === 'development') {
      const hasApprovedScope = discoveries.some((item) => item.status === 'approved')
      const hasApprovedRequirements =
        requirements.some((item) => item.status === 'approved') ||
        documents.some((item) => item.status === 'approved' && (item.title.includes('Requirements') || item.title.includes('PRD')))

      if (!hasApprovedScope || !hasApprovedRequirements || clientContactCount === 0) {
        const missing: string[] = []
        if (!hasApprovedScope) missing.push('an approved scope/discovery record')
        if (!hasApprovedRequirements) missing.push('approved requirements')
        if (clientContactCount === 0) missing.push('at least one assigned client contact')
        setStatusMessage({ type: 'error', text: `Cannot advance to Development. Missing: ${missing.join(', ')}.` })
        return
      }
    }

    // FAILSAFE: Check readiness if advancing to Development, Handover, or Completed
    if ((newStage === 'development' || newStage === 'handover' || newStage === 'completed') && readinessCheck) {
      const hasOutstandingMandatory = readinessCheck.readiness_items?.some(
        (item) => item.mandatory && item.result === 'outstanding'
      )
      if (hasOutstandingMandatory) {
        setStatusMessage({ 
          type: 'error', 
          text: 'Cannot advance stage. You must complete all Mandatory Readiness criteria first (or mark them as Overridden if permitted).' 
        })
        return
      }
    }

    const { error } = await supabase.from('projects').update({ 
      stage: newStage,
      status: newStage === 'development' ? 'in_progress' : 'approved' 
    }).eq('id', project.id)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not change stage: ' + error.message })
      return
    }

    await supabase.from('project_stage_history').insert({
      project_id: project.id,
      from_stage: prevStage,
      to_stage: newStage,
      status: project.status,
      changed_by: user?.id,
    })

    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'project.stage_transition',
      entity_type: 'project',
      entity_id: project.id,
      before_value: { stage: prevStage },
      after_value: { stage: newStage },
    })

    setStatusMessage({ type: 'success', text: `Project advanced to ${newStage.toUpperCase()} stage.` })
    await refreshAllProjectData()
  }

  async function handleInitializeReadiness() {
    if (!canApprove) {
      setStatusMessage({ type: 'error', text: 'Only the project’s assigned approver can run or re-evaluate readiness checks.' })
      return
    }
    setSubmitting(true)

    // Reload development links at evaluation time so verification changes are
    // picked up immediately, even when another tab or handler updated them.
    const { data: currentDevLinks, error: devLinksError } = await supabase
      .from('development_links')
      .select('link_type, url, verified')
      .eq('project_id', id)

    if (devLinksError) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Could not refresh development links: ' + devLinksError.message })
      return
    }

    // Auto-evaluate criteria based on actual project state
    const hasApprovedScope = discoveries.some((item) => item.status === 'approved')
    const hasApprovedReqDocs = documents.some(
      (d) => d.status === 'approved' && (d.title.includes('Requirements') || d.title.includes('PRD'))
    )
    const hasApprovedRequirements = requirements.some((item) => item.status === 'approved') || hasApprovedReqDocs
    const hasVerifiedRepo = (currentDevLinks ?? []).some((link) =>
      Boolean(link.verified) && isRepositoryLink(link)
    )
    setDevLinks((links) => links.map((link) => {
      const current = (currentDevLinks ?? []).find((candidate) => candidate.link_type === link.link_type)
      return current ? { ...link, verified: Boolean(current.verified) } : link
    }))
    const hasConfirmedDeposit = deposits.some((d) => d.status === 'paid')

    const autoCriteria = [
      {
        criterion: 'Approved scope of work from discovery',
        mandatory: true,
        overridable: false,
        result: hasApprovedScope ? 'passed' : 'outstanding'
      },
      {
        criterion: 'Requirements approved by Senior PM',
        mandatory: true,
        overridable: false,
        result: hasApprovedRequirements ? 'passed' : 'outstanding'
      },
      { 
        criterion: 'Source repository initialized and verified', 
        mandatory: true, 
        overridable: false, 
        result: hasVerifiedRepo ? 'passed' : 'outstanding' 
      },
      { 
        criterion: 'Initial milestone deposit paid and confirmed', 
        mandatory: true, 
        overridable: true, 
        result: hasConfirmedDeposit
          ? 'passed'
          : readinessCheck?.readiness_items?.find((item) => item.criterion === 'Initial milestone deposit paid and confirmed')?.result === 'overridden'
            ? 'overridden'
            : 'outstanding'
      },
      {
        criterion: 'Client technical contact assigned',
        mandatory: true,
        overridable: false,
        result: clientContactCount > 0 ? 'passed' : 'outstanding'
      },
    ]

    let readinessCheckId = readinessCheck?.id

    if (readinessCheckId) {
      const { error: resetError } = await supabase
        .from('readiness_checks')
        .update({ run_by: user?.id, result: 'pending' })
        .eq('id', readinessCheckId)

      if (resetError) {
        setSubmitting(false)
        setStatusMessage({ type: 'error', text: resetError.message })
        return
      }
    } else {
      const { data: rc, error: rcErr } = await supabase
        .from('readiness_checks')
        .insert({ project_id: id, run_by: user?.id, result: 'pending' })
        .select('id')
        .single()

      if (rcErr || !rc) {
        setSubmitting(false)
        setStatusMessage({ type: 'error', text: rcErr?.message || 'Failed to start readiness check' })
        return
      }
      readinessCheckId = rc.id
    }

    if (!readinessCheckId) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Failed to identify the readiness checklist.' })
      return
    }

    const { error: deleteError } = await supabase
      .from('readiness_items')
      .delete()
      .eq('readiness_check_id', readinessCheckId)

    if (deleteError) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: deleteError.message })
      return
    }

    const { data: insertedItems, error: itemsErr } = await supabase.from('readiness_items').insert(
      autoCriteria.map((c) => ({
        readiness_check_id: readinessCheckId,
        criterion: c.criterion,
        mandatory: c.mandatory,
        overridable: c.overridable,
        result: c.result,
      }))
    ).select()

    if (itemsErr) {
       setSubmitting(false)
       setStatusMessage({ type: 'error', text: `Failed to save checklist items: ${itemsErr.message}` })
       return
    }

    setSubmitting(false)
    setStatusMessage({ type: 'success', text: 'Readiness checklist generated and auto-evaluated.' })
    
    // Manually update local state instantly to prevent UI disappearing
    setReadinessCheck({
      id: readinessCheckId,
      result: 'pending',
      readiness_items: insertedItems as ReadinessItem[]
    })

    await refreshAllProjectData()
  }

  const automaticReadinessSignature = useMemo(() => JSON.stringify([
    discoveries.some((item) => item.status === 'approved'),
    requirements.some((item) => item.status === 'approved') || documents.some((item) =>
      item.status === 'approved' && (item.title.includes('Requirements') || item.title.includes('PRD'))
    ),
    devLinks.some((link) => isRepositoryLink(link) && link.verified),
    deposits.some((deposit) => deposit.status === 'paid'),
    clientContactCount > 0,
  ]), [discoveries, requirements, documents, devLinks, deposits, clientContactCount])

  const savedReadinessSignature = useMemo(() => JSON.stringify(
    (readinessCheck?.readiness_items ?? []).map((item) =>
      item.result === 'overridden' ? 'passed' : item.result
    )
  ), [readinessCheck])

  useEffect(() => {
    if (loading || !canApprove || submitting || !project) return

    const depositItem = readinessCheck?.readiness_items?.find((item) => item.criterion === 'Initial milestone deposit paid and confirmed')
    const expectedSignature = JSON.stringify([
      discoveries.some((item) => item.status === 'approved') ? 'passed' : 'outstanding',
      (requirements.some((item) => item.status === 'approved') || documents.some((item) =>
        item.status === 'approved' && (item.title.includes('Requirements') || item.title.includes('PRD'))
      )) ? 'passed' : 'outstanding',
      devLinks.some((link) => isRepositoryLink(link) && link.verified) ? 'passed' : 'outstanding',
      deposits.some((deposit) => deposit.status === 'paid') || depositItem?.result === 'overridden' ? 'passed' : 'outstanding',
      clientContactCount > 0 ? 'passed' : 'outstanding',
    ])
    const savedSignature = JSON.stringify((readinessCheck?.readiness_items ?? []).map((item) =>
      item.result === 'overridden' ? 'passed' : item.result
    ))

    if (!readinessCheck || savedSignature !== expectedSignature) {
      void handleInitializeReadiness()
    }
  }, [
    loading,
    canApprove,
    submitting,
    project,
    automaticReadinessSignature,
    savedReadinessSignature,
  ])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAudioBlob(blob)
      }

      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Microphone access denied or not available.' })
    }
  }

  function stopRecording() {
    if (mediaRecorder) {
      mediaRecorder.stop()
      setIsRecording(false)
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setAudioBlob(file)
  }

  async function handleAddDiscovery(e: React.FormEvent) {
    e.preventDefault()
    if (!canDraft) {
      setStatusMessage({ type: 'error', text: 'You do not have permission to add discovery notes.' })
      return
    }
    if (!discSummary.trim() && !discNotes.trim() && !audioBlob) {
      setStatusMessage({ type: 'error', text: 'A summary, detailed notes, or an audio file is required.' })
      return
    }
    
    setSubmitting(true)
    let publicUrl = null

    try {
      if (audioBlob) {
        setIsUploadingAudio(true)
        const fileName = `${id}-${Date.now()}.webm`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('discovery-media')
          .upload(fileName, audioBlob, { contentType: 'audio/webm' })

        if (uploadError) throw new Error('Audio upload failed: ' + uploadError.message)

        const { data: { publicUrl: url } } = supabase.storage
          .from('discovery-media')
          .getPublicUrl(fileName)
        
        publicUrl = url
      }

      const { data: dbRecord, error: dbError } = await supabase.from('discovery_records').insert({
        project_id: id,
        meeting_date: discDate || null,
        summary: discSummary.trim() || null,
        notes: discNotes.trim() || null,
        audio_url: publicUrl,
        transcription_status: publicUrl ? 'pending' : null,
        status: 'pending_review',
        created_by: user?.id,
      }).select().single()

      if (dbError) throw new Error(dbError.message)

      if (publicUrl && dbRecord) {
        fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl: publicUrl, recordId: dbRecord.id })
        }).catch(err => console.error('Transcription request failed', err))
      }

      setDiscDate('')
      setDiscSummary('')
      setDiscNotes('')
      setAudioBlob(null)
      setShowAddDiscovery(false)
      setStatusMessage({ 
        type: 'success', 
        text: publicUrl ? 'Discovery saved. Transcribing audio in the background...' : 'Discovery record saved.' 
      })
      await refreshAllProjectData()

    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message })
    } finally {
      setSubmitting(false)
      setIsUploadingAudio(false)
    }
  }

  async function handleAddRequirement(e: React.FormEvent) {
    e.preventDefault()
    if (!canDraft) {
      setStatusMessage({ type: 'error', text: 'You do not have permission to add requirements.' })
      return
    }
    if (!reqRef.trim() || !reqTitle.trim()) {
      setStatusMessage({ type: 'error', text: 'Ref and title are required.' })
      return
    }
    setSubmitting(true)
    const cleanRef = reqRef.trim().toUpperCase()
    const { error } = await supabase.from('requirements').insert({
      project_id: id,
      requirement_ref: cleanRef,
      title: reqTitle.trim(),
      priority: reqPriority,
      status: 'pending_review',
      created_by: user?.id,
    })
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setReqRef('')
    setReqTitle('')
    setShowAddReq(false)
    setStatusMessage({
      type: 'success',
      text: `Requirement ${cleanRef} submitted for Senior approval.`,
    })
    await refreshAllProjectData()
  }

  async function handleCreateQuotation(e: React.FormEvent) {
    e.preventDefault()
    if (!quoteTitle.trim()) {
      setStatusMessage({ type: 'error', text: 'Quotation title is required.' })
      return
    }
    setSubmitting(true)

    const { data: qData, error: qErr } = await supabase
      .from('quotations')
      .insert({
        project_id: id,
        title: quoteTitle.trim(),
        currency: quoteCurrency,
        validity_date: quoteValidity || null,
        status: 'draft',
      })
      .select('id')
      .single()

    if (qErr || !qData) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Could not create quotation: ' + qErr?.message })
      return
    }

    const itemsToInsert = quoteLines.map((line) => ({
      quotation_id: qData.id,
      description: line.description,
      quantity: Number(line.quantity) || 1,
      unit_amount: Number(line.unit_amount) || 0,
      amount: (Number(line.quantity) || 1) * (Number(line.unit_amount) || 0),
      tax_rate: Number(line.tax_rate) || 15,
    }))

    await supabase.from('quotation_line_items').insert(itemsToInsert)

    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'quotation.created',
      entity_type: 'quotation',
      entity_id: qData.id,
      after_value: { title: quoteTitle, lines: itemsToInsert },
    })

    setSubmitting(false)
    setShowAddQuote(false)
    setQuoteTitle('')
    setStatusMessage({ type: 'success', text: 'Quotation created successfully.' })
    await refreshAllProjectData()
  }

  async function handleUpdateQuotationStatus(quoteId: string, newStatus: string) {
    const { error } = await supabase.from('quotations').update({ status: newStatus }).eq('id', quoteId)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setStatusMessage({ type: 'success', text: `Quotation updated to ${newStatus}.` })
    await refreshAllProjectData()
  }

  async function handleAddDeposit(e: React.FormEvent) {
    e.preventDefault()
    if (!depAmount || isNaN(Number(depAmount))) {
      setStatusMessage({ type: 'error', text: 'Valid deposit amount required.' })
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('deposits').insert({
      project_id: id,
      amount: Number(depAmount),
      currency: 'ZAR',
      trigger: depTrigger,
      due_date: depDue || null,
      status: 'awaiting_payment',
    })
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setDepAmount('')
    setShowAddDeposit(false)
    setStatusMessage({ type: 'success', text: 'Milestone deposit recorded.' })
    await refreshAllProjectData()
  }

  async function handleAddPO(e: React.FormEvent) {
    e.preventDefault()
    if (!poNumber.trim()) {
      setStatusMessage({ type: 'error', text: 'PO Number is required.' })
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('purchase_orders').insert({
      project_id: id,
      po_number: poNumber.trim().toUpperCase(),
      amount: Number(poAmount) || 0,
      currency: 'ZAR',
      po_date: poDate || null,
    })
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setPoNumber('')
    setPoAmount('')
    setShowAddPO(false)
    setStatusMessage({ type: 'success', text: 'Purchase order recorded.' })
    await refreshAllProjectData()
  }

  async function handleAddDocument(e: React.FormEvent) {
    e.preventDefault()
    if (!canDraft) {
      setStatusMessage({ type: 'error', text: 'You do not have permission to draft documents.' })
      return
    }
    if (!docTitle.trim()) {
      setStatusMessage({ type: 'error', text: 'Document title is required.' })
      return
    }
    setSubmitting(true)

    const { data: docData, error: docErr } = await supabase
      .from('documents')
      .insert({
        project_id: id,
        title: docTitle.trim(),
        type: docType,
        // A newly created document record has no submitted content yet, so it
        // starts as Draft (PRD §8.1). Saving the first revision submits it
        // for Senior review (see the revision-status sync trigger).
        status: 'draft',
      })
      .select('id')
      .single()

    if (docErr || !docData) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Could not create document: ' + docErr?.message })
      return
    }

    setSubmitting(false)
    setDocTitle('')
    setShowAddDoc(false)
    setEditingDocId(docData.id)
    
    const blankTemplate = getBlankTemplate(docType)
    setDocDraftContent(blankTemplate)
    setDocDraftAiGenerated(docAiGenerated)
    
    setStatusMessage({
      type: 'success',
      text: 'Document created. The template has been pre-filled below.',
    })
    await refreshAllProjectData()
  }

  function handleOpenDocument(doc: DocumentRecord) {
    const revision = getCurrentRevision(doc)
    setEditingDocId(doc.id)
    setDocDraftContent(revision?.content ?? getBlankTemplate(doc.type || ''))
    setDocDraftAiGenerated(Boolean(revision?.ai_generated))
    setShowAddDoc(false)
    setStatusMessage(null)
  }

  async function handleSaveDocumentDraft(e: React.FormEvent) {
    e.preventDefault()
    if (!canDraft) {
      setStatusMessage({ type: 'error', text: 'You do not have permission to draft documents.' })
      return
    }
    if (!editingDoc) return
    if (!docDraftContent.trim()) {
      setStatusMessage({ type: 'error', text: 'Document content is required before submitting a draft.' })
      return
    }

    setSubmitting(true)
    const nextRevisionNo =
      (editingDoc.document_revisions ?? []).reduce(
        (highest, revision) => Math.max(highest, revision.revision_no),
        0
      ) + 1

    const { data: revision, error } = await supabase
      .from('document_revisions')
      .insert({
        document_id: editingDoc.id,
        revision_no: nextRevisionNo,
        content: docDraftContent.trim(),
        ai_generated: docDraftAiGenerated,
        ai_model: docDraftAiGenerated ? AI_ORIGIN_MODEL : null,
        ai_model_version: docDraftAiGenerated ? AI_ORIGIN_VERSION : null,
        ai_generated_at: docDraftAiGenerated ? new Date().toISOString() : null,
        created_by: user?.id,
        status: 'pending_review',
      })
      .select('id, revision_no')
      .single()

    setSubmitting(false)
    if (error || !revision) {
      setStatusMessage({ type: 'error', text: 'Could not save the document draft: ' + (error?.message || 'unknown error') })
      return
    }

    setEditingDocId(null)
    setDocDraftContent('')
    setStatusMessage({ type: 'success', text: `Document draft revision #${revision.revision_no} submitted for Senior approval.` })
    await refreshAllProjectData()
  }

  function handlePreviewDocument(doc: DocumentRecord) {
    setPreviewDocId(doc.id)
    setDocReviewNotes('')
    setEditingDocId(null)
    setShowAddDoc(false)
    setStatusMessage(null)
  }

  function handleClosePreview() {
    setPreviewDocId(null)
    setDocReviewNotes('')
  }

  async function handleApproveDocument(docId: string, revisionId: string, decision: 'approved' | 'rejected', comment: string) {
    if (!canApprove) {
      setStatusMessage({ type: 'error', text: 'Only the project’s assigned approver can approve documents.' })
      return
    }

    setSubmitting(true)
    const { error: approvalError } = await supabase.from('approvals').insert({
      revision_id: revisionId,
      approver_id: user?.id,
      decision,
      comment: comment.trim() || null,
    })

    if (approvalError) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Could not record approval: ' + approvalError.message })
      return
    }

    const { error: revisionError } = await supabase.from('document_revisions').update({ status: decision }).eq('id', revisionId)
    const { error: documentError } = await supabase.from('documents').update({ status: decision }).eq('id', docId)

    setSubmitting(false)
    if (revisionError || documentError) {
      setStatusMessage({ type: 'error', text: 'Approval was recorded but the document status could not be updated: ' + (revisionError?.message || documentError?.message) })
      return
    }

    setDocReviewNotes('')
    setStatusMessage({ type: 'success', text: decision === 'approved' ? 'Document approved (internal). You can now send it to the client.' : 'Document revision marked as rejected.' })
    await refreshAllProjectData()
  }

  async function handleSendToClient(docId: string) {
    if (!canApprove) {
      setStatusMessage({ type: 'error', text: 'Only the project’s assigned approver can send documents to clients.' })
      return
    }

    const doc = documents.find((item) => item.id === docId)
    if (!doc) return
    if (doc.status !== 'approved') {
      setStatusMessage({ type: 'error', text: 'Approve the current document revision before sending it to the client.' })
      return
    }

    if (!window.confirm('Send this document to the client? It will be marked as Sent to Client.')) return

    setSubmitting(true)
    const { error } = await supabase.from('documents').update({
      status: 'sent_to_client',
      sent_to_client_at: new Date().toISOString(),
      sent_to_client_by: user?.id,
    }).eq('id', docId)

    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not send the document: ' + error.message })
      return
    }

    setStatusMessage({ type: 'success', text: 'Document marked as Sent to Client.' })
    await refreshAllProjectData()
  }

  async function handleToggleReadinessItem(itemId: string, currentResult: string, overridable: boolean) {
    if (!canApprove || !overridable) {
      setStatusMessage({ type: 'error', text: 'This criterion is checked automatically and cannot be toggled manually.' })
      return
    }

    let nextResult = currentResult === 'passed' ? 'outstanding' : 'passed'
    let overrideReason = null

    if (currentResult === 'outstanding' && overridable && window.confirm('Mark this criterion as Overridden instead of Passed?')) {
      nextResult = 'overridden'
      overrideReason = window.prompt('Provide reason for overriding this criterion:')
      if (!overrideReason) return
    }

    const { error } = await supabase.from('readiness_items').update({
      result: nextResult,
      override_reason: overrideReason,
      overridden_by: nextResult === 'overridden' ? user?.id : null,
    }).eq('id', itemId)

    if (error) {
      setStatusMessage({ type: 'error', text: `Could not update readiness criterion: ${error.message}` })
      return
    }

    await refreshAllProjectData()
  }

  async function handleSaveHandover(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const { error } = await supabase.from('handovers').insert({
      project_id: id,
      scope_summary: handoverSummary,
      notes: handoverNotes,
      prepared_by: user?.id,
    })
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setShowHandoverForm(false)
    setStatusMessage({ type: 'success', text: 'Handover dossier completed.' })
    await refreshAllProjectData()
  }

  async function handleAddDevLink(e: React.FormEvent) {
    e.preventDefault()
    if (!canDraft || !linkUrl.trim()) return
    setSubmitting(true)
    const { error } = await supabase.from('development_links').insert({
      project_id: id,
      link_type: linkType,
      url: linkUrl.trim(),
      recorded_by: user?.id,
    })
    setLinkUrl('')
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not record link: ' + error.message })
      return
    }
    setShowAddLink(false)
    setStatusMessage({ type: 'success', text: 'Development link recorded and submitted for Senior verification.' })
    await refreshAllProjectData()
  }

  async function handleVerifyLink(linkId: string) {
    if (!canApprove) {
      setStatusMessage({ type: 'error', text: 'Only the project’s assigned approver can verify development links.' })
      return
    }
    const { error } = await supabase.from('development_links').update({
      verified: true,
      verified_by: user?.id,
      verified_at: new Date().toISOString(),
    }).eq('id', linkId)
    
    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not verify link: ' + error.message })
      return
    }
    setDevLinks((links) => links.map((link) =>
      link.id === linkId
        ? { ...link, verified: true }
        : link
    ))
    setStatusMessage({ type: 'success', text: 'Link verified.' })
    await refreshAllProjectData()
  }

  const quotationTotals = useMemo(() => {
    return quotations.map((q) => {
      const subtotal = (q.quotation_line_items || []).reduce((acc, cur) => acc + (cur.amount || 0), 0)
      const tax = (q.quotation_line_items || []).reduce(
        (acc, cur) => acc + (cur.amount || 0) * ((cur.tax_rate || 0) / 100),
        0
      )
      return { id: q.id, subtotal, tax, total: subtotal + tax }
    })
  }, [quotations])

  const currentStageIndex = useMemo(() => {
    if (!project) return 0
    const idx = PROJECT_STAGES.findIndex((s) => s.id === project.stage.toLowerCase())
    return idx === -1 ? 0 : idx
  }, [project])

  const readinessComplete = Boolean(
    readinessCheck?.readiness_items?.length &&
    readinessCheck.readiness_items.every((item) => item.result === 'passed' || item.result === 'overridden')
  )

  return (
    <div style={{ maxWidth: 1100 }}>
        <button type="button" className="portal-back-btn" onClick={() => router.push('/projects')}>
          <span>←</span> Back to all projects
        </button>

        {statusMessage && (
          <div className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'} style={{ marginBottom: 20 }} role="alert">
            <span>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        {!loading && project && effectiveRole === 'junior_developer' && (
          <div className="portal-role-notice" role="note">
            <span className="portal-role-notice-icon">🔒</span>
            <div>
              <strong>Junior Developer draft access.</strong> You can add discovery notes,
              requirements, document drafts and development links. Approvals, stage changes,
              payment confirmation and link verification are reserved for this project’s
              assigned approver.
            </div>
          </div>
        )}

        {loading ? (
          <div className="portal-card">
            <div className="portal-empty-state">
              <div className="portal-empty-icon">⏳</div>
              <p className="portal-empty-title">Loading project workspace...</p>
            </div>
          </div>
        ) : !project ? (
          <div className="portal-card">
            <div className="portal-empty-state">
              <div className="portal-empty-icon">⚠️</div>
              <p className="portal-empty-title">Project not found</p>
              <Link href="/projects" className="portal-btn-primary">Return to Projects</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="portal-detail-header">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <span className="code-badge" style={{ marginBottom: 8 }}>{project.project_reference}</span>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: '#14213d', margin: '4px 0 0' }}>{project.name}</h2>
                  {project.description && <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>{project.description}</p>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Stage:</span>
                  <select
                    className="form-input"
                    style={{ width: 'auto', height: 36, fontSize: 12, fontWeight: 600, cursor: canApprove ? 'pointer' : 'not-allowed', opacity: canApprove ? 1 : 0.7 }}
                    value={project.stage}
                    onChange={(e) => handleAdvanceStage(e.target.value)}
                    disabled={!canApprove}
                    aria-readonly={!canApprove}
                    title={canApprove ? 'Advance the project stage' : 'Read-only: stage changes require Senior Developer / PM approval'}
                  >
                    {!PROJECT_STAGES.some((s) => s.id === project.stage) && (
                      <option value={project.stage}>{project.stage.replace(/_/g, ' ')}</option>
                    )}
                    {PROJECT_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  {!canApprove && <span className="portal-badge badge-amber">🔒 Read-only</span>}
                </div>
              </div>

              <div className="portal-stepper">
                {PROJECT_STAGES.map((stg, i) => {
                  const isDone = i < currentStageIndex
                  const isCurrent = i === currentStageIndex
                  return (
                    <React.Fragment key={stg.id}>
                      <div className={`step-item ${isDone ? 'completed' : isCurrent ? 'active' : ''}`}>
                        <div className="step-dot">{isDone ? '✓' : i + 1}</div>
                        <span>{stg.label.replace(/^\d+\.\s*/, '')}</span>
                      </div>
                      {i < PROJECT_STAGES.length - 1 && <div className={`step-divider ${isDone ? 'completed' : ''}`} />}
                    </React.Fragment>
                  )
                })}
              </div>

              <div className="portal-detail-meta-grid">
                <div className="portal-meta-item">
                  <label>Client</label>
                  <span>{project.clients?.name ?? 'Unassigned'} ({project.clients?.client_code})</span>
                </div>
                <div className="portal-meta-item">
                  <label>Current Stage</label>
                  <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#4361ee' }}>{project.stage}</span>
                </div>
                <div className="portal-meta-item">
                  <label>Status</label>
                  <span><span className={approvalBadgeClass(project.status)}>{formatApprovalStatus(project.status)}</span></span>
                </div>
                <div className="portal-meta-item">
                  <label>Project Lead</label>
                  <span>{leadProfile?.full_name ?? 'Unassigned'}{leadProfile?.is_active === false && <span className="portal-badge badge-amber" style={{ marginLeft: 8 }}>Suspended</span>}</span>
                </div>
                <div className="portal-meta-item">
                  <label>Approval Authority</label>
                  <span>{approverNames.length > 0 ? approverNames.join(', ') : 'No approver assigned'}</span>
                </div>
              </div>
            </div>

            <div className="portal-tabs">
              <button type="button" className={`portal-tab-btn ${activeTab === 'discovery' ? 'active' : ''}`} onClick={() => setActiveTab('discovery')}>
                <span>🔍 Discovery</span><span className="portal-tab-count">{discoveries.length}</span>
              </button>
              <button type="button" className={`portal-tab-btn ${activeTab === 'requirements' ? 'active' : ''}`} onClick={() => setActiveTab('requirements')}>
                <span>📋 Requirements</span><span className="portal-tab-count">{requirements.length}</span>
              </button>
              <button type="button" className={`portal-tab-btn ${activeTab === 'commercials' ? 'active' : ''}`} onClick={() => setActiveTab('commercials')}>
                <span>💰 Commercials</span><span className="portal-tab-count">{quotations.length + deposits.length}</span>
              </button>
              <button type="button" className={`portal-tab-btn ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
                <span>📄 Documents</span><span className="portal-tab-count">{documents.length}</span>
              </button>
              <button type="button" className={`portal-tab-btn ${activeTab === 'readiness' ? 'active' : ''}`} onClick={() => setActiveTab('readiness')}>
                <span>✅ Readiness & Handover</span><span className="portal-tab-count">{readinessCheck?.readiness_items?.length || (handover ? 1 : 0)}</span>
              </button>
              <button type="button" className={`portal-tab-btn ${activeTab === 'devlinks' ? 'active' : ''}`} onClick={() => setActiveTab('devlinks')}>
                <span>🔗 Dev Links</span><span className="portal-tab-count">{devLinks.length}</span>
              </button>
            </div>

            {activeTab === 'discovery' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Discovery Sessions ({discoveries.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Notes, audio recordings, and AI transcripts from client briefing sessions.</p>
                  </div>
                  {canDraft && !showAddDiscovery && (
                    <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddDiscovery(true)}>
                      <span>+</span> Add Discovery Record
                    </button>
                  )}
                </div>

                {showAddDiscovery && canDraft && (
                  <form onSubmit={handleAddDiscovery} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <input type="date" className="form-input" value={discDate} onChange={(e) => setDiscDate(e.target.value)} />
                      <input className="form-input" placeholder="Session Summary / Key Decisions *" value={discSummary} onChange={(e) => setDiscSummary(e.target.value)} />
                      <textarea className="form-input" style={{ minHeight: 70 }} placeholder="Detailed meeting notes..." value={discNotes} onChange={(e) => setDiscNotes(e.target.value)} />
                      
                      <div style={{ border: '1px dashed #cbd5e1', padding: 16, borderRadius: 10, background: '#fff' }}>
                        <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>Attach Audio / Voice Note (Optional)</h4>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          {!isRecording ? (
                            <button type="button" onClick={startRecording} className="portal-btn-secondary">🎤 Start Recording</button>
                          ) : (
                            <button type="button" onClick={stopRecording} className="auth-alert-error" style={{ padding: '8px 16px' }}>⏹ Stop Recording</button>
                          )}
                          <span style={{ fontSize: 12, color: '#64748b' }}>OR</span>
                          <input type="file" accept="audio/*,video/*" onChange={handleFileUpload} style={{ fontSize: 12 }} />
                        </div>
                        {audioBlob && (
                          <div style={{ marginTop: 12 }}>
                            <audio controls src={URL.createObjectURL(audioBlob)} style={{ width: '100%' }} />
                            <p style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>✓ Audio ready to upload</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="portal-btn-secondary" onClick={() => { setShowAddDiscovery(false); setAudioBlob(null); }}>Cancel</button>
                      <button type="submit" className="portal-btn-primary" disabled={submitting}>
                        {submitting ? (isUploadingAudio ? 'Uploading Audio...' : 'Saving...') : 'Save Record'}
                      </button>
                    </div>
                  </form>
                )}

                {discoveries.length === 0 ? (
                  <div className="portal-empty-state"><p className="portal-empty-title">No discovery records recorded yet</p></div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {discoveries.map((disc) => (
                      <div key={disc.id} style={{ border: '1px solid #e8ecf3', padding: 14, borderRadius: 8, background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                          <div>
                            <span className="code-badge" style={{ marginBottom: 6, display: 'inline-block' }}>{disc.meeting_date || 'No Date'}</span>
                            <strong style={{ fontSize: 14, display: 'block' }}>{disc.summary}</strong>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {disc.transcription_status === 'pending' && (<span className="portal-badge badge-amber">⏳ Transcribing Audio...</span>)}
                            {disc.transcription_status === 'failed' && (<span className="portal-badge badge-amber" style={{ background: '#fee2e2', color: '#991b1b' }}>❌ Transcription Failed</span>)}
                            {disc.status !== 'approved' && (<span className="portal-badge badge-amber">⏳ Pending Senior Review</span>)}
                            {disc.status === 'approved' && (<span className="portal-badge badge-green">✓ Approved</span>)}
                          </div>
                        </div>
                        
                        {disc.notes && <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>{disc.notes}</p>}
                        
                        {disc.audio_url && (
                          <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 8 }}>
                            <audio controls src={disc.audio_url} style={{ width: '100%', height: 36 }} />
                          </div>
                        )}

                        {disc.transcript && (
                          <div style={{ marginTop: 10, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, position: 'relative' }}>
                            <strong style={{ fontSize: 12, color: '#166534', display: 'block', marginBottom: 4 }}>AI Transcript:</strong>
                            <p style={{ fontSize: 13, color: '#14532d', margin: 0, lineHeight: 1.5 }}>{disc.transcript}</p>
                          </div>
                        )}

                        {canApprove && disc.status !== 'approved' && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e8ecf3', display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="button" className="portal-btn-primary" style={{ height: 30, fontSize: 12 }} onClick={async () => {
                              await supabase.from('discovery_records').update({ status: 'approved' }).eq('id', disc.id);
                              setStatusMessage({ type: 'success', text: 'Discovery record approved.' });
                              await refreshAllProjectData();
                            }}>Approve Discovery ✓</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'requirements' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Requirements Matrix ({requirements.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Prioritized functional and technical scope deliverables.</p>
                  </div>
                  {canDraft && !showAddReq && (
                    <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddReq(true)}>
                      <span>+</span> Add Requirement
                    </button>
                  )}
                </div>

                {showAddReq && canDraft && (
                  <form onSubmit={handleAddRequirement} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                      <input className="form-input" placeholder="Ref (e.g. REQ-AUTH-01) *" value={reqRef} onChange={(e) => setReqRef(e.target.value)} required />
                      <input className="form-input" placeholder="Requirement Title *" value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} required />
                      <select className="form-input" value={reqPriority} onChange={(e) => setReqPriority(e.target.value)}>
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="portal-btn-secondary" onClick={() => setShowAddReq(false)}>Cancel</button>
                      <button type="submit" className="portal-btn-primary" disabled={submitting}>Save</button>
                    </div>
                  </form>
                )}

                <table className="portal-table">
                  <thead><tr><th>Ref</th><th>Title</th><th>Priority</th><th>Status</th></tr></thead>
                  <tbody>
                    {requirements.map((r) => (
                      <tr key={r.id}>
                        <td><span className="code-badge">{r.requirement_ref}</span></td>
                        <td><strong>{r.title}</strong></td>
                        <td><span className="portal-badge badge-blue">{r.priority}</span></td>
                        <td><span className={approvalBadgeClass(r.status)}>{formatApprovalStatus(r.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'commercials' && (
              <div style={{ display: 'grid', gap: 24 }}>
                {/* Quotations Card */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Quotations & Proposals ({quotations.length})</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Formal line-item quotes, billing estimates, and commercial status.</p>
                    </div>
                    {canDraft && !showAddQuote && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button 
                          type="button" 
                          className="portal-btn-secondary" 
                          style={{ height: 34, fontSize: 12, background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }} 
                          onClick={async () => {
                            setSubmitting(true);
                            setStatusMessage({ type: 'success', text: 'AI is writing your quotation... This may take 10 seconds.' });
                            try {
                              const res = await fetch('/api/generate-document', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ projectId: id, documentType: 'quotation' })
                              });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.error);
                              setStatusMessage({ type: 'success', text: 'AI Quotation generated! Check the Documents tab to review it.' });
                              setActiveTab('documents');
                              await refreshAllProjectData();
                            } catch (err: any) {
                              setStatusMessage({ type: 'error', text: err.message });
                            } finally {
                              setSubmitting(false);
                            }
                          }}
                          disabled={submitting}
                        >
                          ✨ AI Generate Quotation
                        </button>
                        <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddQuote(true)}>
                          <span>+</span> Manual Quotation
                        </button>
                      </div>
                    )}
                  </div>

                  {showAddQuote && canDraft && (
                    <form onSubmit={handleCreateQuotation} style={{ background: '#f8fafc', padding: 20, borderRadius: 12, marginBottom: 20 }}>
                      <h4 style={{ margin: '0 0 14px' }}>Draft Quotation</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                        <input className="form-input" placeholder="Quotation Title *" value={quoteTitle} onChange={(e) => setQuoteTitle(e.target.value)} required />
                        <select className="form-input" value={quoteCurrency} onChange={(e) => setQuoteCurrency(e.target.value)}>
                          <option value="ZAR">ZAR (R)</option>
                          <option value="USD">USD ($)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="GBP">GBP (£)</option>
                        </select>
                        <input type="date" className="form-input" value={quoteValidity} onChange={(e) => setQuoteValidity(e.target.value)} />
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <label className="form-label" style={{ marginBottom: 6 }}>Line Items</label>
                        {quoteLines.map((line, idx) => (
                          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input className="form-input" style={{ flex: 3 }} placeholder="Description" value={line.description} onChange={(e) => {
                              const newLines = [...quoteLines]; newLines[idx].description = e.target.value; setQuoteLines(newLines)
                            }} />
                            <input type="number" className="form-input" style={{ flex: 1 }} placeholder="Qty" value={line.quantity} onChange={(e) => {
                              const newLines = [...quoteLines]; newLines[idx].quantity = Number(e.target.value); setQuoteLines(newLines)
                            }} />
                            <input type="number" className="form-input" style={{ flex: 1.5 }} placeholder="Unit Rate" value={line.unit_amount} onChange={(e) => {
                              const newLines = [...quoteLines]; newLines[idx].unit_amount = Number(e.target.value); setQuoteLines(newLines)
                            }} />
                          </div>
                        ))}
                        <button type="button" className="portal-back-btn" style={{ fontSize: 12, marginTop: 4 }} onClick={() => setQuoteLines([...quoteLines, { description: '', quantity: 1, unit_amount: 0, amount: 0, tax_rate: 15 }])}>
                          + Add another line
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                        <button type="button" className="portal-btn-secondary" onClick={() => setShowAddQuote(false)}>Cancel</button>
                        <button type="submit" className="portal-btn-primary" disabled={submitting}>Save Quotation</button>
                      </div>
                    </form>
                  )}

                  {quotations.length === 0 ? (
                    <div className="portal-empty-state"><p className="portal-empty-title">No quotations drafted yet</p></div>
                  ) : (
                    <table className="portal-table">
                      <thead><tr><th>Title</th><th>Validity</th><th>Total Value</th><th>Status</th>{canApprove && <th>Action</th>}</tr></thead>
                      <tbody>
                        {quotations.map((q) => {
                          const totals = quotationTotals.find((t) => t.id === q.id)
                          return (
                            <tr key={q.id}>
                              <td><strong>{q.title}</strong></td>
                              <td>{q.validity_date ? `Valid until ${q.validity_date}` : 'Open'}</td>
                              <td><strong style={{ color: '#10b981' }}>{q.currency} {totals ? totals.total.toLocaleString() : '—'}</strong></td>
                              <td><span className={`portal-badge ${q.status === 'accepted' ? 'badge-green' : 'badge-amber'}`}>{q.status}</span></td>
                              {canApprove && (
                                <td>
                                  {q.status === 'draft' && (
                                    <button type="button" className="portal-btn-secondary" style={{ height: 28, fontSize: 11 }} onClick={() => handleUpdateQuotationStatus(q.id, 'sent')}>Mark Sent</button>
                                  )}
                                  {q.status === 'sent' && (
                                    <button type="button" className="portal-btn-primary" style={{ height: 28, fontSize: 11 }} onClick={() => handleUpdateQuotationStatus(q.id, 'accepted')}>Mark Accepted ✓</button>
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Deposits Card */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Milestone Deposits & Payments ({deposits.length})</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Required upfront commitments and confirmed payment receipts.</p>
                    </div>
                    {canApprove && !showAddDeposit && (
                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddDeposit(true)}>
                        <span>+</span> Add Deposit Milestone
                      </button>
                    )}
                  </div>

                  {showAddDeposit && canApprove && (
                    <form onSubmit={handleAddDeposit} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                        <input className="form-input" placeholder="Amount (ZAR) *" type="number" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} required />
                        <input className="form-input" placeholder="Trigger (e.g. 50% upfront)" value={depTrigger} onChange={(e) => setDepTrigger(e.target.value)} />
                        <input type="date" className="form-input" value={depDue} onChange={(e) => setDepDue(e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                        <button type="button" className="portal-btn-secondary" onClick={() => setShowAddDeposit(false)}>Cancel</button>
                        <button type="submit" className="portal-btn-primary" disabled={submitting}>Save</button>
                      </div>
                    </form>
                  )}

                  <table className="portal-table">
                    <thead><tr><th>Trigger / Milestone</th><th>Amount</th><th>Due Date</th><th>Status</th><th>External Verification</th></tr></thead>
                    <tbody>
                      {deposits.map((dep) => {
                        const confirmation = confirmationByDeposit.get(dep.id)
                        const legacyManual = confirmation?.actor_type === 'legacy_manual'
                        const legacyVerifier = confirmation?.confirmed_by ? teamProfiles.find((member) => member.id === confirmation.confirmed_by)?.full_name : undefined
                        return (
                          <tr key={dep.id}>
                            <td><strong>{dep.trigger || 'Milestone Deposit'}</strong></td>
                            <td><strong>{dep.currency} {Number(dep.amount).toLocaleString()}</strong></td>
                            <td>{dep.due_date || 'On Signing'}</td>
                            <td><span className={`portal-badge ${dep.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>{dep.status === 'paid' ? '✓ Paid & Confirmed' : '⏳ Awaiting External Verification'}</span></td>
                            <td>
                              {confirmation ? (
                                <div style={{ display: 'grid', gap: 2 }}>
                                  <strong style={{ fontSize: 12, color: '#334155' }}>{legacyManual ? 'Legacy manual confirmation' : confirmation.provider || dep.verified_by_provider || 'External payment feed'}</strong>
                                  <span style={{ fontSize: 11, color: '#64748b' }}>Ref: {confirmation.external_reference || confirmation.reference || dep.external_reference || '—'}</span>
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{legacyManual ? 'Recorded' : 'Verified'} {formatVerifiedAt(confirmation.verified_at || dep.verified_at || confirmation.created_at)}{legacyManual && legacyVerifier ? ` by ${legacyVerifier}` : ''}</span>
                                </div>
                              ) : dep.status === 'paid' ? (
                                <span style={{ fontSize: 11, color: '#64748b' }}>Ref: {dep.external_reference || '—'}</span>
                              ) : (
                                <span className="portal-badge badge-gray">Awaiting webhook</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
                    Payment confirmations are verified automatically by the external accounting webhook. Manual confirmation is disabled.
                  </div>
                </div>

                {/* Purchase Orders */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div><h3>Client Purchase Orders ({purchaseOrders.length})</h3></div>
                    {canApprove && !showAddPO && (
                      <button type="button" className="portal-btn-secondary" style={{ height: 32, fontSize: 12 }} onClick={() => setShowAddPO(true)}>+ Record PO</button>
                    )}
                  </div>
                  {showAddPO && canApprove && (
                    <form onSubmit={handleAddPO} style={{ background: '#f8fafc', padding: 16, borderRadius: 10, marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                        <input className="form-input" placeholder="PO Number (e.g. PO-98124) *" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} required />
                        <input className="form-input" placeholder="Amount" type="number" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} />
                        <input type="date" className="form-input" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                        <button type="button" className="portal-btn-secondary" onClick={() => setShowAddPO(false)}>Cancel</button>
                        <button type="submit" className="portal-btn-primary" disabled={submitting}>Save PO</button>
                      </div>
                    </form>
                  )}
                  {purchaseOrders.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: 13 }}>No purchase orders recorded yet.</p>
                  ) : (
                    <table className="portal-table">
                      <thead><tr><th>PO Number</th><th>Amount</th><th>Date</th></tr></thead>
                      <tbody>
                        {purchaseOrders.map((po) => (
                          <tr key={po.id}>
                            <td><span className="code-badge">{po.po_number}</span></td>
                            <td>{po.currency} {Number(po.amount).toLocaleString()}</td>
                            <td>{po.po_date || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Document Governance & Approvals ({documents.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Scope of Work, Architecture Specifications, and Revision Histories.</p>
                  </div>
                  {canDraft && !showAddDoc && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button 
                        type="button" 
                        className="portal-btn-secondary" 
                        style={{ height: 34, fontSize: 12, background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }} 
                        onClick={async () => {
                          setSubmitting(true);
                          setStatusMessage({ type: 'success', text: 'AI is generating the SLA...' });
                          try {
                            const res = await fetch('/api/generate-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, documentType: 'sla' }) });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error);
                            setStatusMessage({ type: 'success', text: 'AI SLA generated! Review it below.' });
                            await refreshAllProjectData();
                          } catch (err: any) {
                            setStatusMessage({ type: 'error', text: err.message });
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                        disabled={submitting}
                      >
                        ✨ AI Generate SLA
                      </button>
                      
                      <button 
                        type="button" 
                        className="portal-btn-secondary" 
                        style={{ height: 34, fontSize: 12, background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }} 
                        onClick={async () => {
                          setSubmitting(true);
                          setStatusMessage({ type: 'success', text: 'AI is generating the PRD...' });
                          try {
                            const res = await fetch('/api/generate-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, documentType: 'prd' }) });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error);
                            setStatusMessage({ type: 'success', text: 'AI PRD generated! Review it below.' });
                            await refreshAllProjectData();
                          } catch (err: any) {
                            setStatusMessage({ type: 'error', text: err.message });
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                        disabled={submitting}
                      >
                        ✨ AI Generate PRD
                      </button>

                      <button 
                        type="button" 
                        className="portal-btn-secondary" 
                        style={{ height: 34, fontSize: 12, background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }} 
                        onClick={async () => {
                          setSubmitting(true);
                          setStatusMessage({ type: 'success', text: 'AI is generating the SRS (Requirements)...' });
                          try {
                            const res = await fetch('/api/generate-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, documentType: 'requirements' }) });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error);
                            setStatusMessage({ type: 'success', text: 'AI SRS generated! Review it below.' });
                            await refreshAllProjectData();
                          } catch (err: any) {
                            setStatusMessage({ type: 'error', text: err.message });
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                        disabled={submitting}
                      >
                        ✨ AI Generate SRS
                      </button>

                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => { setEditingDocId(null); setShowAddDoc(true); }}>
                        <span>+</span> Manual Document
                      </button>
                    </div>
                  )}
                </div>

                {editingDoc && (
                  <form onSubmit={handleSaveDocumentDraft} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18, border: '1px solid #e8ecf3' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                      <div>
                        <h4 style={{ margin: 0 }}>Draft: {editingDoc.title}</h4>
                        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                          {editingRevision ? `Current revision #${editingRevision.revision_no}` : 'No revisions yet'}
                          {' · '}
                          {formatDocumentStatus(editingRevision?.status || editingDoc.status, Boolean(editingRevision?.ai_generated), editingDoc.type)}
                          {editingRevision?.storage_ref ? ' · Source file attached' : ''}
                        </p>
                      </div>
                      <button type="button" className="portal-btn-secondary" style={{ height: 30, fontSize: 12 }} onClick={() => { setEditingDocId(null); setDocDraftContent(''); }}>Close</button>
                    </div>
                    <textarea className="form-input" value={docDraftContent} onChange={(e) => setDocDraftContent(e.target.value)} placeholder="Write or paste the initial technical document content here..." rows={14} disabled={!canDraft} style={{ width: '100%', minHeight: 240, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: canDraft ? 'pointer' : 'not-allowed' }}>
                        <input type="checkbox" checked={docDraftAiGenerated} onChange={(e) => setDocDraftAiGenerated(e.target.checked)} disabled={!canDraft} />
                        🤖 AI-Generated Draft
                      </label>
                      {canDraft ? (
                        <button type="submit" className="portal-btn-primary" disabled={submitting}>
                          {submitting ? 'Saving...' : `Submit Draft Revision #${editingNextRevisionNo}`}
                        </button>
                      ) : (
                        <span className="portal-badge badge-gray">Read-only</span>
                      )}
                    </div>
                  </form>
                )}

                {showAddDoc && canDraft && (
                  <form onSubmit={handleAddDocument} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                      <input className="form-input" placeholder="Document Title *" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} required />
                      <select className="form-input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                        <option value="Specification (SOW)">Specification (SOW)</option>
                        <option value="Technical Architecture">Technical Architecture</option>
                        <option value="Handover Dossier">Handover Dossier</option>
                        <option value="Service Agreement">Service Agreement</option>
                        <option value="Quotation">Quotation</option>
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" checked={docAiGenerated} onChange={(e) => setDocAiGenerated(e.target.checked)} />
                        🤖 AI-Generated Draft
                      </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                      <button type="button" className="portal-btn-secondary" onClick={() => setShowAddDoc(false)}>Cancel</button>
                      <button type="submit" className="portal-btn-primary" disabled={submitting}>Create Document</button>
                    </div>
                  </form>
                )}

                {documents.length === 0 ? (
                  <div className="portal-empty-state"><p className="portal-empty-title">No documents uploaded or created yet</p></div>
                ) : (
                  <table className="portal-table">
                    <thead><tr><th>Document Title</th><th>Type</th><th>Revision</th><th>Origin</th><th>Status</th>{canApprove && <th>Sign-off</th>}<th>Action</th></tr></thead>
                    <tbody>
                      {documents.map((doc) => {
                        const rev = getCurrentRevision(doc)
                        const effectiveStatus = doc.status === 'sent_to_client' ? 'sent_to_client' : rev?.status || doc.status
                        return (
                          <tr key={doc.id}>
                            <td>
                              <button type="button" className="portal-table-link" style={{ background: 'none', border: 0, padding: 0, fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => handlePreviewDocument(doc)}>
                                {doc.title}
                              </button>
                            </td>
                            <td><span className="portal-badge badge-gray">{doc.type}</span></td>
                            <td><span className="code-badge">{rev ? `Rev ${rev.revision_no}` : 'No revision'}</span></td>
                            <td>
                              {!rev ? (
                                <span className="portal-badge badge-gray">—</span>
                              ) : rev.ai_generated ? (
                                <span className="portal-badge badge-purple" title={`Generated ${formatGeneratedAt(rev.ai_generated_at || rev.created_at)}`}>
                                  🤖 AI Origin · {formatAiOrigin(rev.ai_model, rev.ai_model_version)}
                                </span>
                              ) : (
                                <span className="portal-badge badge-gray">✍️ Manual</span>
                              )}
                            </td>
                            <td><span className={documentStatusBadgeClass(effectiveStatus)}>{formatDocumentStatus(effectiveStatus, Boolean(rev?.ai_generated), doc.type)}</span></td>
                            {canApprove && (
                              <td>
                                {doc.status === 'sent_to_client' ? (
                                  <span className="portal-badge badge-blue">Sent</span>
                                ) : effectiveStatus === 'approved' ? (
                                  // ONLY show "Send to Client" for Quotation, Proposal, and SLA
                                  doc.type === 'Quotation' || doc.type === 'Proposal' || doc.type === 'Service Agreement' ? (
                                    <button type="button" className="portal-btn-primary" style={{ height: 28, fontSize: 11 }} onClick={() => handleSendToClient(doc.id)}>Send to Client</button>
                                  ) : doc.type === 'Prompt File' ? (
                                    <span className="portal-badge badge-green">Internal Only</span>
                                  ) : (
                                    <span className="portal-badge badge-green">Approved</span>
                                  )
                                ) : rev ? (
                                  <button type="button" className="portal-btn-primary" style={{ height: 28, fontSize: 11 }} onClick={() => handlePreviewDocument(doc)}>Review</button>
                                ) : (
                                  <span className="portal-badge badge-gray">No draft</span>
                                )}
                              </td>
                            )}
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button type="button" className="portal-btn-secondary" style={{ height: 28, fontSize: 11 }} onClick={() => handlePreviewDocument(doc)}>Preview</button>
                                {canDraft && (
                                  <button type="button" className="portal-btn-secondary" style={{ height: 28, fontSize: 11 }} onClick={() => handleOpenDocument(doc)}>Draft</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {activeTab === 'readiness' && (
              <div style={{ display: 'grid', gap: 24 }}>
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Pre-Development Readiness Checklist</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Mandatory compliance check before promoting project to Development.</p>
                    </div>
                  </div>

                  {!readinessCheck ? (
                    <div className="portal-empty-state">
                      <p className="portal-empty-title">Readiness checklist has not been generated</p>
                    </div>
                  ) : (
                    <table className="portal-table">
                      <thead><tr><th>Criterion</th><th>Classification</th><th>Result</th>{canApprove && <th>Toggle</th>}</tr></thead>
                      <tbody>
                        {(readinessCheck.readiness_items || []).map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.criterion}</strong>
                              {item.override_reason && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#d97706' }}>⚠️ Overridden: {item.override_reason}</p>}
                            </td>
                            <td><span className={`portal-badge ${item.mandatory ? 'badge-amber' : 'badge-gray'}`}>{item.mandatory ? 'Mandatory' : 'Optional'}</span></td>
                            <td><span className={`portal-badge ${item.result === 'passed' ? 'badge-green' : item.result === 'overridden' ? 'badge-amber' : 'badge-gray'}`}>{item.result === 'passed' ? '✓ Passed' : item.result === 'overridden' ? '⚠️ Overridden' : '⏳ Outstanding'}</span></td>
                            {canApprove && (
                              <td>
                                {item.overridable ? (
                                  <button type="button" className="portal-btn-secondary" style={{ height: 26, fontSize: 11 }} onClick={() => handleToggleReadinessItem(item.id, item.result, item.overridable)}>Toggle Status</button>
                                ) : (
                                  <span className="portal-badge badge-gray">Automatic check</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Project Team & Handover</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Staffing and approval delegation are managed by an Administrator; file the handover dossier here.</p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                    <div style={{ border: '1px solid #e8ecf3', padding: 18, borderRadius: 10 }}>
                      <h4 style={{ margin: '0 0 10px' }}>Project Team & Approval Authority</h4>
                      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Project staffing and approval delegation are controlled from the Admin console.</p>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>Lead Senior Dev / PM</span>
                          <strong style={{ fontSize: 13, color: '#14213d' }}>{leadProfile?.full_name ?? 'Unassigned'}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>Junior developers report to</span>
                          <strong style={{ fontSize: 13, color: '#14213d' }}>{leadProfile?.full_name ?? 'No lead assigned'}</strong>
                        </div>
                        <div>
                          <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Assigned Developers</span>
                          {developerAssignments.length === 0 ? (
                            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>No developers assigned.</p>
                          ) : (
                            <div style={{ display: 'grid', gap: 6 }}>
                              {developerAssignments.map((assignment) => {
                                const member = teamProfiles.find((candidate) => candidate.id === assignment.developer_user_id)
                                return (
                                  <div key={assignment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: '#f8fafc' }}>
                                    <span style={{ fontSize: 12, color: '#334155' }}>{member?.full_name ?? 'Unknown member'}</span>
                                    <span className={`portal-badge ${member?.is_active === false ? 'badge-amber' : assignment.approval_authority ? 'badge-green' : 'badge-gray'}`}>
                                      {member?.is_active === false ? 'Suspended' : assignment.approval_authority ? 'Approval authority' : 'Delivery only'}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {effectiveRole === 'administrator' && (
                        <Link href="/admin" className="portal-btn-secondary" style={{ marginTop: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                          Manage assignments in Admin →
                        </Link>
                      )}
                    </div>

                    <div style={{ border: '1px solid #e8ecf3', padding: 18, borderRadius: 10 }}>
                      <h4 style={{ margin: '0 0 10px' }}>Handover Dossier</h4>
                      {handover ? (
                        <div>
                          <p style={{ fontSize: 13, color: '#14213d', fontWeight: 600 }}>Summary:</p>
                          <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>{handover.scope_summary || 'Standard handover'}</p>
                          {handover.notes && (
                            <>
                              <p style={{ fontSize: 13, color: '#14213d', fontWeight: 600 }}>Technical Instructions:</p>
                              <p style={{ fontSize: 12, color: '#475569', margin: '4px 0' }}>{handover.notes}</p>
                            </>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Prepare technical instructions and scope summary for development kickoff.</p>
                          {canApprove && !showHandoverForm && (
                            <button type="button" className="portal-btn-secondary" onClick={() => setShowHandoverForm(true)}>+ Prepare Handover</button>
                          )}
                        </div>
                      )}
                      {showHandoverForm && canApprove && (
                        <form onSubmit={handleSaveHandover} style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                          <input className="form-input" placeholder="Scope Summary" value={handoverSummary} onChange={(e) => setHandoverSummary(e.target.value)} required />
                          <textarea className="form-input" placeholder="Key technical instructions..." value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button type="button" className="portal-btn-secondary" onClick={() => setShowHandoverForm(false)}>Cancel</button>
                            <button type="submit" className="portal-btn-primary" disabled={submitting}>Save Dossier</button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'devlinks' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Development Links & Repositories ({devLinks.length})</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                      type="button" 
                      className="portal-btn-secondary" 
                      style={{ height: 34, fontSize: 12, background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }} 
                      onClick={async () => {
                        setSubmitting(true);
                        setStatusMessage({ type: 'success', text: 'AI is generating the Developer Prompt (.md)...' });
                        try {
                          const res = await fetch('/api/generate-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, documentType: 'prompt_md' }) });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error);
                          setStatusMessage({ type: 'success', text: 'Dev Prompt generated! Check the Documents tab to download it.' });
                          await refreshAllProjectData();
                        } catch (err: any) {
                          setStatusMessage({ type: 'error', text: err.message });
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                      disabled={submitting}
                    >
                      ✨ Generate Dev Prompt (.md)
                    </button>
                    {canDraft && !showAddLink && (
                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddLink(true)}>
                        <span>+</span> Record Link
                      </button>
                    )}
                  </div>
                </div>
                {showAddLink && canDraft && (
                  <form onSubmit={handleAddDevLink} style={{ background: '#f8fafc', padding: 16, borderRadius: 10, marginBottom: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                      <select className="form-input" value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                        <option value="repository">GitHub / Git Repository</option>
                        <option value="workspace">Staging / Production URL</option>
                        <option value="task_board">Task Board (Jira/Linear)</option>
                        <option value="other">Other Link</option>
                      </select>
                      <input type="url" className="form-input" placeholder="https://github.com/..." value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} required />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                      <button type="button" className="portal-btn-secondary" onClick={() => setShowAddLink(false)}>Cancel</button>
                      <button type="submit" className="portal-btn-primary" disabled={submitting}>Save Link</button>
                    </div>
                  </form>
                )}
                <table className="portal-table">
                  <thead><tr><th>Type</th><th>URL</th><th>Status</th>{canApprove && <th>Action</th>}</tr></thead>
                  <tbody>
                    {devLinks.map((l) => (
                      <tr key={l.id}>
                        <td><span className="portal-badge badge-gray">{l.link_type}</span></td>
                        <td><a href={l.url} target="_blank" rel="noreferrer" className="portal-table-link">{l.url} ↗</a></td>
                        <td><span className={`portal-badge ${l.verified ? 'badge-green' : 'badge-amber'}`}>{formatLinkStatus(l.verified)}</span></td>
                        {canApprove && (
                          <td>
                            {!l.verified && (
                              <button type="button" className="portal-btn-primary" style={{ height: 26, fontSize: 11 }} onClick={() => handleVerifyLink(l.id)}>Verify Link ✓</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {previewDoc && (
            <div className="portal-drawer-overlay" role="presentation" onClick={handleClosePreview}>
              <aside className="portal-drawer" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" onClick={(event) => event.stopPropagation()}>
                <header className="portal-drawer-header">
                  <div>
                    <div className="portal-drawer-eyebrow">
                      <span className="code-badge">{previewDoc.type || 'Document'}</span>
                      <span className={documentStatusBadgeClass(previewStatus)}>
                        {formatDocumentStatus(previewStatus, Boolean(previewRevision?.ai_generated), previewDoc.type)}
                      </span>
                    </div>
                    <h2 id="document-preview-title">{previewDoc.title}</h2>
                    <p className="portal-drawer-meta">
                      {previewRevision ? `Revision #${previewRevision.revision_no} · ${formatDocumentStatus(previewRevision.status, Boolean(previewRevision.ai_generated), previewDoc.type)}` : 'No revision drafted yet'}
                      {previewDoc.sent_to_client_at ? ` · Sent ${formatGeneratedAt(previewDoc.sent_to_client_at)}${previewSender ? ` by ${previewSender.full_name}` : ''}` : ''}
                    </p>
                  </div>
                  <button type="button" className="portal-drawer-close" aria-label="Close document preview" onClick={handleClosePreview}>×</button>
                </header>

                <div className="portal-drawer-body">
                  {previewRevision?.ai_generated && (
                    <div className="portal-ai-origin">
                      <span className="portal-badge badge-purple">🤖 AI Origin</span>
                      <span className="portal-ai-origin-model">{formatAiOrigin(previewRevision.ai_model, previewRevision.ai_model_version)}</span>
                      <span className="portal-ai-origin-time">Generated {formatGeneratedAt(previewRevision.ai_generated_at || previewRevision.created_at)}</span>
                    </div>
                  )}

                  <section className="portal-drawer-section">
                    <div className="portal-drawer-section-header">
                      <h3>Document Content</h3>
                      {previewRevision?.storage_ref && (
                        <a className="portal-table-link" href={previewRevision.storage_ref} target="_blank" rel="noreferrer">Attached source file ↗</a>
                      )}
                    </div>
                    {previewRevision?.content ? (
                      <pre className="portal-document-preview">{previewRevision.content}</pre>
                    ) : (
                      <div className="portal-drawer-empty">
                        <p>No content stored for this revision.</p>
                        {canDraft && <p>Use <strong>Edit Draft</strong> to add the initial content.</p>}
                      </div>
                    )}
                  </section>

                  <section className="portal-drawer-section">
                    <h3>Review Diff</h3>
                    {!previewPreviousRevision ? (
                      <p className="portal-drawer-muted">Initial revision — there is no earlier revision to compare.</p>
                    ) : !previewPreviousRevision.content ? (
                      <p className="portal-drawer-muted">Revision #{previewPreviousRevision.revision_no} has no stored content to compare.</p>
                    ) : (
                      <div className="portal-diff" aria-label="Line-by-line document changes">
                        {previewDiff.map((line, index) => (
                          <div key={`${line.type}-${index}`} className={`portal-diff-line ${line.type}`}>
                            <span className="portal-diff-marker">{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span>
                            <span className="portal-diff-text">{line.text || ' '}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {canApprove && (
                    <section className="portal-drawer-section">
                      <h3>Senior Review Notes</h3>
                      <textarea className="form-input" rows={4} value={docReviewNotes} onChange={(event) => setDocReviewNotes(event.target.value)} placeholder="Record what you reviewed, any edits made, and any conditions before client delivery..." />
                    </section>
                  )}
                </div>

                <footer className="portal-drawer-footer">
                  <p className="portal-drawer-muted">
                    {previewRevision?.ai_generated ? 'AI-generated draft · internal approval is required before client delivery.' : 'Internal document review and client delivery.'}
                  </p>
                  <div className="portal-drawer-actions">
                    <button type="button" className="portal-btn-secondary" onClick={handleClosePreview}>Close</button>
                    {previewDoc.title.includes('.md') && previewRevision?.content && (
                      <button 
                        type="button" 
                        className="portal-btn-secondary" 
                        onClick={() => {
                          const blob = new Blob([previewRevision.content || ''], { type: 'text/markdown' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `XSpark-Dev-Prompt-${project?.project_reference || 'Project'}.md`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }}
                      >
                        ⬇️ Download .md File
                      </button>
                    )}
                    {canDraft && (
                      <button type="button" className="portal-btn-secondary" onClick={() => { handleClosePreview(); handleOpenDocument(previewDoc); }}>Edit Draft</button>
                    )}
                    {canApprove && previewRevision && previewDoc.status !== 'sent_to_client' && (
                      previewDoc.status === 'approved' ? (
                        previewDoc.type === 'Quotation' || previewDoc.type === 'Proposal' || previewDoc.type === 'Service Agreement' ? (
                          <button type="button" className="portal-btn-primary" onClick={() => handleSendToClient(previewDoc.id)} disabled={submitting}>Send to Client</button>
                        ) : null
                      ) : (
                        <button type="button" className="portal-btn-primary" onClick={() => handleApproveDocument(previewDoc.id, previewRevision.id, 'approved', docReviewNotes)} disabled={submitting}>
                          {submitting ? 'Approving...' : 'Approve ✓'}
                        </button>
                      )
                    )}
                  </div>
                </footer>
              </aside>
            </div>
        )}
      </div>
  )
}

export default function ProjectDetailClient({ id }: { id: string }) {
  return (
    <PortalShell title="Project Workspace" breadcrumb="WORKSPACE / PROJECTS / DETAILS">
      <ProjectDetailInner id={id} />
    </PortalShell>
  )
}