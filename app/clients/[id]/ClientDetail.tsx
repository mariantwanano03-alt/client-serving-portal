'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type ClientRecord = {
  id: string
  client_code: string
  name: string
  primary_contact: string | null
  email: string | null
  phone: string | null
  created_at: string | null
}

type RelatedProject = {
  id: string
  name: string
  project_reference: string
  status: string
  created_at: string | null
}

export default function ClientDetail({ id }: { id: string }) {
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [projects, setProjects] = useState<RelatedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadClient() {
      setLoading(true)
      setErrorMessage('')
      try {
        const [clientResult, projectsResult] = await Promise.all([
          supabase
            .from('clients')
            .select('id, client_code, name, primary_contact, email, phone, created_at')
            .eq('id', id)
            .single(),
          supabase
            .from('projects')
            .select('id, name, project_reference, status, created_at')
            .eq('client_id', id)
            .order('created_at', { ascending: false }),
        ])

        if (ignore) return

        if (clientResult.error) {
          setErrorMessage('Could not load client: ' + clientResult.error.message)
        } else {
          setClient(clientResult.data as ClientRecord)
        }

        if (projectsResult.error) {
          setErrorMessage((previous) => previous || 'Could not load related projects: ' + projectsResult.error.message)
        } else {
          setProjects((projectsResult.data ?? []) as RelatedProject[])
        }
      } catch (err: unknown) {
        if (!ignore) setErrorMessage(err instanceof Error ? err.message : 'Could not load client details.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadClient()
    return () => { ignore = true }
  }, [id])

  return (
    <div className="oversight-page">
      <div className="readonly-banner" data-testid="client-readonly">
        <span aria-hidden="true">👁</span>
        <span>
          Read-only client profile. Client information and linked projects are view-only;
          no edit or upload controls are available.
        </span>
      </div>

      <Link href="/clients" className="portal-back-btn">← Back to Clients</Link>

      {errorMessage && (
        <div className="auth-alert-error" role="alert" style={{ marginBottom: 16 }}>
          <span aria-hidden="true">⚠️</span><span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⏳</div>
          <p className="portal-empty-title">Loading client profile...</p>
        </div>
      ) : !client ? (
        <div className="portal-empty-state">
          <div className="portal-empty-icon">♙</div>
          <p className="portal-empty-title">Client not found</p>
          <p className="portal-empty-desc">This client record is unavailable.</p>
        </div>
      ) : (
        <>
          <section className="portal-detail-header">
            <h2 style={{ margin: 0, color: 'var(--heading)' }}>{client.name}</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
              Client code: <span className="code-badge">{client.client_code}</span>
            </p>
            <div className="portal-detail-meta-grid">
              <div className="portal-meta-item">
                <label>Primary contact</label>
                <span>{client.primary_contact || '—'}</span>
              </div>
              <div className="portal-meta-item">
                <label>Email</label>
                <span>{client.email || '—'}</span>
              </div>
              <div className="portal-meta-item">
                <label>Phone</label>
                <span>{client.phone || '—'}</span>
              </div>
              <div className="portal-meta-item">
                <label>Created date</label>
                <span>{client.created_at ? new Date(client.created_at).toLocaleDateString() : '—'}</span>
              </div>
            </div>
          </section>

          <section className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3>Related projects</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                  Projects associated with this client. Read-only.
                </p>
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="portal-empty-state">
                <div className="portal-empty-icon">▤</div>
                <p className="portal-empty-title">No related projects</p>
              </div>
            ) : (
              <div className="portal-table-container">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Project name</th>
                      <th>Reference</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => (
                      <tr key={project.id} data-testid="client-project-row">
                        <td>
                          <Link href={`/projects/${project.id}`} className="portal-table-link">
                            {project.name}
                          </Link>
                        </td>
                        <td><span className="code-badge">{project.project_reference}</span></td>
                        <td><span className="portal-badge badge-gray">{project.status}</span></td>
                        <td>{project.created_at ? new Date(project.created_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
