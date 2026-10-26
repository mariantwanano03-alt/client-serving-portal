'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Client = { id: string; client_code: string; name: string }
type Project = {
  id: string
  project_reference: string
  name: string
  stage: string
  status: string
  clients: { client_code: string; name: string } | null
}

export default function ProjectsPage() {
  const router = useRouter()
  const [role, setRole] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [reference, setReference] = useState('')
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [message, setMessage] = useState('')

  async function loadProjects() {
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_reference, name, stage, status, clients(client_code, name)')
      .order('created_at', { ascending: false })
    if (error) setMessage('Could not load projects: ' + error.message)
    else setProjects(data as unknown as Project[])
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
      const { data: clientData } = await supabase
        .from('clients')
        .select('id, client_code, name')
        .order('client_code')
      setClients(clientData ?? [])
      await loadProjects()
    }
    load()
  }, [router])

  async function handleAdd() {
    if (!clientId) {
      setMessage('Please choose a client.')
      return
    }
    setMessage('Saving...')
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('projects').insert({
      project_reference: reference,
      client_id: clientId,
      name,
      created_by: userData.user?.id,
    })
    if (error) {
      setMessage(
        error.code === '23505'
          ? 'That project reference already exists.'
          : 'Could not save: ' + error.message
      )
      return
    }
    setReference('')
    setName('')
    setClientId('')
    setMessage('Project saved.')
    await loadProjects()
  }

  const box = { padding: 8, color: 'black' }

  return (
    <main style={{ padding: 40, maxWidth: 700 }}>
      <h1>Projects</h1>
      <p>Your role: {role || '...'}</p>

      {role === 'senior_dev_pm' && (
        <div style={{ display: 'grid', gap: 10, margin: '20px 0' }}>
          <h2>Add a project</h2>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={box}>
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.name}
              </option>
            ))}
          </select>
          <input placeholder="Project reference (unique)" value={reference} onChange={(e) => setReference(e.target.value)} style={box} />
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} style={box} />
          <button onClick={handleAdd} style={{ padding: 10 }}>Save project</button>
        </div>
      )}

      <p>{message}</p>

      <h2>Project list</h2>
      {projects.length === 0 ? (
        <p>No projects yet.</p>
      ) : (
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              {p.project_reference} — {p.name} (Client: {p.clients?.name ?? 'unknown'}) · Stage: {p.stage} · Status: {p.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
} 