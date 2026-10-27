'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Client = {
  id: string
  client_code: string
  name: string
  email: string | null
  created_at?: string
}

export default function ClientsPage() {
  return (
    <PortalShell title="Clients" breadcrumb="WORKSPACE / CLIENTS">
      <ClientsContent />
    </PortalShell>
  )
}

function ClientsContent() {
  const { role, user } = usePortal()
  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  // Form state
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const canCreateClient = role === 'senior_dev_pm'

  const loadClients = useCallback(async () => {
    setLoadingClients(true)
    const { data, error } = await supabase
      .from('clients')
      .select('id, client_code, name, email, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not load clients: ' + error.message })
    } else {
      setClients(data ?? [])
    }
    setLoadingClients(false)
  }, [])

  useEffect(() => {
    let ignore = false

    async function fetchClients() {
      const { data, error } = await supabase
        .from('clients')
        .select('id, client_code, name, email, created_at')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (error) {
        setStatusMessage({ type: 'error', text: 'Could not load clients: ' + error.message })
      } else {
        setClients(data ?? [])
      }
      setLoadingClients(false)
    }

    fetchClients()

    return () => {
      ignore = true
    }
  }, [])

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || !name.trim()) {
      setStatusMessage({ type: 'error', text: 'Client code and client name are required.' })
      return
    }

    setSaving(true)
    setStatusMessage(null)

    const clientCodeClean = code.trim().toUpperCase()
    const clientNameClean = name.trim()
    const clientEmailClean = email.trim() || null

    const { error } = await supabase.from('clients').insert({
      client_code: clientCodeClean,
      name: clientNameClean,
      email: clientEmailClean,
      created_by: user?.id,
    })

    if (error) {
      setSaving(false)
      setStatusMessage({
        type: 'error',
        text:
          error.code === '23505'
            ? `Client code "${clientCodeClean}" already exists. Please choose a unique code.`
            : 'Could not save client: ' + error.message,
      })
      return
    }

    // Insert audit log
    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'client.created',
      entity_type: 'client',
      after_value: {
        client_code: clientCodeClean,
        name: clientNameClean,
        email: clientEmailClean,
      },
    })

    setCode('')
    setName('')
    setEmail('')
    setSaving(false)
    setShowAddForm(false)
    setStatusMessage({ type: 'success', text: `Client "${clientNameClean}" created successfully.` })
    await loadClients()
  }

  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter(
      (c) =>
        c.client_code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q))
    )
  }, [clients, search])

  return (
    <div>
      {/* Quick Stats Row */}
      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon clients-tone">♙</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Total Clients</span>
            <span className="portal-stat-value">{clients.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon home-tone">🏢</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Access Level</span>
            <span className="portal-stat-value" style={{ fontSize: 16 }}>
              {canCreateClient ? 'Senior Manager (Read/Write)' : 'Standard (Read-only)'}
            </span>
          </div>
        </div>
      </div>

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

      {/* Collapsible Add Client Form */}
      {showAddForm && canCreateClient && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <h3>Add New Client</h3>
            <button
              type="button"
              className="portal-back-btn"
              onClick={() => setShowAddForm(false)}
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleAddClient} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="code-input">
                  Client Code <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="code-input"
                  className="form-input"
                  placeholder="e.g. ACME, GOOG"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={saving}
                  required
                />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Unique company abbreviation</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="name-input">
                  Client Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="name-input"
                  className="form-input"
                  placeholder="e.g. Acme Corporation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="email-input">
                  Contact Email (Optional)
                </label>
                <input
                  id="email-input"
                  type="email"
                  className="form-input"
                  placeholder="client@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setShowAddForm(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Client'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toolbar / Search & Actions */}
      <div className="portal-toolbar">
        <div className="portal-search-wrap">
          <span className="portal-search-icon">🔍</span>
          <input
            type="text"
            className="portal-search-input"
            placeholder="Search by code, name, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {canCreateClient && !showAddForm && (
          <button
            type="button"
            className="portal-btn-primary"
            onClick={() => setShowAddForm(true)}
          >
            <span>+</span> Add Client
          </button>
        )}
      </div>

      {/* Clients Data Table */}
      <div className="portal-table-container">
        {loadingClients ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">⏳</div>
            <p className="portal-empty-title">Loading clients...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">📂</div>
            <p className="portal-empty-title">
              {search ? 'No matching clients found' : 'No clients registered yet'}
            </p>
            <p className="portal-empty-desc">
              {search
                ? `No clients matched "${search}". Try clearing your search.`
                : canCreateClient
                ? 'Get started by creating your first client record.'
                : 'Clients created by senior managers will appear here.'}
            </p>
            {canCreateClient && !search && (
              <button
                type="button"
                className="portal-btn-primary"
                onClick={() => setShowAddForm(true)}
              >
                + Add First Client
              </button>
            )}
          </div>
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Client Name</th>
                <th>Email</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <span className="code-badge">{client.client_code}</span>
                  </td>
                  <td>
                    <Link
                      href={`/clients/${client.id}`}
                      className="portal-table-link"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td>
                    {client.email ? (
                      <span style={{ color: '#475569' }}>{client.email}</span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>None</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      href={`/clients/${client.id}`}
                      className="portal-btn-secondary"
                      style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    >
                      View Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
