'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

import ClientsTab from './tabs/ClientsTab'
import DocumentsTab from './tabs/DocumentsTab'
import UrlLinksTab from './tabs/UrlLinksTab'

type ProjectRecord = {
  id: string
  project_reference: string
  name: string
  description: string | null
  stage: string
  status: string
  client_id: string | null
  created_at?: string | null
  clients: {
    id: string
    name: string
    primary_contact: string | null
    email: string | null
    phone: string | null
  } | null
}

type TabId = 'clients' | 'documents' | 'links'

const TABS: { id: TabId; label: string }[] = [
  { id: 'clients', label: 'Clients' },
  { id: 'documents', label: 'Documents' },
  { id: 'links', label: 'URL Links' },
]

export default function ProjectWorkspace({ id }: { id: string }) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('clients')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadProject = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, project_reference, name, description, stage, status, client_id, created_at, clients(id, name, primary_contact, email, phone)')
        .eq('id', id)
        .single()

      if (error) {
        setErrorMessage('Could not load project: ' + error.message)
        setLoading(false)
        return
      }

      setProject(data as unknown as ProjectRecord)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load project.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  const client = project?.clients || null
  const clientName = client?.name || 'Unassigned'

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading project workspace...</div>
    )
  }

  if (!project) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
        <p>Project not found.</p>
        <button onClick={() => router.push('/projects')} style={{ marginTop: '12px' }}>
          Back to Projects
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: '10px' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'inline-block' }}>
            {project.project_reference}
          </span>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#14213d', margin: '4px 0 0' }}>{project.name}</h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
            Client: <strong>{clientName}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => router.push('/projects')} className="portal-btn-secondary" style={{ height: '34px', fontSize: '12px' }}>
            Back to Projects
          </button>
        </div>
      </div>

      {errorMessage && (
        <div style={{ padding: '10px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', fontSize: '13px', marginBottom: '16px' }}>
          {errorMessage}
        </div>
      )}

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${message.type === 'success' ? '#a7f3d0' : '#fee2e2'}`, color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: '13px', marginBottom: '16px' }}
        >
          {message.text}
        </div>
      )}

      <div style={{ borderBottom: '1.5px solid #e2e8f0', marginBottom: '24px', display: 'flex', gap: '0' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`portal-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            style={{ padding: '12px 18px', fontSize: '13px', fontWeight: 600 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'clients' && <ClientsTab client={client} />}
      {activeTab === 'documents' && <DocumentsTab projectId={id} />}
      {activeTab === 'links' && <UrlLinksTab projectId={id} />}
    </div>
  )
}
