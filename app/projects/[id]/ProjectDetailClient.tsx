'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Project = {
  id: string
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
  created_at?: string
  document_revisions?: DocumentRevision[]
}

type DocumentRevision = {
  id: string
  revision_no: number
  ai_generated: boolean
  status: string
  created_at?: string
}

type ReadinessCheck = {
  id: string
  result: string | null
  readiness_items?: ReadinessItem[]
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

type Profile = {
  id: string
  full_name: string
  role: string
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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [readinessCheck, setReadinessCheck] = useState<ReadinessCheck | null>(null)
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [handover, setHandover] = useState<Handover | null>(null)
  const [devLinks, setDevLinks] = useState<DevLink[]>([])

  // Form states
  const [showAddDiscovery, setShowAddDiscovery] = useState(false)
  const [discDate, setDiscDate] = useState('')
  const [discSummary, setDiscSummary] = useState('')
  const [discNotes, setDiscNotes] = useState('')

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

  const [showHandoverForm, setShowHandoverForm] = useState(false)
  const [handoverSummary, setHandoverSummary] = useState('')
  const [handoverNotes, setHandoverNotes] = useState('')

  const [selectedDeveloperId, setSelectedDeveloperId] = useState('')

  const [showAddLink, setShowAddLink] = useState(false)
  const [linkType, setLinkType] = useState('repository')
  const [linkUrl, setLinkUrl] = useState('')

  const [submitting, setSubmitting] = useState(false)

  const canEdit =
    role === 'senior_dev_pm' ||
    role === 'administrator' ||
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator' ||
    (user?.email ? user.email.toLowerCase().includes('senior') : false) ||
    (user?.email ? user.email.toLowerCase().includes('admin') : false)

  const refreshAllProjectData = useCallback(async () => {
    try {
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .select('id, project_reference, name, description, stage, status, clients(client_code, name)')
        .eq('id', id)
        .single()

      if (projErr) {
        setStatusMessage({ type: 'error', text: 'Could not load project: ' + projErr.message })
        return
      }

      setProject(proj as unknown as Project)

      // Discovery
      const { data: d } = await supabase
        .from('discovery_records')
        .select('id, meeting_date, summary, notes, created_at')
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
        .select('id, amount, currency, due_date, trigger, status')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
      setDeposits((dep ?? []) as Deposit[])

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
        .select('id, title, type, status, created_at, document_revisions:document_revisions_document_id_fkey(*)')
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

      // Assignment
      const { data: asgn } = await supabase
        .from('assignments')
        .select('id, developer_user_id, assigned_at')
        .eq('project_id', id)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (asgn) {
        setAssignment(asgn as Assignment)
        setSelectedDeveloperId(asgn.developer_user_id || '')
      }

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
      // Load team profiles for assignments
      const { data: profs } = await supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
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

  // Stage Progression Handler
  async function handleAdvanceStage(newStage: string) {
    if (!project) return
    const prevStage = project.stage

    const { error } = await supabase.from('projects').update({ stage: newStage }).eq('id', project.id)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not change stage: ' + error.message })
      return
    }

    // Record stage history
    await supabase.from('project_stage_history').insert({
      project_id: project.id,
      from_stage: prevStage,
      to_stage: newStage,
      status: project.status,
      changed_by: user?.id,
    })

    // Record audit entry
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

  // --- Handlers: Discovery & Requirements ---
  async function handleAddDiscovery(e: React.FormEvent) {
    e.preventDefault()
    if (!discSummary.trim() && !discNotes.trim()) {
      setStatusMessage({ type: 'error', text: 'A summary or detailed notes are required.' })
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('discovery_records').insert({
      project_id: id,
      meeting_date: discDate || null,
      summary: discSummary.trim() || null,
      notes: discNotes.trim() || null,
      created_by: user?.id,
    })
    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }
    setDiscDate('')
    setDiscSummary('')
    setDiscNotes('')
    setShowAddDiscovery(false)
    setStatusMessage({ type: 'success', text: 'Discovery record saved.' })
    await refreshAllProjectData()
  }

  async function handleAddRequirement(e: React.FormEvent) {
    e.preventDefault()
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
    setStatusMessage({ type: 'success', text: `Requirement ${cleanRef} created.` })
    await refreshAllProjectData()
  }

  // --- Handlers: Quotations & Commercials ---
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

    // Insert line items
    const itemsToInsert = quoteLines.map((line) => ({
      quotation_id: qData.id,
      description: line.description,
      quantity: Number(line.quantity) || 1,
      unit_amount: Number(line.unit_amount) || 0,
      amount: (Number(line.quantity) || 1) * (Number(line.unit_amount) || 0),
      tax_rate: Number(line.tax_rate) || 15,
    }))

    await supabase.from('quotation_line_items').insert(itemsToInsert)

    // Audit log
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

  async function handleConfirmPayment(depositId: string, amount: number) {
    if (!window.confirm('Confirm that this payment has cleared and been received?')) return
    setSubmitting(true)

    // Mark deposit as paid
    await supabase.from('deposits').update({ status: 'paid' }).eq('id', depositId)

    const refCode = `REC-${depositId.slice(0, 8).toUpperCase()}`
    const { error } = await supabase.from('payment_confirmations').insert({
      project_id: id,
      deposit_id: depositId,
      amount,
      payment_date: new Date().toISOString().split('T')[0],
      reference: refCode,
      confirmed_by: user?.id,
    })

    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }

    setStatusMessage({ type: 'success', text: 'Payment confirmed and receipt logged.' })
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

  // --- Handlers: Documents & Approvals ---
  async function handleAddDocument(e: React.FormEvent) {
    e.preventDefault()
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
        status: 'draft',
      })
      .select('id')
      .single()

    if (docErr || !docData) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Could not create document: ' + docErr?.message })
      return
    }

    // Create initial revision #1
    const { data: revData } = await supabase
      .from('document_revisions')
      .insert({
        document_id: docData.id,
        revision_no: 1,
        ai_generated: docAiGenerated,
        created_by: user?.id,
        status: 'pending_review',
      })
      .select('id')
      .single()

    if (revData?.id) {
      await supabase.from('documents').update({ current_revision_id: revData.id }).eq('id', docData.id)
    }

    setSubmitting(false)
    setDocTitle('')
    setShowAddDoc(false)
    setStatusMessage({ type: 'success', text: 'Document revision #1 created and queued for review.' })
    await refreshAllProjectData()
  }

  async function handleApproveDocument(docId: string, revisionId: string, decision: 'approved' | 'rejected') {
    const comment = window.prompt(`Enter review notes for ${decision.toUpperCase()}:`)
    if (comment === null) return

    setSubmitting(true)
    await supabase.from('approvals').insert({
      revision_id: revisionId,
      approver_id: user?.id,
      decision,
      comment,
    })

    await supabase.from('document_revisions').update({ status: decision }).eq('id', revisionId)
    await supabase.from('documents').update({ status: decision }).eq('id', docId)

    setSubmitting(false)
    setStatusMessage({ type: 'success', text: `Document revision marked as ${decision}.` })
    await refreshAllProjectData()
  }

  // --- Handlers: Readiness & Developer Handover ---
  async function handleInitializeReadiness() {
    setSubmitting(true)
    const { data: rc, error: rcErr } = await supabase
      .from('readiness_checks')
      .insert({
        project_id: id,
        run_by: user?.id,
        result: 'pending',
      })
      .select('id')
      .single()

    if (rcErr || !rc) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: rcErr?.message || 'Failed to start readiness check' })
      return
    }

    // Default criteria as mandated by the SRS
    const defaultCriteria = [
      { criterion: 'Initial milestone deposit paid and confirmed', mandatory: true, overridable: false },
      { criterion: 'Scope of Work & Requirements approved by Senior PM', mandatory: true, overridable: false },
      { criterion: 'Source repository initialized and verified', mandatory: true, overridable: true },
      { criterion: 'Client technical contact assigned', mandatory: false, overridable: true },
    ]

    await supabase.from('readiness_items').insert(
      defaultCriteria.map((c) => ({
        readiness_check_id: rc.id,
        criterion: c.criterion,
        mandatory: c.mandatory,
        overridable: c.overridable,
        result: 'outstanding',
      }))
    )

    setSubmitting(false)
    setStatusMessage({ type: 'success', text: 'Readiness checklist generated.' })
    await refreshAllProjectData()
  }

  async function handleToggleReadinessItem(itemId: string, currentResult: string, overridable: boolean) {
    if (!canEdit) return

    let nextResult = currentResult === 'passed' ? 'outstanding' : 'passed'
    let overrideReason = null

    if (currentResult === 'outstanding' && overridable && window.confirm('Mark this criterion as Overridden instead of Passed?')) {
      nextResult = 'overridden'
      overrideReason = window.prompt('Provide reason for overriding this criterion:')
      if (!overrideReason) return
    }

    await supabase
      .from('readiness_items')
      .update({
        result: nextResult,
        override_reason: overrideReason,
        overridden_by: nextResult === 'overridden' ? user?.id : null,
      })
      .eq('id', itemId)

    await refreshAllProjectData()
  }

  async function handleAssignDeveloper() {
    if (!selectedDeveloperId) return
    setSubmitting(true)

    const { error } = await supabase.from('assignments').insert({
      project_id: id,
      developer_user_id: selectedDeveloperId,
      assigned_by: user?.id,
    })

    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }

    setStatusMessage({ type: 'success', text: 'Development lead assigned to project.' })
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

  // --- Handlers: Dev Links ---
  async function handleAddDevLink(e: React.FormEvent) {
    e.preventDefault()
    if (!linkUrl.trim()) return
    setSubmitting(true)
    await supabase.from('development_links').insert({
      project_id: id,
      link_type: linkType,
      url: linkUrl.trim(),
      recorded_by: user?.id,
    })
    setLinkUrl('')
    setSubmitting(false)
    setShowAddLink(false)
    setStatusMessage({ type: 'success', text: 'Development link recorded.' })
    await refreshAllProjectData()
  }

  async function handleVerifyLink(linkId: string) {
    await supabase
      .from('development_links')
      .update({
        verified: true,
        verified_by: user?.id,
        verified_at: new Date().toISOString(),
      })
      .eq('id', linkId)
    setStatusMessage({ type: 'success', text: 'Link verified.' })
    await refreshAllProjectData()
  }

  // Computed totals for Quotations tab
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

  return (
    <div style={{ maxWidth: 1100 }}>
        {/* Back Link */}
        <button
          type="button"
          className="portal-back-btn"
          onClick={() => router.push('/projects')}
        >
          <span>←</span> Back to all projects
        </button>

        {/* Notifications */}
        {statusMessage && (
          <div
            className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'}
            style={{ marginBottom: 20 }}
            role="alert"
          >
            <span>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{statusMessage.text}</span>
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
              <Link href="/projects" className="portal-btn-primary">
                Return to Projects
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Project Header Card */}
            <div className="portal-detail-header">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <span className="code-badge" style={{ marginBottom: 8 }}>
                    {project.project_reference}
                  </span>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: '#14213d', margin: '4px 0 0' }}>
                    {project.name}
                  </h2>
                  {project.description && (
                    <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>
                      {project.description}
                    </p>
                  )}
                </div>

                {/* Stage Advance Dropdown for Senior PM */}
                {canEdit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Stage:</span>
                    <select
                      className="form-input"
                      style={{ width: 'auto', height: 36, fontSize: 12, fontWeight: 600 }}
                      value={project.stage}
                      onChange={(e) => handleAdvanceStage(e.target.value)}
                    >
                      {PROJECT_STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Interactive Visual Stage Stepper */}
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
                      {i < PROJECT_STAGES.length - 1 && (
                        <div className={`step-divider ${isDone ? 'completed' : ''}`} />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>

              {/* Meta Grid */}
              <div className="portal-detail-meta-grid">
                <div className="portal-meta-item">
                  <label>Client</label>
                  <span>
                    {project.clients?.name ?? 'Unassigned'} ({project.clients?.client_code})
                  </span>
                </div>
                <div className="portal-meta-item">
                  <label>Current Stage</label>
                  <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#4361ee' }}>
                    {project.stage}
                  </span>
                </div>
                <div className="portal-meta-item">
                  <label>Status</label>
                  <span style={{ textTransform: 'capitalize' }}>{project.status}</span>
                </div>
                <div className="portal-meta-item">
                  <label>Developer Lead</label>
                  <span>
                    {assignment
                      ? teamProfiles.find((p) => p.id === assignment.developer_user_id)?.full_name || 'Assigned'
                      : 'Unassigned'}
                  </span>
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="portal-tabs">
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'discovery' ? 'active' : ''}`}
                onClick={() => setActiveTab('discovery')}
              >
                <span>🔍 Discovery</span>
                <span className="portal-tab-count">{discoveries.length}</span>
              </button>
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'requirements' ? 'active' : ''}`}
                onClick={() => setActiveTab('requirements')}
              >
                <span>📋 Requirements</span>
                <span className="portal-tab-count">{requirements.length}</span>
              </button>
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'commercials' ? 'active' : ''}`}
                onClick={() => setActiveTab('commercials')}
              >
                <span>💰 Commercials</span>
                <span className="portal-tab-count">{quotations.length + deposits.length}</span>
              </button>
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
                onClick={() => setActiveTab('documents')}
              >
                <span>📄 Documents</span>
                <span className="portal-tab-count">{documents.length}</span>
              </button>
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'readiness' ? 'active' : ''}`}
                onClick={() => setActiveTab('readiness')}
              >
                <span>✅ Readiness & Handover</span>
                <span className="portal-tab-count">
                  {readinessCheck?.readiness_items?.length || (handover ? 1 : 0)}
                </span>
              </button>
              <button
                type="button"
                className={`portal-tab-btn ${activeTab === 'devlinks' ? 'active' : ''}`}
                onClick={() => setActiveTab('devlinks')}
              >
                <span>🔗 Dev Links</span>
                <span className="portal-tab-count">{devLinks.length}</span>
              </button>
            </div>

            {/* =========================================================
                TAB 1: Discovery Records
                ========================================================= */}
            {activeTab === 'discovery' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Discovery Sessions ({discoveries.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      Notes and takeaways from client briefing sessions.
                    </p>
                  </div>
                  {canEdit && !showAddDiscovery && (
                    <button
                      type="button"
                      className="portal-btn-primary"
                      style={{ height: 34, fontSize: 12 }}
                      onClick={() => setShowAddDiscovery(true)}
                    >
                      <span>+</span> Add Discovery Record
                    </button>
                  )}
                </div>

                {showAddDiscovery && canEdit && (
                  <form onSubmit={handleAddDiscovery} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <input type="date" className="form-input" value={discDate} onChange={(e) => setDiscDate(e.target.value)} />
                      <input className="form-input" placeholder="Session Summary / Key Decisions *" value={discSummary} onChange={(e) => setDiscSummary(e.target.value)} required />
                      <textarea className="form-input" style={{ minHeight: 70 }} placeholder="Detailed meeting notes..." value={discNotes} onChange={(e) => setDiscNotes(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="portal-btn-secondary" onClick={() => setShowAddDiscovery(false)}>Cancel</button>
                      <button type="submit" className="portal-btn-primary" disabled={submitting}>Save</button>
                    </div>
                  </form>
                )}

                {discoveries.length === 0 ? (
                  <div className="portal-empty-state">
                    <p className="portal-empty-title">No discovery records recorded yet</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {discoveries.map((disc) => (
                      <div key={disc.id} style={{ border: '1px solid #e8ecf3', padding: 14, borderRadius: 8, background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="code-badge">{disc.meeting_date || 'No Date'}</span>
                          <strong style={{ fontSize: 14 }}>{disc.summary}</strong>
                        </div>
                        {disc.notes && <p style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{disc.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* =========================================================
                TAB 2: Requirements
                ========================================================= */}
            {activeTab === 'requirements' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Requirements Matrix ({requirements.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      Prioritized functional and technical scope deliverables.
                    </p>
                  </div>
                  {canEdit && !showAddReq && (
                    <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddReq(true)}>
                      <span>+</span> Add Requirement
                    </button>
                  )}
                </div>

                {showAddReq && canEdit && (
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
                  <thead>
                    <tr><th>Ref</th><th>Title</th><th>Priority</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {requirements.map((r) => (
                      <tr key={r.id}>
                        <td><span className="code-badge">{r.requirement_ref}</span></td>
                        <td><strong>{r.title}</strong></td>
                        <td><span className="portal-badge badge-blue">{r.priority}</span></td>
                        <td><span className="portal-badge badge-gray">{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* =========================================================
                TAB 3: Commercials & Financials
                ========================================================= */}
            {activeTab === 'commercials' && (
              <div style={{ display: 'grid', gap: 24 }}>
                {/* Quotations Card */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Quotations & Proposals ({quotations.length})</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                        Formal line-item quotes, billing estimates, and commercial status.
                      </p>
                    </div>
                    {canEdit && !showAddQuote && (
                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddQuote(true)}>
                        <span>+</span> New Quotation
                      </button>
                    )}
                  </div>

                  {showAddQuote && canEdit && (
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
                            <input
                              className="form-input"
                              style={{ flex: 3 }}
                              placeholder="Description"
                              value={line.description}
                              onChange={(e) => {
                                const newLines = [...quoteLines]
                                newLines[idx].description = e.target.value
                                setQuoteLines(newLines)
                              }}
                            />
                            <input
                              type="number"
                              className="form-input"
                              style={{ flex: 1 }}
                              placeholder="Qty"
                              value={line.quantity}
                              onChange={(e) => {
                                const newLines = [...quoteLines]
                                newLines[idx].quantity = Number(e.target.value)
                                setQuoteLines(newLines)
                              }}
                            />
                            <input
                              type="number"
                              className="form-input"
                              style={{ flex: 1.5 }}
                              placeholder="Unit Rate"
                              value={line.unit_amount}
                              onChange={(e) => {
                                const newLines = [...quoteLines]
                                newLines[idx].unit_amount = Number(e.target.value)
                                setQuoteLines(newLines)
                              }}
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          className="portal-back-btn"
                          style={{ fontSize: 12, marginTop: 4 }}
                          onClick={() => setQuoteLines([...quoteLines, { description: '', quantity: 1, unit_amount: 0, amount: 0, tax_rate: 15 }])}
                        >
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
                      <thead>
                        <tr><th>Title</th><th>Validity</th><th>Total Value</th><th>Status</th>{canEdit && <th>Action</th>}</tr>
                      </thead>
                      <tbody>
                        {quotations.map((q) => {
                          const totals = quotationTotals.find((t) => t.id === q.id)
                          return (
                            <tr key={q.id}>
                              <td><strong>{q.title}</strong></td>
                              <td>{q.validity_date ? `Valid until ${q.validity_date}` : 'Open'}</td>
                              <td>
                                <strong style={{ color: '#10b981' }}>
                                  {q.currency} {totals ? totals.total.toLocaleString() : '—'}
                                </strong>
                              </td>
                              <td>
                                <span className={`portal-badge ${q.status === 'accepted' ? 'badge-green' : 'badge-amber'}`}>
                                  {q.status}
                                </span>
                              </td>
                              {canEdit && (
                                <td>
                                  {q.status === 'draft' && (
                                    <button
                                      type="button"
                                      className="portal-btn-secondary"
                                      style={{ height: 28, fontSize: 11 }}
                                      onClick={() => handleUpdateQuotationStatus(q.id, 'sent')}
                                    >
                                      Mark Sent
                                    </button>
                                  )}
                                  {q.status === 'sent' && (
                                    <button
                                      type="button"
                                      className="portal-btn-primary"
                                      style={{ height: 28, fontSize: 11 }}
                                      onClick={() => handleUpdateQuotationStatus(q.id, 'accepted')}
                                    >
                                      Mark Accepted ✓
                                    </button>
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

                {/* Deposits & Milestone Payments Card */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Milestone Deposits & Payments ({deposits.length})</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                        Required upfront commitments and confirmed payment receipts.
                      </p>
                    </div>
                    {canEdit && !showAddDeposit && (
                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddDeposit(true)}>
                        <span>+</span> Add Deposit Milestone
                      </button>
                    )}
                  </div>

                  {showAddDeposit && canEdit && (
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
                    <thead>
                      <tr><th>Trigger / Milestone</th><th>Amount</th><th>Due Date</th><th>Status</th>{canEdit && <th>Action</th>}</tr>
                    </thead>
                    <tbody>
                      {deposits.map((dep) => (
                        <tr key={dep.id}>
                          <td><strong>{dep.trigger || 'Milestone Deposit'}</strong></td>
                          <td><strong>{dep.currency} {Number(dep.amount).toLocaleString()}</strong></td>
                          <td>{dep.due_date || 'On Signing'}</td>
                          <td>
                            <span className={`portal-badge ${dep.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                              {dep.status === 'paid' ? '✓ Paid & Confirmed' : '⏳ Awaiting Payment'}
                            </span>
                          </td>
                          {canEdit && (
                            <td>
                              {dep.status !== 'paid' && (
                                <button
                                  type="button"
                                  className="portal-btn-primary"
                                  style={{ height: 28, fontSize: 11 }}
                                  onClick={() => handleConfirmPayment(dep.id, dep.amount)}
                                >
                                  Confirm Received ✓
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Purchase Orders */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Client Purchase Orders ({purchaseOrders.length})</h3>
                    </div>
                    {canEdit && !showAddPO && (
                      <button type="button" className="portal-btn-secondary" style={{ height: 32, fontSize: 12 }} onClick={() => setShowAddPO(true)}>
                        + Record PO
                      </button>
                    )}
                  </div>
                  {showAddPO && canEdit && (
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

            {/* =========================================================
                TAB 4: Documents & Approvals
                ========================================================= */}
            {activeTab === 'documents' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Document Governance & Approvals ({documents.length})</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      Scope of Work, Architecture Specifications, and Revision Histories.
                    </p>
                  </div>
                  {canEdit && !showAddDoc && (
                    <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddDoc(true)}>
                      <span>+</span> New Document
                    </button>
                  )}
                </div>

                {showAddDoc && canEdit && (
                  <form onSubmit={handleAddDocument} style={{ background: '#f8fafc', padding: 18, borderRadius: 10, marginBottom: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                      <input className="form-input" placeholder="Document Title *" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} required />
                      <select className="form-input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                        <option value="Specification (SOW)">Specification (SOW)</option>
                        <option value="Technical Architecture">Technical Architecture</option>
                        <option value="Handover Dossier">Handover Dossier</option>
                        <option value="Service Agreement">Service Agreement</option>
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" checked={docAiGenerated} onChange={(e) => setDocAiGenerated(e.target.checked)} />
                        🤖 AI-Assisted Draft
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
                    <thead>
                      <tr><th>Document Title</th><th>Type</th><th>Revision</th><th>Origin</th><th>Status</th>{canEdit && <th>Sign-off</th>}</tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => {
                        const rev = doc.document_revisions?.[0]
                        return (
                          <tr key={doc.id}>
                            <td><strong>{doc.title}</strong></td>
                            <td><span className="portal-badge badge-gray">{doc.type}</span></td>
                            <td><span className="code-badge">Rev {rev?.revision_no || 1}</span></td>
                            <td>
                              {rev?.ai_generated ? (
                                <span className="portal-badge badge-purple">🤖 AI Assisted</span>
                              ) : (
                                <span className="portal-badge badge-gray">✍️ Manual</span>
                              )}
                            </td>
                            <td>
                              <span className={`portal-badge ${doc.status === 'approved' ? 'badge-green' : 'badge-amber'}`}>
                                {doc.status}
                              </span>
                            </td>
                            {canEdit && (
                              <td>
                                {doc.status !== 'approved' && rev && (
                                  <button
                                    type="button"
                                    className="portal-btn-primary"
                                    style={{ height: 28, fontSize: 11 }}
                                    onClick={() => handleApproveDocument(doc.id, rev.id, 'approved')}
                                  >
                                    Approve ✓
                                  </button>
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
            )}

            {/* =========================================================
                TAB 5: Readiness Checks & Developer Handover
                ========================================================= */}
            {activeTab === 'readiness' && (
              <div style={{ display: 'grid', gap: 24 }}>
                {/* Readiness Pre-Flight Checklist */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Pre-Development Readiness Checklist</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                        Mandatory compliance check before promoting project to Development.
                      </p>
                    </div>
                    {!readinessCheck && canEdit && (
                      <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={handleInitializeReadiness}>
                        <span>⚙</span> Run Readiness Check
                      </button>
                    )}
                  </div>

                  {!readinessCheck ? (
                    <div className="portal-empty-state">
                      <p className="portal-empty-title">Readiness checklist has not been generated</p>
                      {canEdit && (
                        <button type="button" className="portal-btn-primary" onClick={handleInitializeReadiness}>
                          Generate Readiness Check
                        </button>
                      )}
                    </div>
                  ) : (
                    <table className="portal-table">
                      <thead>
                        <tr><th>Criterion</th><th>Classification</th><th>Result</th>{canEdit && <th>Toggle</th>}</tr>
                      </thead>
                      <tbody>
                        {(readinessCheck.readiness_items || []).map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.criterion}</strong>
                              {item.override_reason && (
                                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#d97706' }}>
                                  ⚠️ Overridden: {item.override_reason}
                                </p>
                              )}
                            </td>
                            <td>
                              <span className={`portal-badge ${item.mandatory ? 'badge-amber' : 'badge-gray'}`}>
                                {item.mandatory ? 'Mandatory' : 'Optional'}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`portal-badge ${
                                  item.result === 'passed'
                                    ? 'badge-green'
                                    : item.result === 'overridden'
                                    ? 'badge-amber'
                                    : 'badge-gray'
                                }`}
                              >
                                {item.result === 'passed' ? '✓ Passed' : item.result === 'overridden' ? '⚠️ Overridden' : '⏳ Outstanding'}
                              </span>
                            </td>
                            {canEdit && (
                              <td>
                                <button
                                  type="button"
                                  className="portal-btn-secondary"
                                  style={{ height: 26, fontSize: 11 }}
                                  onClick={() => handleToggleReadinessItem(item.id, item.result, item.overridable)}
                                >
                                  Toggle Status
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Developer Assignment & Handover Dossier */}
                <div className="portal-card">
                  <div className="portal-card-header">
                    <div>
                      <h3>Developer Assignment & Handover</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                        Assign responsible development engineer and file handover dossier.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                    {/* Developer Assignment Box */}
                    <div style={{ border: '1px solid #e8ecf3', padding: 18, borderRadius: 10 }}>
                      <h4 style={{ margin: '0 0 10px' }}>Development Lead Assignment</h4>
                      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                        Select the primary software engineer accountable for delivery:
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select
                          className="form-input"
                          value={selectedDeveloperId}
                          onChange={(e) => setSelectedDeveloperId(e.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">— Select Developer —</option>
                          {teamProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name} ({p.role})
                            </option>
                          ))}
                        </select>
                        {canEdit && (
                          <button
                            type="button"
                            className="portal-btn-primary"
                            style={{ height: 40 }}
                            onClick={handleAssignDeveloper}
                            disabled={submitting || !selectedDeveloperId}
                          >
                            Assign
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Handover Dossier Box */}
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
                          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                            Prepare technical instructions and scope summary for development kickoff.
                          </p>
                          {canEdit && !showHandoverForm && (
                            <button type="button" className="portal-btn-secondary" onClick={() => setShowHandoverForm(true)}>
                              + Prepare Handover
                            </button>
                          )}
                        </div>
                      )}

                      {showHandoverForm && canEdit && (
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

            {/* =========================================================
                TAB 6: Development Links
                ========================================================= */}
            {activeTab === 'devlinks' && (
              <div className="portal-card">
                <div className="portal-card-header">
                  <div>
                    <h3>Development Links & Repositories ({devLinks.length})</h3>
                  </div>
                  {!showAddLink && (
                    <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddLink(true)}>
                      <span>+</span> Record Link
                    </button>
                  )}
                </div>

                {showAddLink && (
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
                  <thead><tr><th>Type</th><th>URL</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead>
                  <tbody>
                    {devLinks.map((l) => (
                      <tr key={l.id}>
                        <td><span className="portal-badge badge-gray">{l.link_type}</span></td>
                        <td><a href={l.url} target="_blank" rel="noreferrer" className="portal-table-link">{l.url} ↗</a></td>
                        <td><span className={`portal-badge ${l.verified ? 'badge-green' : 'badge-amber'}`}>{l.verified ? '✓ Verified' : '⏳ Unverified'}</span></td>
                        {canEdit && (
                          <td>
                            {!l.verified && (
                              <button type="button" className="portal-btn-primary" style={{ height: 26, fontSize: 11 }} onClick={() => handleVerifyLink(l.id)}>
                                Verify ✓
                              </button>
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
      </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Outer wrapper — provides PortalShell context so usePortal() works inside
// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDetailClient({ id }: { id: string }) {
  return (
    <PortalShell
      title="Project Workspace"
      breadcrumb="WORKSPACE / PROJECTS / DETAILS"
    >
      <ProjectDetailInner id={id} />
    </PortalShell>
  )
}
