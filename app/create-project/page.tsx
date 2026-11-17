'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Client = {
  id: string
  client_code: string
  name: string
  email: string | null
}

export default function CreateProjectPage() {
  const router = useRouter()
  return (
    <PortalShell title="Create Project" breadcrumb="WORKSPACE / PROJECTS / CREATE">
      <CreateProjectContent router={router} />
    </PortalShell>
  )
}

function CreateProjectContent({ router }: { router: ReturnType<typeof useRouter> }) {
  const { profile } = usePortal()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const canCreate =
    profile?.role === 'senior_dev_pm' || profile?.role === 'administrator'

  const loadClients = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, client_code, name, email')
        .order('name')

      if (error) {
        setErrorMessage('Could not load clients: ' + error.message)
      } else {
        setClients(data ?? [])
      }
    } catch {
      setErrorMessage('Could not load clients.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function init() {
      if (ignore) return
      await loadClients()
    }

    init()

    return () => {
      ignore = true
    }
  }, [loadClients])

  const handleCreateExistingClient = async (clientId: string) => {
    setErrorMessage('')
    setSuccessMessage('')
    setLoading(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          name: '', // Will be named by user on next step or default
          description: '',
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setErrorMessage(result.error || 'Failed to create project.')
        setLoading(false)
        return
      }

      setSuccessMessage('Project created. Redirecting...')
      setLoading(false)
      router.push(`/projects/${result.data.id}`)
    } catch (err: unknown) {
      setErrorMessage('Failed to create project.')
      setLoading(false)
    }
  }

  const handleCreateNewClient = async () => {
    // Redirect to Discovery Meeting, passing a flag to create provisional project
    router.push('/discovery-meetings/new?provisional_project=true')
  }

  if (!canCreate) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">🔒</div>
          <p className="portal-empty-title">Access Restricted</p>
          <p className="portal-empty-desc">
            Only Senior Developers / PMs and Administrators can create projects.
          </p>
          <Link href="/dashboard" className="portal-btn-primary">
            Return to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⏳</div>
          <p className="portal-empty-title">Loading clients...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="portal-card-header">
        <div>
          <h3>Create Project</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Start a new project. Choose whether the client already exists or needs onboarding.
          </p>
        </div>
        <Link href="/projects" className="portal-btn-secondary">
          ← Back to Projects
        </Link>
      </div>

      {errorMessage && (
        <div className="auth-alert-error" style={{ marginBottom: 20 }} role="alert">
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="connection-status" style={{ marginBottom: 20 }} role="alert">
          <span>✓</span>
          <span>{successMessage}</span>
        </div>
      )}

      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Select Client Option</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Choose how you want to start this project.
            </p>
          </div>
        </div>

        {/* Option A: Existing Client */}
        <div style={{ border: '1px solid #e8ecf3', borderRadius: 12, padding: 24, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 24 }}>🏢</span>
            <div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#14213d' }}>Option A: Existing Client</h4>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Select a registered client and create a project for them.
              </p>
            </div>
          </div>

          {clients.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>
              No existing clients found. Use Option B to onboard a new client through Discovery Meeting.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {clients.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#ffffff',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleCreateExistingClient(c.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong>{c.name}</strong>
                      <span className="code-badge" style={{ fontSize: 11 }}>{c.client_code}</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                      {c.email ? c.email : 'No email on file'}
                    </div>
                  </div>
                  <span style={{ color: '#4361ee', fontSize: 13 }}>Select →</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Option B: New Client */}
        <div style={{ border: '1px solid #e8ecf3', borderRadius: 12, padding: 24, background: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 24 }}>🔍</span>
            <div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#14213d' }}>Option B: New Client (Discovery Meeting)</h4>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Onboard a new client through Discovery Meeting. The client and project will be created automatically after approval.
              </p>
            </div>
          </div>

          <div style={{ background: '#f0fbf5', border: '1px solid #cdeedd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#267a52' }}>
              <strong>Preferred method:</strong> Discovery Meeting captures all client information,
              generates a discovery document, and upon approval automatically creates the client record
              and associates the project — no manual data entry required.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreateNewClient}
            className="portal-btn-primary"
            style={{ height: 44, padding: '0 24px', fontSize: 14 }}
          >
            <span>🔍</span> Start Discovery Meeting for New Client
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Link href="/projects" className="portal-btn-secondary">
          Cancel
        </Link>
      </div>
    </div>
  )
}
