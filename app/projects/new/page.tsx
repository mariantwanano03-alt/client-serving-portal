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

  const [clients, setClients] = useState<ActiveClient[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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
        .order('name', { ascending: true })

      if (!error && data) {
        setClients(data)
      }
      setLoadingClients(false)
    }

    loadActiveClients()
  }, [])

  // Handle Existing Client -> Project Creation
  async function handleCreateExisting(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClientId) {
      setStatusMessage({ type: 'error', text: 'Please select an existing client.' })
      return
    }
    if (!projectRef.trim() || !projectName.trim()) {
      setStatusMessage({ type: 'error', text: 'Project reference and project name are required.' })
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

      <div className="portal-card" style={{ padding: 28 }}>
        <div className="portal-card-header">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
              Create Project
            </h2>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 0 }}>
              Attach a new project to an existing client. For new clients, start a Discovery Meeting first.
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
              onClick={() => router.push('/projects')}
              disabled={submitting}
            >
              Cancel
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
    </div>
  )
}
