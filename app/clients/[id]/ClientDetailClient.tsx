'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Client = {
  id: string
  client_code: string
  name: string
  email: string | null
  phone: string | null
  primary_contact: string | null
  billing_details: string | null
}

type Contact = {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
}

export default function ClientDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const { role } = usePortal()

  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Add Contact Form State
  const [cName, setCName] = useState('')
  const [cRole, setCRole] = useState('')
  const [cEmail, setCEmail] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [savingContact, setSavingContact] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)

  const canEdit = role === 'senior_dev_pm'

  const refreshData = useCallback(async () => {
    try {
      const { data: c, error: cErr } = await supabase
        .from('clients')
        .select('id, client_code, name, email, phone, primary_contact, billing_details')
        .eq('id', id)
        .single()

      if (cErr) {
        setStatusMessage({ type: 'error', text: 'Could not load client: ' + cErr.message })
        return
      }

      setClient(c as Client)

      const { data: ct, error: ctErr } = await supabase
        .from('client_contacts')
        .select('id, name, role, email, phone')
        .eq('client_id', id)
        .order('created_at', { ascending: false })

      if (!ctErr && ct) {
        setContacts(ct as Contact[])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
  }, [id])

  useEffect(() => {
    let ignore = false

    async function init() {
      try {
        const { data: c, error: cErr } = await supabase
          .from('clients')
          .select('id, client_code, name, email, phone, primary_contact, billing_details')
          .eq('id', id)
          .single()

        if (ignore) return

        if (cErr) {
          setStatusMessage({ type: 'error', text: 'Could not load client: ' + cErr.message })
          setLoading(false)
          return
        }

        setClient(c as Client)

        const { data: ct, error: ctErr } = await supabase
          .from('client_contacts')
          .select('id, name, role, email, phone')
          .eq('client_id', id)
          .order('created_at', { ascending: false })

        if (ignore) return

        if (!ctErr && ct) {
          setContacts(ct as Contact[])
        }
        setLoading(false)
      } catch (err: unknown) {
        if (ignore) return
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setStatusMessage({ type: 'error', text: msg })
        setLoading(false)
      }
    }

    if (id) {
      init()
    }

    return () => {
      ignore = true
    }
  }, [id])

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault()
    if (!cName.trim()) {
      setStatusMessage({ type: 'error', text: 'Contact name is required.' })
      return
    }

    setSavingContact(true)
    setStatusMessage(null)

    const { error } = await supabase.from('client_contacts').insert({
      client_id: id,
      name: cName.trim(),
      role: cRole.trim() || null,
      email: cEmail.trim() || null,
      phone: cPhone.trim() || null,
    })

    if (error) {
      setSavingContact(false)
      setStatusMessage({ type: 'error', text: 'Could not save contact: ' + error.message })
      return
    }

    setCName('')
    setCRole('')
    setCEmail('')
    setCPhone('')
    setSavingContact(false)
    setShowAddContact(false)
    setStatusMessage({ type: 'success', text: 'Contact saved successfully.' })
    await refreshData()
  }

  async function handleDeleteContact(contactId: string, contactName: string) {
    if (!window.confirm(`Are you sure you want to remove contact "${contactName}"?`)) return

    const { error } = await supabase.from('client_contacts').delete().eq('id', contactId)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not delete contact: ' + error.message })
      return
    }

    setStatusMessage({ type: 'success', text: `Contact "${contactName}" removed.` })
    await refreshData()
  }

  return (
    <PortalShell
      title={client ? `${client.client_code} — ${client.name}` : 'Client Details'}
      breadcrumb="WORKSPACE / CLIENTS / DETAILS"
    >
      <div style={{ maxWidth: 1000 }}>
        {/* Back Link */}
        <button
          type="button"
          className="portal-back-btn"
          onClick={() => router.push('/clients')}
        >
          <span>←</span> Back to all clients
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
              <p className="portal-empty-title">Loading client profile...</p>
            </div>
          </div>
        ) : !client ? (
          <div className="portal-card">
            <div className="portal-empty-state">
              <div className="portal-empty-icon">⚠️</div>
              <p className="portal-empty-title">Client not found</p>
              <p className="portal-empty-desc">This client record may have been deleted or moved.</p>
              <Link href="/clients" className="portal-btn-primary">
                Return to Clients
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Client Profile Header Card */}
            <div className="portal-detail-header">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <span className="code-badge" style={{ marginBottom: 8 }}>
                    {client.client_code}
                  </span>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: '#14213d', margin: '4px 0 0' }}>
                    {client.name}
                  </h2>
                </div>
                <span className="portal-badge badge-blue">Active Client</span>
              </div>

              {/* Meta Grid */}
              <div className="portal-detail-meta-grid">
                <div className="portal-meta-item">
                  <label>Primary Contact</label>
                  <span>{client.primary_contact || '—'}</span>
                </div>
                <div className="portal-meta-item">
                  <label>Email Address</label>
                  <span>
                    {client.email ? (
                      <a href={`mailto:${client.email}`} className="portal-table-link">
                        {client.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                <div className="portal-meta-item">
                  <label>Phone Number</label>
                  <span>{client.phone || '—'}</span>
                </div>
                <div className="portal-meta-item">
                  <label>Billing Details</label>
                  <span>{client.billing_details || '—'}</span>
                </div>
              </div>
            </div>

            {/* Contacts Section Card */}
            <div className="portal-card">
              <div className="portal-card-header">
                <div>
                  <h3>Client Contacts ({contacts.length})</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                    Key stakeholders and points of contact for this client.
                  </p>
                </div>
                {canEdit && !showAddContact && (
                  <button
                    type="button"
                    className="portal-btn-primary"
                    style={{ height: 34, fontSize: 12 }}
                    onClick={() => setShowAddContact(true)}
                  >
                    <span>+</span> Add Contact
                  </button>
                )}
              </div>

              {/* Add Contact Collapsible Form */}
              {showAddContact && canEdit && (
                <form
                  onSubmit={handleAddContact}
                  style={{
                    background: '#f8fafc',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 20,
                  }}
                >
                  <h4 style={{ margin: '0 0 14px', fontSize: 14, color: '#1e293b' }}>
                    New Contact Information
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <div className="form-group">
                      <label className="form-label">Full Name *</label>
                      <input
                        className="form-input"
                        placeholder="e.g. Sarah Jenkins"
                        value={cName}
                        onChange={(e) => setCName(e.target.value)}
                        disabled={savingContact}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Role / Job Title</label>
                      <input
                        className="form-input"
                        placeholder="e.g. Project Lead, CTO"
                        value={cRole}
                        onChange={(e) => setCRole(e.target.value)}
                        disabled={savingContact}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input
                        type="email"
                        className="form-input"
                        placeholder="sarah@client.com"
                        value={cEmail}
                        onChange={(e) => setCEmail(e.target.value)}
                        disabled={savingContact}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Phone</label>
                      <input
                        type="tel"
                        className="form-input"
                        placeholder="+1 (555) 000-0000"
                        value={cPhone}
                        onChange={(e) => setCPhone(e.target.value)}
                        disabled={savingContact}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <button
                      type="button"
                      className="portal-btn-secondary"
                      onClick={() => setShowAddContact(false)}
                      disabled={savingContact}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="portal-btn-primary"
                      disabled={savingContact}
                    >
                      {savingContact ? 'Saving...' : 'Save Contact'}
                    </button>
                  </div>
                </form>
              )}

              {/* Contacts Table / List */}
              {contacts.length === 0 ? (
                <div className="portal-empty-state" style={{ padding: '32px 16px' }}>
                  <div className="portal-empty-icon">👥</div>
                  <p className="portal-empty-title">No contacts added yet</p>
                  <p className="portal-empty-desc">
                    Add primary contacts and stakeholders for easy collaboration.
                  </p>
                  {canEdit && !showAddContact && (
                    <button
                      type="button"
                      className="portal-btn-primary"
                      onClick={() => setShowAddContact(true)}
                    >
                      + Add First Contact
                    </button>
                  )}
                </div>
              ) : (
                <div className="portal-table-container">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Contact Name</th>
                        <th>Position / Role</th>
                        <th>Email</th>
                        <th>Phone</th>
                        {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact) => (
                        <tr key={contact.id}>
                          <td>
                            <strong>{contact.name}</strong>
                          </td>
                          <td>
                            {contact.role ? (
                              <span className="portal-badge badge-gray">{contact.role}</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                          <td>
                            {contact.email ? (
                              <a href={`mailto:${contact.email}`} className="portal-table-link">
                                {contact.email}
                              </a>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span style={{ color: '#475569' }}>{contact.phone || '—'}</span>
                          </td>
                          {canEdit && (
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="portal-danger-btn"
                                onClick={() => handleDeleteContact(contact.id, contact.name)}
                                title="Remove contact"
                              >
                                🗑 Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!canEdit && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 16 }}>
                  ℹ️ Only Senior Developers and Project Managers can manage client contacts. You have view-only access.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </PortalShell>
  )
}
