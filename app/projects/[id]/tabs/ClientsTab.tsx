'use client'

import React, { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

type ClientRecord = {
  id: string
  name: string
  email: string | null
  phone: string | null
  primary_contact: string | null
}

type ClientsTabProps = {
  client: ClientRecord | null
}

export default function ClientsTab({ client }: ClientsTabProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [name, setName] = useState(client?.name || '')
  const [primaryContact, setPrimaryContact] = useState(client?.primary_contact || '')
  const [email, setEmail] = useState(client?.email || '')
  const [phone, setPhone] = useState(client?.phone || '')

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client) return
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Company name is required.' })
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
      return
    }

    setMessage({ type: 'success', text: 'Client updated!' })
    setEditing(false)
  }, [client, name, primaryContact, email, phone])

  if (!client) {
    return (
      <div style={{ padding: 24, color: '#64748b', textAlign: 'center' }}>
        No client information available for this project.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: '#14213d' }}>Company Name:</span>
        <span style={{ color: '#1e293b' }}>{client.name}</span>
        <span style={{ fontWeight: 700, color: '#14213d' }}>Contact Name:</span>
        <span style={{ color: '#1e293b' }}>{client.primary_contact || '—'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: '#14213d' }}>Email:</span>
        <span style={{ color: '#1e293b' }}>{client.email || '—'}</span>
        <span style={{ fontWeight: 700, color: '#14213d' }}>Phone:</span>
        <span style={{ color: '#1e293b' }}>{client.phone || '—'}</span>
      </div>

      {editing ? (
        <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
          <div className="form-group">
            <label className="form-label">Company Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} required />
          </div>
          <div className="form-group">
            <label className="form-label">Contact Name</label>
            <input className="form-input" value={primaryContact} onChange={(e) => setPrimaryContact(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '8px' }}>
            <button type="button" onClick={() => setEditing(false)} className="portal-btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="portal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Client'}
            </button>
          </div>
        </form>
      ) : null}

      <div style={{ marginTop: '8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={saving}
          className="portal-btn-primary"
          style={{ height: '34px', fontSize: '12px', padding: '0 14px' }}
        >
          {editing ? 'Editing…' : 'Edit Client'}
        </button>
      </div>

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${message.type === 'success' ? '#a7f3d0' : '#fee2e2'}`, color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: '13px', marginTop: '8px' }}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}
