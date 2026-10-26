'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Client = { id: string; client_code: string; name: string; email: string | null }

export default function ClientsPage() {
  const router = useRouter()
  const [role, setRole] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  async function loadClients() {
    const { data, error } = await supabase
      .from('clients')
      .select('id, client_code, name, email')
      .order('created_at', { ascending: false })
    if (error) setMessage('Could not load clients: ' + error.message)
    else setClients(data)
  }

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.push('/login')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userData.user.id)
        .single()
      setRole(profile?.role ?? '')
      await loadClients()
    }
    load()
  }, [router])

  async function handleAdd() {
    setMessage('Saving...')
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('clients').insert({
      client_code: code,
      name,
      email: email || null,
      created_by: userData.user?.id,
    })
    if (error) {
      setMessage(
        error.code === '23505'
          ? 'That client code already exists.'
          : 'Could not save: ' + error.message
      )
      return
    }
    setCode('')
    setName('')
    setEmail('')
    setMessage('Client saved.')
    await loadClients()
  }

  const box = { padding: 8, color: 'black' }

  return (
    <main style={{ padding: 40, maxWidth: 600 }}>
      <h1>Clients</h1>
      <p>Your role: {role || '...'}</p>

      {role === 'senior_dev_pm' && (
        <div style={{ display: 'grid', gap: 10, margin: '20px 0' }}>
          <h2>Add a client</h2>
          <input placeholder="Client code (unique)" value={code} onChange={(e) => setCode(e.target.value)} style={box} />
          <input placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} style={box} />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} style={box} />
          <button onClick={handleAdd} style={{ padding: 10 }}>Save client</button>
        </div>
      )}

      <p>{message}</p>

      <h2>Client list</h2>
      {clients.length === 0 ? (
        <p>No clients yet.</p>
      ) : (
        <ul>
          {clients.map((c) => (
            <li key={c.id}>
              {c.client_code} — {c.name} {c.email ? '(' + c.email + ')' : ''}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}