'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type ProjectRow = {
  id: string
  project_reference: string
  name: string
  created_at?: string | null
  clients: { name: string; client_code: string } | null
}

export default function ProjectsPage() {
  const router = useRouter()
  const { profile } = usePortal()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let ignore = false

    const loadProjects = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, project_reference, name, created_at, clients(name, client_code)')
          .order('created_at', { ascending: false })

        if (ignore) return

        if (error) {
          setErrorMessage('Could not load projects: ' + error.message)
        } else {
          setProjects((data ?? []) as unknown as ProjectRow[])
        }
      } catch (err: unknown) {
        if (ignore) return
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load projects.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadProjects()

    return () => {
      ignore = true
    }
  }, [])

  const displayName = profile?.full_name?.trim() || 'User'

  if (loading) {
    return (
      <PortalShell title="Projects" breadcrumb="WORKSPACE / PROJECTS">
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading projects...</div>
      </PortalShell>
    )
  }

  return (
    <PortalShell title="Projects" breadcrumb="WORKSPACE / PROJECTS">
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '20px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#14213d', margin: 0 }}>
              Projects
            </h1>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
              Welcome back, {displayName}. Here are your projects.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div
            style={{ padding: '12px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', fontSize: '13px', marginBottom: '16px' }}
          >
            {errorMessage}
          </div>
        )}

        {projects.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', margin: 0 }}>No projects yet</p>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
              Create your first project from the Home page.
            </p>
          </div>
        ) : (
          <div style={{ border: '1px solid #e8ecf3', borderRadius: '12px', background: '#ffffff', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th style={{ padding: '14px 18px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: '1px solid #e8ecf3' }}>Project Reference</th>
                  <th style={{ padding: '14px 18px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: '1px solid #e8ecf3' }}>Client Name</th>
                  <th style={{ padding: '14px 18px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: '1px solid #e8ecf3' }}>Created Date</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <td style={{ padding: '14px 18px', color: '#1e293b', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
                      {project.project_reference}
                    </td>
                    <td style={{ padding: '14px 18px', color: '#1e293b' }}>
                      {project.clients?.name || 'Unassigned'}
                      {project.clients?.client_code && (
                        <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '6px' }}>({project.clients.client_code})</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px', color: '#64748b' }}>
                      {project.created_at ? new Date(project.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PortalShell>
  )
}
