'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null }

export default function ClientDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [role, setRole] = useState('')
  const [userId, setUserId] = useState('')
  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [message, setMessage] = useState('Loading...')

  const [cName, setCName] = useState('')
  const [cRole, setCRole] = useState('')
  const [cEmail, setCEmail] = useState('')
  const [cPhone, setCPhone] = useState('')

  async function load() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push('/login'); return }
    setUserId(userData.user.id)
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single()
    setRole(profile?.role ?? '')

    const { data: c } = await supabase.from('clients').select('id, client_code, name, email, phone, primary_contact, billing_details').eq('id', id).single()
    setClient(c as Client)

    const { data: ct } = await supabase.from('client_contacts').select('id, name, role, email, phone').eq('client_id', id).order('created_at', { ascending: false })
    setContacts((ct ?? []) as Contact[])
    setMessage('')
  }

  useEffect(() => { if (id) load() }, [id, router])

  const canEdit = role === 'senior_dev_pm'

  async function addContact() {
    if (!cName.trim()) { setMessage('Contact name is required.'); return }
    setMessage('Saving contact...')
    const { error } = await supabase.from('client_contacts').insert({
      client_id: id,
      name: cName.trim(),
      role: cRole.trim() || null,
      email: cEmail.trim() || null,
      phone: cPhone.trim() || null,
    })
    if (error) { setMessage('Could not save: ' + error.message); return }
    setCName(''); setCRole(''); setCEmail(''); setCPhone('')
    setMessage('Contact saved.')
    await load()
  }

  async function deleteContact(contactId: string) {
    if (!window.confirm('Delete this contact?')) return
    const { error } = await supabase.from('client_contacts').delete().eq('id', contactId)
    if (error) { setMessage('Could not delete: ' + error.message); return }
    setMessage('Contact deleted.')
    await load()
  }

  const box = { padding: 8, color: 'black' }

  if (!client) return <main style={{ padding: 40 }}>{message || 'Loading...'}</main>

  return (
    <main style={{ padding: 40, maxWidth: 800 }}>
      <button onClick={() => router.push('/clients')} style={{ marginBottom: 20 }}>← Back to clients</button>
      <h1>{client.client_code} — {client.name}</h1>
      <p>Email: {client.email ?? '—'}</p>
      <p>Phone: {client.phone ?? '—'}</p>
      <p>Primary contact: {client.primary_contact ?? '—'}</p>
      <p>Billing details: {client.billing_details ?? '—'}</p>
      <p>Your role: {role}</p>
      <p style={{ color: 'green' }}>{message}</p>

      <section style={{ marginTop: 30 }}>
        <h2>Contacts</h2>
        {contacts.length === 0 ? (
          <p style={{ color: '#777', fontStyle: 'italic' }}>No contacts yet.</p>
        ) : (
          <ul>{contacts.map((c) => (
            <li key={c.id} style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <strong>{c.name}</strong> {c.role ? `(${c.role})` : ''} — {c.email ?? ''} {c.phone ?? ''}
              </div>
              {canEdit && (
                <button onClick={() => deleteContact(c.id)} title="Delete" style={{ padding: '2px 8px', color: 'red', border: '1px solid red', background: 'transparent', cursor: 'pointer' }}>
                  🗑
                </button>
              )}
            </li>
          ))}</ul>
        )}

        {!canEdit && (
          <p style={{ fontSize: 12, color: '#777', marginTop: 10 }}>
            Only a Senior Developer / PM can add or remove contacts. You have view-only access.
          </p>
        )}
        {canEdit && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 500 }}>
            <input placeholder="Contact name" value={cName} onChange={(e) => setCName(e.target.value)} style={box} />
            <input placeholder="Position / Job title (e.g. Finance Manager)" value={cRole} onChange={(e) => setCRole(e.target.value)} style={box} />
            <input placeholder="Email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={box} />
            <input placeholder="Phone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} style={box} />
            <button onClick={addContact} style={{ padding: 8 }}>Add contact</button>
          </div>
        )}
      </section>
    </main>
  )
}
