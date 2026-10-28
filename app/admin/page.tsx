'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'
import {
  approvalBadgeClass,
  documentStatusBadgeClass,
  formatAiOrigin,
  formatApprovalStatus,
  formatDocumentStatus,
} from '@/lib/roles'

type Profile = {
  id: string
  full_name: string
  role: 'administrator' | 'senior_dev_pm' | 'junior_developer'
  is_active: boolean
  created_at?: string
}

type AuditEntry = {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_value: unknown
  after_value: unknown
  created_at: string
}

type Client = {
  id: string
  client_code: string
  name: string
  email: string | null
  phone: string | null
  created_at: string
}

type Project = {
  id: string
  project_reference: string
  name: string
  stage: string
  status: string
  client_id: string
  created_at: string
  clients: { client_code: string; name: string } | null
}

type Revision = {
  id: string
  revision_no: number
  content: string | null
  status: string
  ai_generated: boolean
  ai_model: string | null
  ai_model_version: string | null
  ai_generated_at: string | null
  created_at: string
}

type DocumentRow = {
  id: string
  project_id: string
  title: string
  type: string | null
  status: string
  current_revision_id: string | null
  sent_to_client_at: string | null
  created_at: string
  projects: { project_reference: string; name: string } | null
  document_revisions: Revision[]
}

type AssignmentRow = {
  id: string
  project_id: string
  developer_user_id: string | null
  assignment_role: 'lead' | 'developer'
  approval_authority: boolean
  is_active: boolean
  assigned_at: string
  revoked_at: string | null
}

type AdminTab = 'portfolio' | 'assignments' | 'users' | 'audit'

const PENDING_DOC_STATUSES = new Set([
  'draft',
  'pending',
  'pending_review',
  'submitted',
  'awaiting_review',
])

function getCurrentRevision(doc: DocumentRow): Revision | undefined {
  const revisions = doc.document_revisions ?? []
  return (
    revisions.find((revision) => revision.id === doc.current_revision_id) ??
    [...revisions].sort((a, b) => b.revision_no - a.revision_no)[0]
  )
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function getStageBadgeClass(stage: string): string {
  switch (stage.toLowerCase()) {
    case 'discovery':
      return 'portal-badge badge-blue'
    case 'scoping':
    case 'requirements':
      return 'portal-badge badge-purple'
    case 'development':
      return 'portal-badge badge-amber'
    case 'completed':
    case 'approved':
      return 'portal-badge badge-green'
    default:
      return 'portal-badge badge-gray'
  }
}

export default function AdminPage() {
  return (
    <PortalShell title="System Administration" breadcrumb="WORKSPACE / ADMIN">
      <AdminContent />
    </PortalShell>
  )
}

function AdminContent() {
  const { role, user } = usePortal()

  const [activeTab, setActiveTab] = useState<AdminTab>('portfolio')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchUser, setSearchUser] = useState('')
  const [auditFilter, setAuditFilter] = useState('all')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [leadSelection, setLeadSelection] = useState<Record<string, string>>({})
  const [developerSelection, setDeveloperSelection] = useState<Record<string, string>>({})

  const isAdmin = role === 'administrator'

  const loadAdminData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)

    try {
      const [profsRes, clientsRes, projectsRes, docsRes, assignmentsRes, auditsRes] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, role, is_active, created_at')
            .order('created_at', { ascending: false }),
          supabase
            .from('clients')
            .select('id, client_code, name, email, phone, created_at')
            .order('name'),
          supabase
            .from('projects')
            .select(
              'id, project_reference, name, stage, status, client_id, created_at, clients(client_code, name)'
            )
            .order('created_at', { ascending: false }),
          supabase
            .from('documents')
            .select(
              'id, project_id, title, type, status, current_revision_id, sent_to_client_at, created_at, projects(project_reference, name), document_revisions:document_revisions_document_id_fkey(id, revision_no, content, status, ai_generated, ai_model, ai_model_version, ai_generated_at, created_at)'
            )
            .order('created_at', { ascending: false }),
          supabase
            .from('assignments')
            .select(
              'id, project_id, developer_user_id, assignment_role, approval_authority, is_active, assigned_at, revoked_at'
            )
            .eq('is_active', true)
            .order('assigned_at', { ascending: true }),
          supabase
            .from('audit_entries')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100),
        ])

      const errors = [
        profsRes.error,
        clientsRes.error,
        projectsRes.error,
        docsRes.error,
        assignmentsRes.error,
        auditsRes.error,
      ].filter(Boolean)

      if (profsRes.data) setProfiles(profsRes.data as Profile[])
      if (clientsRes.data) setClients(clientsRes.data as Client[])
      if (projectsRes.data) setProjects(projectsRes.data as unknown as Project[])
      if (docsRes.data) setDocuments(docsRes.data as unknown as DocumentRow[])
      if (assignmentsRes.data) setAssignments(assignmentsRes.data as AssignmentRow[])
      if (auditsRes.data) setAuditEntries(auditsRes.data as AuditEntry[])

      if (errors.length > 0) {
        setStatusMessage({
          type: 'error',
          text: 'Some governance records could not be loaded: ' + errors[0]?.message,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      // Defer the initial load so the spinner state update happens outside the
      // effect body.
      await Promise.resolve()
      if (!cancelled) await loadAdminData()
    }

    init()

    return () => {
      cancelled = true
    }
  }, [loadAdminData])

  useEffect(() => {
    if (!previewDocId) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewDocId(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewDocId])

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  )

  const leadByProject = useMemo(() => {
    const map = new Map<string, AssignmentRow>()
    assignments
      .filter((assignment) => assignment.assignment_role === 'lead' && assignment.is_active)
      .forEach((assignment) => map.set(assignment.project_id, assignment))
    return map
  }, [assignments])

  const assignmentsByProject = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>()
    assignments
      .filter((assignment) => assignment.is_active)
      .forEach((assignment) => {
        const current = map.get(assignment.project_id) ?? []
        current.push(assignment)
        map.set(assignment.project_id, current)
      })
    return map
  }, [assignments])

  const projectCountByClient = useMemo(() => {
    const map = new Map<string, number>()
    projects.forEach((project) => {
      map.set(project.client_id, (map.get(project.client_id) ?? 0) + 1)
    })
    return map
  }, [projects])

  const documentCountByProject = useMemo(() => {
    const map = new Map<string, number>()
    documents.forEach((document) => {
      map.set(document.project_id, (map.get(document.project_id) ?? 0) + 1)
    })
    return map
  }, [documents])

  const activeSeniorOptions = useMemo(
    () =>
      profiles.filter(
        (profile) => profile.is_active && profile.role === 'senior_dev_pm'
      ),
    [profiles]
  )

  const activeTeamOptions = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.is_active &&
          (profile.role === 'junior_developer' || profile.role === 'senior_dev_pm')
      ),
    [profiles]
  )

  const pendingDocumentCount = useMemo(
    () =>
      documents.filter((document) =>
        PENDING_DOC_STATUSES.has((document.status ?? '').toLowerCase())
      ).length,
    [documents]
  )

  const previewDoc = useMemo(
    () => documents.find((document) => document.id === previewDocId) ?? null,
    [documents, previewDocId]
  )

  const previewRevision = previewDoc ? getCurrentRevision(previewDoc) : undefined

  const filteredUsers = useMemo(() => {
    if (!searchUser.trim()) return profiles
    const q = searchUser.toLowerCase()
    return profiles.filter(
      (profile) =>
        profile.full_name.toLowerCase().includes(q) ||
        profile.role.toLowerCase().includes(q)
    )
  }, [profiles, searchUser])

  const filteredAudits = useMemo(() => {
    if (auditFilter === 'all') return auditEntries
    return auditEntries.filter((entry) => entry.entity_type === auditFilter)
  }, [auditEntries, auditFilter])

  async function handleUpdateRole(
    userId: string,
    newRole: Profile['role'],
    currentRole: string
  ) {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'Only administrators can modify roles.' })
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)

    if (error) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Failed to update role: ' + error.message })
      return
    }

    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'user.role_changed',
      entity_type: 'profile',
      entity_id: userId,
      before_value: { role: currentRole },
      after_value: { role: newRole },
    })

    setSubmitting(false)
    setStatusMessage({
      type: 'success',
      text: `User role updated to ${formatRole(newRole)}.`,
    })
    await loadAdminData(false)
  }

  async function handleToggleUserStatus(userId: string, currentStatus: boolean) {
    if (!isAdmin) return
    const nextStatus = !currentStatus

    setSubmitting(true)
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: nextStatus })
      .eq('id', userId)

    if (error) {
      setSubmitting(false)
      setStatusMessage({ type: 'error', text: 'Failed to update status: ' + error.message })
      return
    }

    setSubmitting(false)
    setStatusMessage({
      type: 'success',
      text: `User marked as ${nextStatus ? 'active' : 'suspended'}.`,
    })
    await loadAdminData(false)
  }

  async function handleAssignLead(projectId: string, userId: string) {
    if (!isAdmin || !userId) return

    const currentLead = leadByProject.get(projectId)
    if (
      currentLead?.developer_user_id &&
      currentLead.developer_user_id !== userId &&
      !window.confirm(
        'Transfer project lead? The current lead will immediately lose approval authority.'
      )
    ) {
      return
    }

    setSubmitting(true)
    const { error } = await supabase.rpc('assign_project_lead', {
      p_project_id: projectId,
      p_user_id: userId,
    })
    setSubmitting(false)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not assign project lead: ' + error.message })
      return
    }

    setLeadSelection((current) => {
      const next = { ...current }
      delete next[projectId]
      return next
    })
    setStatusMessage({
      type: 'success',
      text: 'Project lead assigned. Approval authority transferred to the new lead.',
    })
    await loadAdminData(false)
  }

  async function handleAssignDeveloper(projectId: string, userId: string) {
    if (!isAdmin || !userId) return

    setSubmitting(true)
    const { error } = await supabase.rpc('assign_project_developer', {
      p_project_id: projectId,
      p_user_id: userId,
    })
    setSubmitting(false)

    if (error) {
      setStatusMessage({
        type: 'error',
        text: 'Could not assign developer: ' + error.message,
      })
      return
    }

    setDeveloperSelection((current) => {
      const next = { ...current }
      delete next[projectId]
      return next
    })
    setStatusMessage({ type: 'success', text: 'Developer assigned to the project.' })
    await loadAdminData(false)
  }

  async function handleToggleAuthority(assignmentId: string, enabled: boolean) {
    if (!isAdmin) return

    setSubmitting(true)
    const { error } = await supabase.rpc('set_project_approval_authority', {
      p_assignment_id: assignmentId,
      p_enabled: enabled,
    })
    setSubmitting(false)

    if (error) {
      setStatusMessage({
        type: 'error',
        text: 'Could not update approval authority: ' + error.message,
      })
      return
    }

    setStatusMessage({
      type: 'success',
      text: enabled
        ? 'Approval authority granted for this project.'
        : 'Approval authority revoked for this project.',
    })
    await loadAdminData(false)
  }

  async function handleRemoveAssignment(assignmentId: string) {
    if (!isAdmin) return
    if (!window.confirm('Remove this team member from the project?')) return

    setSubmitting(true)
    const { error } = await supabase.rpc('remove_project_assignment', {
      p_assignment_id: assignmentId,
    })
    setSubmitting(false)

    if (error) {
      setStatusMessage({
        type: 'error',
        text: 'Could not remove assignment: ' + error.message,
      })
      return
    }

    setStatusMessage({ type: 'success', text: 'Team member removed from the project.' })
    await loadAdminData(false)
  }

  return (
    <div style={{ maxWidth: 1180 }}>
      {!isAdmin && (
        <div className="auth-alert-error" style={{ marginBottom: 20 }}>
          <span>ℹ️</span>
          <div>
            <strong>Administrator Access Notice:</strong> You are signed in as a{' '}
            <strong>{formatRole(role)}</strong>. Project staffing, approval delegation and
            user governance are restricted to Administrators.
          </div>
        </div>
      )}

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

      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon clients-tone">♙</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Clients</span>
            <span className="portal-stat-value">{clients.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon projects-tone">▤</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Projects</span>
            <span className="portal-stat-value">{projects.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon home-tone">📄</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Documents</span>
            <span className="portal-stat-value">{documents.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon projects-tone">⏳</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Pending Approvals</span>
            <span className="portal-stat-value">{pendingDocumentCount}</span>
          </div>
        </div>
      </div>

      <div className="portal-tabs">
        <button
          type="button"
          className={`portal-tab-btn ${activeTab === 'portfolio' ? 'active' : ''}`}
          onClick={() => setActiveTab('portfolio')}
        >
          <span>◫ Portfolio Oversight</span>
          <span className="portal-tab-count">{projects.length}</span>
        </button>

        {isAdmin && (
          <button
            type="button"
            className={`portal-tab-btn ${activeTab === 'assignments' ? 'active' : ''}`}
            onClick={() => setActiveTab('assignments')}
          >
            <span>◎ Project Assignments</span>
            <span className="portal-tab-count">{assignments.length}</span>
          </button>
        )}

        <button
          type="button"
          className={`portal-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <span>👥 Users & Roles</span>
          <span className="portal-tab-count">{profiles.length}</span>
        </button>

        <button
          type="button"
          className={`portal-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>📜 Audit Trail</span>
          <span className="portal-tab-count">{auditEntries.length}</span>
        </button>
      </div>

      {loading && (
        <div className="portal-card" style={{ marginBottom: 20 }}>
          <div className="portal-empty-state">
            <div className="portal-empty-icon">⏳</div>
            <p className="portal-empty-title">Loading governance records...</p>
          </div>
        </div>
      )}

      {activeTab === 'portfolio' && (
        <div style={{ display: 'grid', gap: 20 }}>
          <div className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3>Global Client Portfolio</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                  Every client across all teams, with their active project footprint.
                </p>
              </div>
            </div>

            {clients.length === 0 ? (
              <div className="portal-empty-state">
                <div className="portal-empty-icon">♙</div>
                <p className="portal-empty-title">No clients found</p>
              </div>
            ) : (
              <div className="portal-table-container">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Code</th>
                      <th>Contact</th>
                      <th>Projects</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id}>
                        <td>
                          <Link href={`/clients/${client.id}`} className="portal-table-link">
                            <strong>{client.name}</strong>
                          </Link>
                        </td>
                        <td>
                          <span className="code-badge">{client.client_code}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: '#475569' }}>
                            {client.email || client.phone || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="portal-badge badge-blue">
                            {projectCountByClient.get(client.id) ?? 0}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: '#64748b' }}>
                            {formatDateTime(client.created_at)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3>All Projects</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                  Cross-team delivery view with lead, team size and document counts.
                </p>
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="portal-empty-state">
                <div className="portal-empty-icon">▤</div>
                <p className="portal-empty-title">No projects found</p>
              </div>
            ) : (
              <div className="portal-table-container">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Client</th>
                      <th>Stage</th>
                      <th>Status</th>
                      <th>Lead</th>
                      <th>Team</th>
                      <th>Docs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => {
                      const lead = leadByProject.get(project.id)
                      const leadProfile = lead?.developer_user_id
                        ? profileMap.get(lead.developer_user_id)
                        : null
                      const team = (assignmentsByProject.get(project.id) ?? []).filter(
                        (assignment) => assignment.assignment_role === 'developer'
                      )

                      return (
                        <tr key={project.id}>
                          <td>
                            <Link href={`/projects/${project.id}`} className="portal-table-link">
                              <strong>{project.name}</strong>
                            </Link>
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
                              {project.project_reference}
                            </p>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: '#475569' }}>
                              {project.clients?.name ?? '—'}
                            </span>
                          </td>
                          <td>
                            <span className={getStageBadgeClass(project.stage)}>
                              {project.stage.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td>
                            <span className={approvalBadgeClass(project.status)}>
                              {formatApprovalStatus(project.status)}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: '#475569' }}>
                              {leadProfile?.full_name ?? 'Unassigned'}
                            </span>
                          </td>
                          <td>
                            <span className="portal-badge badge-gray">{team.length}</span>
                          </td>
                          <td>
                            <span className="portal-badge badge-gray">
                              {documentCountByProject.get(project.id) ?? 0}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3>All Documents</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                  Global document register. Open any document to inspect its current revision.
                </p>
              </div>
              <span className="portal-badge badge-amber">
                {pendingDocumentCount} awaiting approval
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="portal-empty-state">
                <div className="portal-empty-icon">📄</div>
                <p className="portal-empty-title">No documents found</p>
              </div>
            ) : (
              <div className="portal-table-container">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Project</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Revision</th>
                      <th>Origin</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => {
                      const revision = getCurrentRevision(document)
                      return (
                        <tr key={document.id}>
                          <td>
                            <strong>{document.title}</strong>
                          </td>
                          <td>
                            <Link
                              href={`/projects/${document.project_id}`}
                              className="portal-table-link"
                            >
                              {document.projects?.project_reference ??
                                document.projects?.name ??
                                'Project'}
                            </Link>
                          </td>
                          <td>
                            <span className="code-badge">{document.type || 'Document'}</span>
                          </td>
                          <td>
                            <span
                              className={documentStatusBadgeClass(document.status)}
                            >
                              {formatDocumentStatus(
                                document.status,
                                Boolean(revision?.ai_generated)
                              )}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: '#475569' }}>
                              {revision ? `#${revision.revision_no}` : '—'}
                            </span>
                          </td>
                          <td>
                            {revision?.ai_generated ? (
                              <span className="portal-badge badge-purple">🤖 AI</span>
                            ) : (
                              <span className="portal-badge badge-gray">Manual</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="portal-btn-secondary"
                              style={{ height: 28, fontSize: 11 }}
                              onClick={() => setPreviewDocId(document.id)}
                            >
                              Preview
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'assignments' && isAdmin && (
        <div style={{ display: 'grid', gap: 18 }}>
          {projects.length === 0 && (
            <div className="portal-card">
              <div className="portal-empty-state">
                <div className="portal-empty-icon">◎</div>
                <p className="portal-empty-title">No projects available for staffing</p>
              </div>
            </div>
          )}

          {projects.map((project) => {
            const projectAssignments = assignmentsByProject.get(project.id) ?? []
            const leadAssignment = leadByProject.get(project.id)
            const leadProfile = leadAssignment?.developer_user_id
              ? profileMap.get(leadAssignment.developer_user_id)
              : null
            const developerAssignments = projectAssignments.filter(
              (assignment) => assignment.assignment_role === 'developer'
            )
            const assignedIds = new Set(
              projectAssignments
                .map((assignment) => assignment.developer_user_id)
                .filter((value): value is string => Boolean(value))
            )
            const developerOptions = activeTeamOptions.filter(
              (profile) => !assignedIds.has(profile.id)
            )
            const selectedLeadId =
              leadSelection[project.id] ?? leadAssignment?.developer_user_id ?? ''
            const selectedDeveloperId = developerSelection[project.id] ?? ''

            return (
              <div className="portal-card" key={project.id}>
                <div className="portal-card-header">
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="code-badge">{project.project_reference}</span>
                      <span className={getStageBadgeClass(project.stage)}>
                        {project.stage.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 style={{ marginTop: 8 }}>{project.name}</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      {project.clients?.name ?? 'No client'}
                    </p>
                  </div>
                  <Link
                    href={`/projects/${project.id}`}
                    className="portal-btn-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    Open project
                  </Link>
                </div>

                <div style={{ padding: '0 20px 20px', display: 'grid', gap: 18 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 16,
                      flexWrap: 'wrap',
                      padding: 16,
                      border: '1px solid #e8ecf3',
                      borderRadius: 10,
                      background: '#f8fafc',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: '#64748b',
                        }}
                      >
                        Lead Senior Dev / PM
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <strong style={{ color: '#14213d' }}>
                          {leadProfile?.full_name ?? 'Unassigned'}
                        </strong>
                        {leadProfile && (
                          <span
                            className={`portal-badge ${
                              leadProfile.is_active ? 'badge-green' : 'badge-amber'
                            }`}
                          >
                            {leadProfile.is_active
                              ? 'Final approval authority'
                              : 'Suspended — transfer required'}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
                        Reassigning the lead automatically transfers approval authority and revokes
                        the previous lead.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <select
                        className="form-input"
                        style={{ minWidth: 230, height: 38 }}
                        value={selectedLeadId}
                        onChange={(event) =>
                          setLeadSelection((current) => ({
                            ...current,
                            [project.id]: event.target.value,
                          }))
                        }
                        disabled={submitting}
                      >
                        <option value="">— Select Senior PM —</option>
                        {leadProfile && !leadProfile.is_active && (
                          <option value={leadProfile.id}>
                            {leadProfile.full_name} (Suspended)
                          </option>
                        )}
                        {activeSeniorOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.full_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="portal-btn-primary"
                        style={{ height: 38 }}
                        onClick={() => handleAssignLead(project.id, selectedLeadId)}
                        disabled={
                          submitting ||
                          !selectedLeadId ||
                          selectedLeadId === leadAssignment?.developer_user_id
                        }
                      >
                        {leadAssignment ? 'Transfer Lead' : 'Assign Lead'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                        marginBottom: 10,
                      }}
                    >
                      <h4 style={{ margin: 0, color: '#14213d' }}>Assigned Developers</h4>
                      <span className="portal-badge badge-gray">
                        {developerAssignments.length} assigned
                      </span>
                    </div>

                    {developerAssignments.length === 0 ? (
                      <div
                        style={{
                          padding: 16,
                          border: '1px dashed #cbd5e1',
                          borderRadius: 10,
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        No delivery developers assigned yet.
                      </div>
                    ) : (
                      <div className="portal-table-container">
                        <table className="portal-table">
                          <thead>
                            <tr>
                              <th>Team Member</th>
                              <th>Role</th>
                              <th>Approval Authority</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {developerAssignments.map((assignment) => {
                              const member = assignment.developer_user_id
                                ? profileMap.get(assignment.developer_user_id)
                                : null
                              const eligible = member?.role === 'senior_dev_pm'

                              return (
                                <tr key={assignment.id}>
                                  <td>
                                    <strong>{member?.full_name ?? 'Unknown member'}</strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`portal-badge ${
                                        member?.role === 'senior_dev_pm'
                                          ? 'badge-blue'
                                          : 'badge-gray'
                                      }`}
                                    >
                                      {formatRole(member?.role)}
                                    </span>
                                  </td>
                                  <td>
                                    {member && !member.is_active ? (
                                      <span className="portal-badge badge-amber">
                                        Suspended
                                      </span>
                                    ) : eligible ? (
                                      <button
                                        type="button"
                                        className={`portal-badge ${
                                          assignment.approval_authority
                                            ? 'badge-green'
                                            : 'badge-gray'
                                        }`}
                                        style={{ border: 0, cursor: 'pointer' }}
                                        onClick={() =>
                                          handleToggleAuthority(
                                            assignment.id,
                                            !assignment.approval_authority
                                          )
                                        }
                                        disabled={submitting}
                                      >
                                        {assignment.approval_authority
                                          ? '✓ Authority granted'
                                          : 'Grant authority'}
                                      </button>
                                    ) : (
                                      <span className="portal-badge badge-gray">
                                        Not eligible (Junior)
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      className="portal-btn-secondary"
                                      style={{ height: 28, fontSize: 11 }}
                                      onClick={() => handleRemoveAssignment(assignment.id)}
                                      disabled={submitting}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <select
                        className="form-input"
                        style={{ minWidth: 250, height: 38 }}
                        value={selectedDeveloperId}
                        onChange={(event) =>
                          setDeveloperSelection((current) => ({
                            ...current,
                            [project.id]: event.target.value,
                          }))
                        }
                        disabled={submitting || developerOptions.length === 0}
                      >
                        <option value="">
                          {developerOptions.length === 0
                            ? '— All active team members assigned —'
                            : '— Select Developer —'}
                        </option>
                        {developerOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.full_name} ({formatRole(profile.role)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="portal-btn-primary"
                        style={{ height: 38 }}
                        onClick={() => handleAssignDeveloper(project.id, selectedDeveloperId)}
                        disabled={submitting || !selectedDeveloperId}
                      >
                        Add Developer
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#eef2ff',
                      color: '#3730a3',
                      fontSize: 12,
                    }}
                  >
                    <span className="portal-badge badge-blue">Reporting line</span>
                    <span>
                      Junior developers report to{' '}
                      <strong>
                        {leadProfile?.full_name ?? 'the assigned project lead'}
                        {leadProfile?.is_active === false ? ' (suspended)' : ''}
                      </strong>
                      .
                    </span>
                    <span>
                      Approvers:{' '}
                      <strong>
                        {[
                          leadProfile?.is_active !== false ? leadProfile?.full_name : null,
                          ...developerAssignments
                            .filter((assignment) => assignment.approval_authority)
                            .map((assignment) => {
                              const member = assignment.developer_user_id
                                ? profileMap.get(assignment.developer_user_id)
                                : null
                              return member?.is_active !== false ? member?.full_name : null
                            }),
                        ]
                          .filter((name): name is string => Boolean(name))
                          .join(', ') || 'None'}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="portal-card">
          <div className="portal-card-header">
            <div>
              <h3>Workspace Team Directory</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Role assignment, user access statuses, and permission tiers.
              </p>
            </div>
            <div className="portal-search-wrap" style={{ maxWidth: 260 }}>
              <span className="portal-search-icon">🔍</span>
              <input
                className="portal-search-input"
                placeholder="Search team member..."
                value={searchUser}
                onChange={(event) => setSearchUser(event.target.value)}
              />
            </div>
          </div>

          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Current Role</th>
                  <th>Account Status</th>
                  {isAdmin && <th style={{ textAlign: 'right' }}>Role Assignment</th>}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((profile) => {
                  const initials = profile.full_name
                    ? profile.full_name
                        .split(' ')
                        .map((name) => name[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()
                    : 'U'

                  return (
                    <tr key={profile.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 8,
                              background: '#14213d',
                              color: '#fff',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <strong>{profile.full_name}</strong>
                            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>
                              ID: {profile.id.slice(0, 8)}...
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`portal-badge ${
                            profile.role === 'administrator'
                              ? 'badge-purple'
                              : profile.role === 'senior_dev_pm'
                              ? 'badge-blue'
                              : 'badge-gray'
                          }`}
                        >
                          {formatRole(profile.role)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`portal-badge ${
                            profile.is_active ? 'badge-green' : 'badge-amber'
                          }`}
                        >
                          {profile.is_active ? '● Active' : '○ Suspended'}
                        </span>
                      </td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <select
                              className="form-input"
                              style={{ width: 'auto', height: 32, fontSize: 12 }}
                              value={profile.role}
                              onChange={(event) =>
                                handleUpdateRole(
                                  profile.id,
                                  event.target.value as Profile['role'],
                                  profile.role
                                )
                              }
                              disabled={submitting}
                            >
                              <option value="junior_developer">Junior Developer</option>
                              <option value="senior_dev_pm">Senior Dev / PM</option>
                              <option value="administrator">Administrator</option>
                            </select>

                            <button
                              type="button"
                              className="portal-btn-secondary"
                              style={{ height: 32, padding: '0 8px', fontSize: 11 }}
                              onClick={() =>
                                handleToggleUserStatus(profile.id, profile.is_active)
                              }
                              disabled={submitting}
                            >
                              {profile.is_active ? 'Suspend' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="portal-card">
          <div className="portal-card-header">
            <div>
              <h3>System Event Audit Trail</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Immutable log of user operations, permissions, stage changes, and financial
                records.
              </p>
            </div>
            <select
              className="form-input"
              style={{ width: 'auto', height: 36, fontSize: 12 }}
              value={auditFilter}
              onChange={(event) => setAuditFilter(event.target.value)}
            >
              <option value="all">All Entities</option>
              <option value="client">Clients</option>
              <option value="project">Projects</option>
              <option value="quotation">Quotations</option>
              <option value="profile">Profiles / Users</option>
            </select>
          </div>

          {filteredAudits.length === 0 ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">📜</div>
              <p className="portal-empty-title">No audit records found</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {filteredAudits.map((entry) => (
                <div key={entry.id} className="audit-entry-card">
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 4,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="audit-action-tag">{entry.action}</span>
                      <span className="code-badge" style={{ fontSize: 10 }}>
                        {entry.entity_type}
                      </span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {formatDateTime(entry.created_at)}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                      {entry.after_value ? (
                        <code
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            padding: '4px 8px',
                            borderRadius: 6,
                            display: 'inline-block',
                            fontFamily: 'monospace',
                            fontSize: 11,
                          }}
                        >
                          Payload: {JSON.stringify(entry.after_value)}
                        </code>
                      ) : (
                        <span>Action performed</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Actor:{' '}
                      {entry.actor_user_id
                        ? entry.actor_user_id.slice(0, 8) + '...'
                        : 'System'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {previewDoc && (
        <div
          className="portal-drawer-overlay"
          role="presentation"
          onClick={() => setPreviewDocId(null)}
        >
          <aside
            className="portal-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-document-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="portal-drawer-header">
              <div>
                <div className="portal-drawer-eyebrow">
                  <span className="code-badge">{previewDoc.type || 'Document'}</span>
                  <span className={documentStatusBadgeClass(previewDoc.status)}>
                    {formatDocumentStatus(
                      previewDoc.status,
                      Boolean(previewRevision?.ai_generated)
                    )}
                  </span>
                </div>
                <h2 id="admin-document-preview-title">{previewDoc.title}</h2>
                <p className="portal-drawer-meta">
                  {previewDoc.projects?.project_reference ?? 'Project'} ·{' '}
                  {previewDoc.projects?.name ?? 'Unassigned project'}
                  {previewRevision ? ` · Revision #${previewRevision.revision_no}` : ''}
                  {previewDoc.sent_to_client_at
                    ? ` · Sent ${formatDateTime(previewDoc.sent_to_client_at)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="portal-drawer-close"
                aria-label="Close document preview"
                onClick={() => setPreviewDocId(null)}
              >
                ×
              </button>
            </header>

            <div className="portal-drawer-body">
              {previewRevision?.ai_generated && (
                <div className="portal-ai-origin">
                  <span className="portal-badge badge-purple">🤖 AI Origin</span>
                  <span className="portal-ai-origin-model">
                    {formatAiOrigin(
                      previewRevision.ai_model,
                      previewRevision.ai_model_version
                    )}
                  </span>
                  <span className="portal-ai-origin-time">
                    Generated{' '}
                    {formatDateTime(
                      previewRevision.ai_generated_at || previewRevision.created_at
                    )}
                  </span>
                </div>
              )}

              <section className="portal-drawer-section">
                <div className="portal-drawer-section-header">
                  <h3>Current Revision Content</h3>
                  <span className="portal-drawer-muted">
                    {previewRevision
                      ? `Revision #${previewRevision.revision_no} · ${formatDocumentStatus(
                          previewRevision.status,
                          Boolean(previewRevision.ai_generated)
                        )}`
                      : 'No revision drafted yet'}
                  </span>
                </div>
                {previewRevision?.content ? (
                  <pre className="portal-document-preview">{previewRevision.content}</pre>
                ) : (
                  <div className="portal-drawer-empty">
                    <p>No content stored for this revision.</p>
                  </div>
                )}
              </section>

              <section className="portal-drawer-section">
                <h3>Revision History</h3>
                {(previewDoc.document_revisions ?? []).length === 0 ? (
                  <p className="portal-drawer-muted">No revisions recorded.</p>
                ) : (
                  <div className="portal-table-container">
                    <table className="portal-table">
                      <thead>
                        <tr>
                          <th>Revision</th>
                          <th>Status</th>
                          <th>Origin</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(previewDoc.document_revisions ?? [])]
                          .sort((a, b) => b.revision_no - a.revision_no)
                          .map((revision) => (
                            <tr key={revision.id}>
                              <td>
                                <strong>#{revision.revision_no}</strong>
                                {revision.id === previewDoc.current_revision_id && (
                                  <span
                                    className="portal-badge badge-blue"
                                    style={{ marginLeft: 8 }}
                                  >
                                    Current
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className={documentStatusBadgeClass(revision.status)}>
                                  {formatDocumentStatus(
                                    revision.status,
                                    revision.ai_generated
                                  )}
                                </span>
                              </td>
                              <td>
                                {revision.ai_generated ? (
                                  <span className="portal-badge badge-purple">🤖 AI</span>
                                ) : (
                                  <span className="portal-badge badge-gray">Manual</span>
                                )}
                              </td>
                              <td>
                                <span style={{ fontSize: 12, color: '#64748b' }}>
                                  {formatDateTime(revision.created_at)}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <footer className="portal-drawer-footer">
              <p className="portal-drawer-muted">
                Administrators have read-only oversight of deliverable content. Approval
                remains with the project&apos;s assigned approvers.
              </p>
              <div className="portal-drawer-actions">
                <Link
                  href={`/projects/${previewDoc.project_id}`}
                  className="portal-btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  Open project
                </Link>
                <button
                  type="button"
                  className="portal-btn-primary"
                  onClick={() => setPreviewDocId(null)}
                >
                  Close
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}
    </div>
  )
}
