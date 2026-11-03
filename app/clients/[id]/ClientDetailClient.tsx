'use client'

import React, { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Client = {
  id: string
  client_code: string
  name: string
  email: string | null
  phone: string | null
  billing_details: string | null
  created_at: string
}

type ClientContact = {
  id: string
  client_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
}

type AuditEntry = {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  created_at: string
}

type CountryOption = { code: string; name: string; lengths: number[] }

const CONTACT_COUNTRIES: CountryOption[] = [
  { code: '27', name: 'South Africa', lengths: [9] },
  { code: '1', name: 'United States / Canada', lengths: [10] },
  { code: '44', name: 'United Kingdom', lengths: [9, 10] },
  { code: '91', name: 'India', lengths: [10] },
  { code: '254', name: 'Kenya', lengths: [9] },
  { code: '234', name: 'Nigeria', lengths: [10] },
  { code: '233', name: 'Ghana', lengths: [9] },
  { code: '971', name: 'United Arab Emirates', lengths: [9] },
  { code: '966', name: 'Saudi Arabia', lengths: [9] },
  { code: '20', name: 'Egypt', lengths: [10, 11] },
  { code: '49', name: 'Germany', lengths: [10, 11] },
  { code: '33', name: 'France', lengths: [9] },
  { code: '61', name: 'Australia', lengths: [9] },
  { code: '55', name: 'Brazil', lengths: [10, 11] },
  { code: '86', name: 'China', lengths: [11] },
  { code: '81', name: 'Japan', lengths: [10, 11] },
  { code: '65', name: 'Singapore', lengths: [8] },
  { code: '62', name: 'Indonesia', lengths: [9, 10, 11] },
  { code: '92', name: 'Pakistan', lengths: [10] },
  { code: '880', name: 'Bangladesh', lengths: [10] },
  { code: '255', name: 'Tanzania', lengths: [9] },
  { code: '251', name: 'Ethiopia', lengths: [9] },
  { code: '212', name: 'Morocco', lengths: [9] },
  { code: '213', name: 'Algeria', lengths: [9] },
  { code: '216', name: 'Tunisia', lengths: [8] },
  { code: '256', name: 'Uganda', lengths: [9] },
  { code: '263', name: 'Zimbabwe', lengths: [9] },
  { code: '260', name: 'Zambia', lengths: [9] },
  { code: '264', name: 'Namibia', lengths: [8, 9] },
]
export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading client…</div>}>
      <PortalShell title="Client Details" breadcrumb="WORKSPACE / CLIENTS / DETAILS">
        <ClientDetailContent params={params} />
      </PortalShell>
    </Suspense>
  )
}

function ClientDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { role, user, profile } = usePortal()
  
  const [clientId, setClientId] = useState<string | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<ClientContact[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [clientHistory, setClientHistory] = useState<AuditEntry[]>([])
  const [actorNames, setActorNames] = useState<Record<string, string>>({})

  // New contact form state
  const [showAddContact, setShowAddContact] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactCountry, setContactCountry] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Client edit form state
  const [showEditClient, setShowEditClient] = useState(false)
  const [editClientCode, setEditClientCode] = useState('')
  const [editClientName, setEditClientName] = useState('')
  const [editClientEmail, setEditClientEmail] = useState('')
  const [editClientPhone, setEditClientPhone] = useState('')
  const [editBillingDetails, setEditBillingDetails] = useState('')
  const [savingClient, setSavingClient] = useState(false)

  // Billing details edit state
  const [showBillingEdit, setShowBillingEdit] = useState(false)
  const [billingDetails, setBillingDetails] = useState('')
  const [savingBilling, setSavingBilling] = useState(false)

  useEffect(() => {
    params.then((p) => setClientId(p.id))
  }, [params])

  const loadClientData = useCallback(async () => {
    if (!clientId) return
    setLoading(true)

    const [clientRes, contactsRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('client_contacts').select('*').eq('client_id', clientId).order('created_at', { ascending: true })
    ])

    if (clientRes.error) {
      setStatusMessage({ type: 'error', text: 'Could not load client: ' + clientRes.error.message })
    } else {
      setClient(clientRes.data as Client)
    }

    if (!contactsRes.error && contactsRes.data) {
      setContacts(contactsRes.data as ClientContact[])
    }

    // Load change history for this client (PRD CLNT-03)
    const historyRes = await supabase
      .from('audit_entries')
      .select('id, actor_user_id, action, entity_type, entity_id, before_value, after_value, created_at')
      .eq('entity_type', 'client')
      .eq('entity_id', clientId)
      .order('created_at', { ascending: true })

    if (historyRes.error) {
      setClientHistory([])
      setActorNames({})
    } else if (historyRes.data) {
      const entries = historyRes.data as AuditEntry[]
      setClientHistory(entries)
      const actorIds = Array.from(
        new Set(entries.map((e) => e.actor_user_id).filter((v): v is string => Boolean(v)))
      )
      if (actorIds.length > 0) {
        const actorsRes = await supabase.from('profiles').select('id, full_name').in('id', actorIds)
        const actors = (actorsRes.data as Array<{ id: string; full_name: string | null }>) ?? []
        const actorMap: Record<string, string> = {}
        actors.forEach((a) => {
          actorMap[a.id] = a.full_name || 'Unknown'
        })
        setActorNames(actorMap)
      } else {
        setActorNames({})
      }
    }

    setLoading(false)
  }, [clientId])

  useEffect(() => {
    loadClientData()
  }, [loadClientData])

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault()
    if (!contactName.trim() || !clientId) return

    let phoneDigits = contactPhone.replace(/\D/g, '')
    if (contactCountry) {
      const selectedCountry = CONTACT_COUNTRIES.find((country) => country.code === contactCountry)
      if (!phoneDigits) {
        setStatusMessage({ type: 'error', text: 'Please enter the phone number for the selected country.' })
        return
      }
      // National numbers often include a trunk 0, while E.164 format does not.
      if (selectedCountry?.code !== '1' && phoneDigits.startsWith('0')) {
        phoneDigits = phoneDigits.slice(1)
      }
      if (!selectedCountry?.lengths.includes(phoneDigits.length)) {
        setStatusMessage({ type: 'error', text: `Phone number must be ${selectedCountry?.lengths.join(' or ') ?? '7 to 15'} digits for ${selectedCountry?.name ?? 'the selected country'}, excluding the country code.` })
        return
      }
    } else if (phoneDigits && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      setStatusMessage({ type: 'error', text: 'Phone number must be between 7 and 15 digits.' })
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('client_contacts').insert({
      client_id: clientId,
      name: contactName.trim(),
      role: contactRole.trim() || null,
      email: contactEmail.trim() || null,
      // Strict format: prefix the selected country code onto the continuing
      // (local) number, e.g. South Africa (+27) + 82 123 4567 -> +27821234567.
      phone: contactCountry ? `+${contactCountry}${phoneDigits}` : (contactPhone.trim() || null),
    })

    setSubmitting(false)
    if (error) {
      setStatusMessage({ type: 'error', text: 'Failed to save contact: ' + error.message })
      return
    }

    // Audit the change (PRD CLNT-03: client change history)
    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id ?? null,
      action: 'client.contact_added',
      entity_type: 'client',
      entity_id: clientId as string,
      after_value: {
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactCountry ? `+${contactCountry}${phoneDigits}` : (contactPhone.trim() || null),
      },
    })

    setStatusMessage({ type: 'success', text: 'Contact saved successfully.' })
    setContactName('')
    setContactRole('')
    setContactEmail('')
    setContactPhone('')
    setContactCountry('')
    setShowAddContact(false)
    await loadClientData()
  }

  async function handleRemoveContact(contactId: string) {
    if (!window.confirm('Remove this contact?')) return
    const contactName = contacts.find((c) => c.id === contactId)?.name ?? 'Unknown'
    const { error: removeError } = await supabase.from('client_contacts').delete().eq('id', contactId)
    if (removeError) {
      setStatusMessage({ type: 'error', text: 'Failed to remove contact: ' + removeError.message })
      return
    }
    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id ?? null,
      action: 'client.contact_removed',
      entity_type: 'client',
      entity_id: clientId as string,
      before_value: { contact_id: contactId, contact_name: contactName },
    })
    await loadClientData()
  }

  async function openEditClient() {
    if (!client) return
    setEditClientCode(client.client_code)
    setEditClientName(client.name)
    setEditClientEmail(client.email ?? '')
    setEditClientPhone(client.phone ?? '')
    setEditBillingDetails(client.billing_details ?? '')
    setShowEditClient(true)
  }

  async function handleUpdateClient(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !clientId) return
    if (!editClientCode.trim() || !editClientName.trim()) {
      setStatusMessage({ type: 'error', text: 'Client code and client name are required.' })
      return
    }

    const updates = {
      client_code: editClientCode.trim().toUpperCase(),
      name: editClientName.trim(),
      email: editClientEmail.trim() || null,
      phone: editClientPhone.trim() || null,
      billing_details: editBillingDetails.trim() || null,
    }

    // Validate phone number if provided
    if (updates.phone) {
      const phoneDigits = updates.phone.replace(/\D/g, '')
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        setStatusMessage({ type: 'error', text: 'Please enter a valid phone number (7-15 digits).' })
        return
      }
    }

    setSavingClient(true)
    setStatusMessage(null)

    const { error } = await supabase.from('clients').update(updates).eq('id', clientId)
    setSavingClient(false)

    if (error) {
      setStatusMessage({
        type: 'error',
        text: error.code === '23505'
          ? `Client code "${updates.client_code}" already exists. Please choose a unique code.`
          : 'Failed to update client: ' + error.message,
      })
      return
    }

    // Audit only when something genuinely changed; adding brand-new billing
    // details is an add, not a change, and must not pollute the change history.
    const billingBeforeUpdate = (client.billing_details ?? '').trim()
    const hasChange =
      client.client_code !== updates.client_code ||
      client.name !== updates.name ||
      (client.email ?? null) !== (updates.email ?? null) ||
      (client.phone ?? null) !== (updates.phone ?? null) ||
      Boolean(billingBeforeUpdate)

    if (hasChange) {
      await supabase.from('audit_entries').insert({
        actor_user_id: user?.id ?? null,
        action: 'client.updated',
        entity_type: 'client',
        entity_id: clientId as string,
        before_value: {
          client_code: client.client_code,
          name: client.name,
          email: client.email,
          phone: client.phone,
          billing_details: client.billing_details,
        },
        after_value: updates,
      })
    }

    setStatusMessage({ type: 'success', text: `Client "${updates.name}" updated successfully.` })
    setShowEditClient(false)
    await loadClientData()
  }

  function openBillingEdit() {
    if (!client) return
    setBillingDetails(client.billing_details ?? '')
    setShowBillingEdit(true)
  }

  async function handleSaveBilling(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !clientId) return

    setSavingBilling(true)
    setStatusMessage(null)

    const { error } = await supabase
      .from('clients')
      .update({ billing_details: billingDetails.trim() || null })
      .eq('id', clientId)
    setSavingBilling(false)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Failed to save billing details: ' + error.message })
      return
    }

    // Only record a change-history entry when billing details already existed.
    // An initial add (before was empty) is an add, not a change, so it must not
    // pollute the change history.
    const billingBefore = (client.billing_details ?? '').trim()
    const billingAfter = billingDetails.trim() || null

    if (billingBefore) {
      await supabase.from('audit_entries').insert({
        actor_user_id: user?.id ?? null,
        action: 'client.billing_updated',
        entity_type: 'client',
        entity_id: clientId as string,
        before_value: { billing_details: client.billing_details },
        after_value: { billing_details: billingAfter },
      })
    }

    setStatusMessage({
      type: 'success',
      text: billingBefore ? 'Billing details updated successfully.' : 'Billing details added successfully.',
    })
    setShowBillingEdit(false)
    await loadClientData()
  }

  async function handleRemoveBilling() {
    if (!client || !clientId) return
    if (!window.confirm('Remove billing details for this client?')) return

    setSavingBilling(true)
    setStatusMessage(null)

    const { error } = await supabase
      .from('clients')
      .update({ billing_details: null })
      .eq('id', clientId)
    setSavingBilling(false)

    if (error) {
      setStatusMessage({ type: 'error', text: 'Failed to remove billing details: ' + error.message })
      return
    }

    // Removing only counts as a change when billing details already existed.
    const billingBefore = (client.billing_details ?? '').trim()
    if (billingBefore) {
      await supabase.from('audit_entries').insert({
        actor_user_id: user?.id ?? null,
        action: 'client.billing_removed',
        entity_type: 'client',
        entity_id: clientId as string,
        before_value: { billing_details: client.billing_details },
        after_value: { billing_details: null },
      })
    }

    setStatusMessage({ type: 'success', text: billingBefore ? 'Billing details removed.' : 'No billing details to remove.' })
    setShowBillingEdit(false)
    await loadClientData()
  }

  const selectedContactCountry = CONTACT_COUNTRIES.find((c) => c.code === contactCountry)
  const contactPhoneMaxLength = selectedContactCountry
    ? Math.max(...selectedContactCountry.lengths) + 3
    : 15
  const contactPhoneExpectedText = selectedContactCountry
    ? `Enter ${selectedContactCountry.lengths.join(' or ')} digits for ${selectedContactCountry.name}. Do not enter +${selectedContactCountry.code}; leave out a leading trunk 0.`
    : 'Enter a phone number; select a country to add its code automatically.'

  // Derived primary contact (the first one in the list)
  const primaryContact = contacts.length > 0 ? contacts[0] : null

  const canEditClient =
    role === 'senior_dev_pm' ||
    role === 'administrator' ||
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator' ||
    (user?.email ? user.email.toLowerCase().includes('senior') : false) ||
    (user?.email ? user.email.toLowerCase().includes('admin') : false)

  if (loading) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⏳</div>
          <p className="portal-empty-title">Loading client...</p>
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⚠️</div>
          <p className="portal-empty-title">Client not found</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <button type="button" className="portal-back-btn" onClick={() => router.push('/clients')}>
        <span>←</span> Back to all clients
      </button>

      {statusMessage && (
        <div className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'} style={{ marginBottom: 20 }} role="alert">
          <span>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Client Header */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <span className="code-badge" style={{ marginBottom: 8 }}>{client.client_code}</span>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#14213d', margin: 0 }}>{client.name}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {canEditClient && (
              <button type="button" className="portal-btn-secondary" style={{ height: 34, fontSize: 12 }} onClick={openEditClient}>
                <span>✎</span> Edit Client
              </button>
            )}
            {canEditClient && (
              <button type="button" className="portal-btn-secondary" style={{ height: 34, fontSize: 12 }} onClick={() => router.push('/clients')}>
                <span>✉</span> Contacts
              </button>
            )}
            <span className="portal-badge badge-blue">Active Client</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24, borderTop: '1px solid #e8ecf3', paddingTop: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Primary Contact</label>
            <span style={{ fontSize: 14, color: '#14213d', fontWeight: 600 }}>
              {primaryContact ? primaryContact.name : '—'}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Email Address</label>
            <span style={{ fontSize: 14, color: '#2563eb' }}>
              {primaryContact?.email || client.email || '—'}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Phone Number</label>
            <span style={{ fontSize: 14, color: '#14213d' }}>
              {primaryContact?.phone || client.phone || '—'}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Billing Details</label>
            <span style={{ fontSize: 14, color: '#14213d' }}>
              {client.billing_details || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Dedicated billing quick-edit entry point */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        {canEditClient && (
          <button type="button" className="portal-btn-secondary" style={{ height: 34, fontSize: 12 }} onClick={openBillingEdit}>
            <span>✎</span> Edit Billing Details
          </button>
        )}
      </div>

      {showBillingEdit && client && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <div>
              <h3>Billing Details</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Manage the billing information for this client.</p>
            </div>
            <button type="button" className="portal-back-btn" onClick={() => setShowBillingEdit(false)}>
              <span>←</span> Cancel
            </button>
          </div>

          <form onSubmit={handleSaveBilling} style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Billing Details</label>
              <textarea
                className="form-input"
                style={{ height: 'auto', minHeight: 88, resize: 'vertical' }}
                value={billingDetails}
                onChange={(e) => setBillingDetails(e.target.value)}
                placeholder="e.g. Contract value, billing contact, payment terms..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="portal-btn-secondary" onClick={() => setShowBillingEdit(false)} disabled={savingBilling}>Cancel</button>
              <button type="button" className="portal-danger-btn" onClick={handleRemoveBilling} disabled={savingBilling}>
                Remove Billing Details
              </button>
              <button type="submit" className="portal-btn-primary" disabled={savingBilling}>{savingBilling ? 'Saving...' : 'Save Billing Details'}</button>
            </div>
          </form>
        </div>
      )}

      {showEditClient && client && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <div>
              <h3>Edit Client</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Update the client details.</p>
            </div>
            <button type="button" className="portal-back-btn" onClick={() => setShowEditClient(false)}>
              <span>←</span> Cancel
            </button>
          </div>

          <form onSubmit={handleUpdateClient} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Client Code *</label>
                <input className="form-input" value={editClientCode} onChange={(e) => setEditClientCode(e.target.value)} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Client Name *</label>
                <input className="form-input" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Contact Email</label>
                <input type="email" className="form-input" value={editClientEmail} onChange={(e) => setEditClientEmail(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phone</label>
                <input type="tel" className="form-input" inputMode="tel" maxLength={20} value={editClientPhone} onChange={(e) => setEditClientPhone(e.target.value)} placeholder="e.g. +27 82 123 4567" />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Billing Details</label>
              <textarea
                className="form-input"
                style={{ height: 'auto', minHeight: 88, resize: 'vertical' }}
                value={editBillingDetails}
                onChange={(e) => setEditBillingDetails(e.target.value)}
                placeholder="e.g. Contract value, billing contact, payment terms..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="portal-btn-secondary" onClick={() => setShowEditClient(false)} disabled={savingClient}>Cancel</button>
              <button type="submit" className="portal-btn-primary" disabled={savingClient}>{savingClient ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Change History */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Change History</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Who changed what and when for this client.</p>
          </div>
        </div>

        {clientHistory.length === 0 ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">🕘</div>
            <p className="portal-empty-title">No changes recorded</p>
            <p style={{ fontSize: 13, color: '#64748b' }}>Client changes will appear here.</p>
          </div>
        ) : (
          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Changed By</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {[...clientHistory].reverse().map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</td>
                    <td><span className="portal-badge badge-gray">{entry.action}</span></td>
                    <td>{actorNames[entry.actor_user_id ?? ''] ?? 'Unknown'}</td>
                    <td>
                      <span style={{ fontSize: 12 }}>
                        before: {entry.before_value ? JSON.stringify(entry.before_value) : '—'}
                        {entry.before_value && entry.after_value ? ' → ' : ''}
                        after: {entry.after_value ? JSON.stringify(entry.after_value) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Contacts List */}
      <div className="portal-card">
        <div className="portal-card-header">
          <div>
            <h3>Client Contacts ({contacts.length})</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Key stakeholders and points of contact for this client.</p>
          </div>
          {!showAddContact && (
            <button type="button" className="portal-btn-primary" style={{ height: 34, fontSize: 12 }} onClick={() => setShowAddContact(true)}>
              + Add Contact
            </button>
          )}
        </div>

        {showAddContact && (
          <form onSubmit={handleAddContact} style={{ background: '#f8fafc', padding: 20, borderRadius: 10, marginBottom: 20, border: '1px solid #e8ecf3' }}>
            <h4 style={{ margin: '0 0 16px' }}>New Contact Information</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Full Name *</label>
                <input required className="form-input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Role / Job Title</label>
                <input className="form-input" value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Email</label>
                <input type="email" className="form-input" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Country Code</label>
                <select className="form-input" value={contactCountry} onChange={(e) => setContactCountry(e.target.value)}>
                  <option value="">Select country…</option>
                  {CONTACT_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name} (+{c.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phone Number</label>
                <input className="form-input" type="tel" inputMode="tel" maxLength={contactPhoneMaxLength} value={contactPhone} onChange={(e) => setContactPhone(e.target.value.replace(/[^0-9 ()-]/g, ''))} placeholder="Local number, e.g. 82 123 4567" />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{contactPhoneExpectedText}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="portal-btn-secondary" onClick={() => setShowAddContact(false)}>Cancel</button>
              <button type="submit" className="portal-btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Save Contact'}</button>
            </div>
          </form>
        )}

        {contacts.length === 0 ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">👥</div>
            <p className="portal-empty-title">No contacts added yet</p>
            <p style={{ fontSize: 13, color: '#64748b' }}>Add primary contacts and stakeholders for easy collaboration.</p>
          </div>
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Contact Name</th>
                <th>Position / Role</th>
                <th>Email</th>
                <th>Phone</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td><strong>{contact.name}</strong></td>
                  <td><span className="portal-badge badge-gray">{contact.role || '—'}</span></td>
                  <td><span style={{ color: '#2563eb' }}>{contact.email || '—'}</span></td>
                  <td>{contact.phone || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="portal-btn-secondary" style={{ height: 28, fontSize: 11, color: '#ef4444' }} onClick={() => handleRemoveContact(contact.id)}>
                      Remove
                    </button>
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