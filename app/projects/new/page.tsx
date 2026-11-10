'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type ActiveClient = {
  id: string
  client_code: string
  name: string
}

export default function NewProjectPage() {
  return (
    <PortalShell title="Create Project" breadcrumb="WORKSPACE / PROJECTS / NEW">
      <NewProjectContent />
    </PortalShell>
  )
}

function NewProjectContent() {
  const router = useRouter()
  const { user } = usePortal()

  const [mode, setMode] = useState<'choose' | 'new_client' | 'existing_client'>('choose')
  const [clients, setClients] = useState<ActiveClient[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // New Client Discovery Form
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().split('T')[0])

  // Existing Client Form
  const [selectedClientId, setSelectedClientId] = useState('')
  const [projectRef, setProjectRef] = useState('')
  const [projectName, setProjectName] = useState('')

  useEffect(() => {
    async function loadActiveClients() {
      setLoadingClients(true)
      const { data, error } = await supabase
        .from('clients')
        .select('id, client_code, name')
        .eq('status', 'active')
        .order('name', { ascending: true })

      if (!error && data) {
        setClients(data)
      }
      setLoadingClients(false)
    }

    if (mode === 'existing_client' && clients.length === 0) {
      loadActiveClients()
    }
  }, [mode, clients.length])

  // Handle New Client -> Discovery-First Start
  async function handleStartDiscovery(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setStatusMessage(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      const res = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          meetingTitle: meetingTitle.trim() || undefined,
          meetingDate: meetingDate || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize discovery session')
      }

      router.push(`/discovery/${data.sessionId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSubmitting(false)
    }
  }

  // Handle Existing Client -> Project Creation
  async function handleCreateExisting(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClientId) {
      setStatusMessage({ type: 'error', text: 'Please select an existing client.' })
      return
    }
    if (!projectRef.trim() || !projectName.trim()) {
      setStatusMessage({ type: 'error', text: 'Project reference and name are required.' })
      return
    }

    setSubmitting(true)
    setStatusMessage(null)

    const cleanRef = projectRef.trim().toUpperCase()
    const cleanName = projectName.trim()

    const { data: newProj, error } = await supabase
      .from('projects')
      .insert({
        project_reference: cleanRef,
        client_id: selectedClientId,
        name: cleanName,
        stage: 'discovery',
        status: 'active',
        created_by: user?.id,
      })
      .select('id')
      .single()

    if (error || !newProj) {
      setSubmitting(false)
      setStatusMessage({
        type: 'error',
        text: error?.code === '23505'
          ? `Project reference "${cleanRef}" already exists.`
          : 'Could not create project: ' + (error?.message || 'unknown error'),
      })
      return
    }

    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'project.created',
      entity_type: 'project',
      entity_id: newProj.id,
      after_value: { project_reference: cleanRef, name: cleanName, client_id: selectedClientId },
    })

    router.push(`/projects/${newProj.id}`)
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/projects" className="portal-back-btn">
          <span>←</span> Back to Projects
        </Link>
      </div>

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

      {/* Top Level Fork Options */}
      <div className="portal-card" style={{ marginBottom: 24, padding: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          Start a New Project
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
          Choose how you would like to initiate this project:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Option A: New Client (Discovery-First) */}
          <div
            onClick={() => setMode('new_client')}
            style={{
              border: mode === 'new_client' ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
              background: mode === 'new_client' ? '#eff6ff' : '#ffffff',
              borderRadius: 14,
              padding: 20,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>⚡</span>
              <div>
                <strong style={{ fontSize: 16, color: '#1e293b', display: 'block' }}>
                  New Client (Discovery-First)
                </strong>
                <span style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>Recommended</span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              Skip manual client registration. Jump straight into the discovery meeting. Company details, contacts, and requirements will be extracted automatically from the transcript upon approval.
            </p>
          </div>

          {/* Option B: Existing Client */}
          <div
            onClick={() => setMode('existing_client')}
            style={{
              border: mode === 'existing_client' ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
              background: mode === 'existing_client' ? '#eff6ff' : '#ffffff',
              borderRadius: 14,
              padding: 20,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>🏢</span>
              <div>
                <strong style={{ fontSize: 16, color: '#1e293b', display: 'block' }}>
                  Existing Client
                </strong>
                <span style={{ fontSize: 12, color: '#64748b' }}>Standard Project Setup</span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              Select an active client from your company directory and attach a new project reference directly.
            </p>
          </div>
        </div>
      </div>

      {/* Form Branch 1: New Client Discovery-First Form */}
      {mode === 'new_client' && (
        <div className="portal-card" style={{ padding: 28 }}>
          <div className="portal-card-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Discovery Session Details</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Enter initial meeting context. The client record is provisional until approved.
              </p>
            </div>
          </div>

          <form onSubmit={handleStartDiscovery} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="meeting-title">
                  Meeting / Client Working Title
                </label>
                <input
                  id="meeting-title"
                  className="form-input"
                  placeholder="e.g. Acme Corp Mobile App Discovery"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  disabled={submitting}
                />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Optional: used as temporary working name</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="meeting-date">
                  Meeting Date
                </label>
                <input
                  id="meeting-date"
                  type="date"
                  className="form-input"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setMode('choose')}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Creating Discovery Session...' : 'Start Discovery Session →'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Form Branch 2: Existing Client Form */}
      {mode === 'existing_client' && (
        <div className="portal-card" style={{ padding: 28 }}>
          <div className="portal-card-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Attach Project to Existing Client</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Select an active client and assign a unique project code.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateExisting} style={{ display: 'grid', gap: 16 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="client-select">
                Select Active Client <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                id="client-select"
                className="form-input"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                disabled={submitting || loadingClients}
                required
              >
                <option value="">— Choose a Client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="project-ref">
                  Project Reference <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="project-ref"
                  className="form-input"
                  placeholder="e.g. PRJ-ACME-02"
                  value={projectRef}
                  onChange={(e) => setProjectRef(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="project-name">
                  Project Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="project-name"
                  className="form-input"
                  placeholder="e.g. Operations Portal"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setMode('choose')}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Creating Project...' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
