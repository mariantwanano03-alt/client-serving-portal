'use client'

import React, { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useDebugEvents } from '@/components/useDebugEvents'

type ClientRecord = {
  id: string
  name: string
  email: string | null
  phone: string | null
  primary_contact: string | null
}

type ClientsTabProps = {
  client: ClientRecord | null
  readOnly?: boolean
}

export default function ClientsTab({ client: initialClient, readOnly = false }: ClientsTabProps) {
  const [client, setClient] = useState<ClientRecord | null>(initialClient ?? null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { logInputChange, logButtonClick, logFormSubmit, logApiError } = useDebugEvents()
  const userName = client?.name || 'User'

  const [name, setName] = useState(client?.name || '')
  const [primaryContact, setPrimaryContact] = useState(client?.primary_contact || '')
  const [email, setEmail] = useState(client?.email || '')
  const [phone, setPhone] = useState(client?.phone || '')

  // The parent already loads and passes the client for this project, so there
  // is deliberately no mount-time fetch here. An async load that landed after
  // the user started typing could overwrite the field mid-edit. This helper is
  // only used after a successful save to refresh from the database.
  const clientId = initialClient?.id || null

  const loadClient = useCallback(async () => {
    if (!clientId) return
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, email, phone, primary_contact')
      .eq('id', clientId)
      .single()
    if (!error && data) {
      setClient(data as ClientRecord)
      setName(data.name)
      setPrimaryContact(data.primary_contact || '')
      setEmail(data.email || '')
      setPhone(data.phone || '')
    }
  }, [clientId])

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly || !client) return
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Company name is required.' })
      logApiError('projects', 'clients-tab', 'client_save')
      return
    }

    setSaving(true)
    setMessage(null)

    const { error } = await supabase
      .from('clients')
      .update({
        name: name.trim(),
        primary_contact: primaryContact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      })
      .eq('id', client.id)

    setSaving(false)
    if (error) {
      setMessage({ type: 'error', text: 'Could not update client: ' + error.message })
      logApiError('projects', 'clients-tab', 'client_save')
      return
    }

    // Refresh displayed data instantly from the database
    await loadClient()
    setMessage({ type: 'success', text: 'Client updated!' })
    setEditing(false)
    logFormSubmit('projects', 'clients-tab', 'client_update')
  }, [client, name, primaryContact, email, phone, loadClient, logApiError, logFormSubmit, readOnly])

  if (!client) {
    return (
      <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center' }}>
        No client information available for this project.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--heading)' }}>Company Name:</span>
        <span style={{ color: 'var(--text)' }}>{client.name}</span>
        <span style={{ fontWeight: 700, color: 'var(--heading)' }}>Contact Name:</span>
        <span style={{ color: 'var(--text)' }}>{client.primary_contact || '—'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--heading)' }}>Email:</span>
        <span style={{ color: 'var(--text)' }}>{client.email || '—'}</span>
        <span style={{ fontWeight: 700, color: 'var(--heading)' }}>Phone:</span>
        <span style={{ color: 'var(--text)' }}>{client.phone || '—'}</span>
      </div>

      {editing && !readOnly ? (
        <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, background: 'var(--surface-alt)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="client-company-name">Company Name <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input id="client-company-name" className="form-input" value={name} onChange={(e) => { setName(e.target.value); logInputChange('projects', 'clients-tab', 'company_name')(e) }} disabled={saving} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="client-contact-name">Contact Name</label>
            <input id="client-contact-name" className="form-input" value={primaryContact} onChange={(e) => { setPrimaryContact(e.target.value); logInputChange('projects', 'clients-tab', 'contact_name')(e) }} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="client-email">Email</label>
            <input id="client-email" type="email" className="form-input" value={email} onChange={(e) => { setEmail(e.target.value); logInputChange('projects', 'clients-tab', 'email')(e) }} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="client-phone">Phone</label>
            <input id="client-phone" type="tel" className="form-input" value={phone} onChange={(e) => { setPhone(e.target.value); logInputChange('projects', 'clients-tab', 'phone')(e) }} disabled={saving} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '8px' }}>
            <button
              type="button"
              onClick={() => {
                setName(client?.name || '')
                setPrimaryContact(client?.primary_contact || '')
                setEmail(client?.email || '')
                setPhone(client?.phone || '')
                setEditing(false)
                logButtonClick('projects', 'clients-tab', 'cancel_button')
              }}
              className="portal-btn-secondary"
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="portal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Client'}
            </button>
          </div>
        </form>
      ) : null}

      {!readOnly && (
        <div style={{ marginTop: '8px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => { setEditing(true); logButtonClick('projects', 'clients-tab', 'edit_button') }}
            disabled={saving}
            className="portal-btn-primary"
            style={{ height: '34px', fontSize: '12px', padding: '0 14px' }}
          >
            {editing ? 'Editing…' : 'Edit Client'}
          </button>
        </div>
      )}

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)', border: `1px solid ${message.type === 'success' ? 'var(--success-border)' : 'var(--error-border)'}`, color: message.type === 'success' ? 'var(--success-text)' : 'var(--error-text)', fontSize: '13px', marginTop: '8px' }}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}
