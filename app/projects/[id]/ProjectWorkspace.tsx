'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePortal } from '@/components/PortalShell'

import ClientsTab from './tabs/ClientsTab'
import DocumentsTab from './tabs/DocumentsTab'
import UrlLinksTab from './tabs/UrlLinksTab'
import FinancialsTab from './tabs/FinancialsTab'

type ProjectRecord = {
  id: string
  project_reference: string
  name: string
  description: string | null
  stage: string
  status: string
  client_id: string | null
  created_at?: string | null
  clients: {
    id: string
    name: string
    primary_contact: string | null
    email: string | null
    phone: string | null
  } | null
}

type TabId = 'clients' | 'documents' | 'links' | 'financials'

const TABS: { id: TabId; label: string }[] = [
  { id: 'clients', label: 'Clients' },
  { id: 'documents', label: 'Documents' },
  { id: 'links', label: 'URL Links' },
  { id: 'financials', label: 'Financials' },
]

function isTabId(value: string | undefined): value is TabId {
  return TABS.some((tab) => tab.id === value)
}

export default function ProjectWorkspace({
  id,
  initialTab,
}: {
  id: string
  initialTab?: string
}) {
  const router = useRouter()
  const { isAdministrator, isSuspended } = usePortal()
  const readOnly = isAdministrator || isSuspended
  const [project, setProject] = useState<ProjectRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>(() => (
    isTabId(initialTab) ? initialTab : 'clients'
  ))
  const [developers, setDevelopers] = useState<{ id: string; full_name: string; email: string | null; role: string }[]>([])
  const [currentDeveloperId, setCurrentDeveloperId] = useState('')
  const [selectedDeveloperId, setSelectedDeveloperId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignMessage, setAssignMessage] = useState('')

  const loadProject = useCallback(async () => {
    setLoading(true)
    try {
      // RLS returns zero rows for an unassigned project. maybeSingle() keeps
      // that a normal empty result instead of surfacing a browser 406.
      const { data, error } = await supabase
        .from('projects')
        .select('id, project_reference, name, description, stage, status, client_id, created_at, clients(id, name, primary_contact, email, phone)')
        .eq('id', id)
        .maybeSingle()

      if (error) {
        setErrorMessage('Could not load project: ' + error.message)
        setLoading(false)
        return
      }
      if (!data) {
        setErrorMessage('Project not found.')
        setLoading(false)
        return
      }

      setProject(data as unknown as ProjectRecord)

      if (isAdministrator) {
        const [{ data: staff }, { data: assignment }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .in('role', ['senior_dev_pm', 'junior_developer'])
            .eq('is_active', true)
            .order('full_name'),
          supabase
            .from('assignments')
            .select('developer_user_id')
            .eq('project_id', id)
            .eq('is_active', true)
            .maybeSingle(),
        ])
        setDevelopers((staff || []) as typeof developers)
        setCurrentDeveloperId(assignment?.developer_user_id || '')
        setSelectedDeveloperId(assignment?.developer_user_id || '')
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load project.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // Defer the initial read to a task so the effect body itself performs no
    // synchronous state update; StrictMode's first cleanup cancels the extra read.
    const timeout = window.setTimeout(() => {
      void loadProject()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadProject])

  const handleAssignDeveloper = async () => {
    if (!selectedDeveloperId || assigning) return
    setAssigning(true)
    setAssignMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setAssignMessage('Not authenticated.')
        return
      }
      const res = await fetch(`/api/projects/${id}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ developer_user_id: selectedDeveloperId }),
      })
      const result = await res.json()
      if (!res.ok) {
        setAssignMessage(result.error || 'Could not reassign developer.')
        return
      }
      setAssignMessage(result.message || 'Developer reassigned.')
      setCurrentDeveloperId(selectedDeveloperId)
      await loadProject()
    } catch (err: unknown) {
      setAssignMessage(err instanceof Error ? err.message : 'Could not reassign developer.')
    } finally {
      setAssigning(false)
    }
  }

  const client = project?.clients || null
  const clientName = client?.name || 'Unassigned'
  const currentDeveloper = developers.find((developer) => developer.id === currentDeveloperId)

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading project workspace...</div>
    )
  }

  if (!project) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--error-text)' }}>
        <p>Project not found.</p>
        <button onClick={() => router.push('/projects')} style={{ marginTop: '12px' }}>
          Back to Projects
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: '10px' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', display: 'inline-block' }}>
            {project.project_reference}
          </span>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--heading)', margin: '4px 0 0' }}>{project.name}</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '4px 0 0' }}>
            Client: <strong>{clientName}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => router.push('/projects')} className="portal-btn-secondary" style={{ height: '34px', fontSize: '12px' }}>
            Back to Projects
          </button>
        </div>
      </div>

      {errorMessage && (
        <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', fontSize: '13px', marginBottom: '16px' }}>
          {errorMessage}
        </div>
      )}

      {readOnly && (
        <div className="readonly-banner" data-testid="project-readonly" style={{ marginBottom: 18 }}>
          <span aria-hidden="true">👁</span>
          <span>
            Read-only access. You can view client details, documents and links, but cannot
            edit records, generate documents or add/remove links. You may reassign the developer.
          </span>
        </div>
      )}

      {isAdministrator && (
        <div
          data-testid="admin-developer-assignment"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', marginBottom: 18, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
            Current developer: <strong style={{ color: 'var(--text)' }}>{currentDeveloper?.full_name || currentDeveloper?.email || 'Unassigned'}</strong>
          </span>
          <select
            aria-label="Change developer"
            data-testid="developer-select"
            value={selectedDeveloperId}
            onChange={(event) => setSelectedDeveloperId(event.target.value)}
            style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
          >
            <option value="">Select a developer…</option>
            {developers.map((developer) => (
              <option key={developer.id} value={developer.id}>
                {developer.full_name || developer.email} · {developer.role === 'senior_dev_pm' ? 'Senior Dev / PM' : 'Junior Developer'}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="change-developer"
            onClick={handleAssignDeveloper}
            disabled={assigning || !selectedDeveloperId || selectedDeveloperId === currentDeveloperId}
            className="portal-btn-secondary"
            style={{ height: 34, fontSize: 12 }}
          >
            {assigning ? 'Assigning…' : 'Change Developer'}
          </button>
          {assignMessage && (
            <span data-testid="assignment-message" style={{ fontSize: 12, color: assignMessage.includes('assigned to') ? 'var(--success-text)' : 'var(--error-text)' }}>
              {assignMessage}
            </span>
          )}
        </div>
      )}

      <div className="project-workspace-tabs" style={{ borderBottom: '1.5px solid var(--border-strong)', marginBottom: '24px', display: 'flex', gap: '0' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`portal-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            style={{ padding: '12px 18px', fontSize: '13px', fontWeight: 600 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'clients' && <ClientsTab client={client} readOnly={readOnly} />}
      {activeTab === 'documents' && <DocumentsTab projectId={id} readOnly={readOnly} />}
      {activeTab === 'links' && <UrlLinksTab projectId={id} readOnly={readOnly} />}
      {activeTab === 'financials' && <FinancialsTab projectId={id} />}
    </div>
  )
}
