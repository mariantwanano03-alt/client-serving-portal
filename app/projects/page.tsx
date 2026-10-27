'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Client = { id: string; client_code: string; name: string }
type Project = {
  id: string
  project_reference: string
  name: string
  stage: string
  status: string
  created_at?: string
  clients: { client_code: string; name: string } | null
}

function getStageBadgeClass(stage: string): string {
  switch (stage.toLowerCase()) {
    case 'discovery':
      return 'portal-badge badge-blue'
    case 'scoping':
    case 'requirements':
      return 'portal-badge badge-purple'
    case 'development':
      return 'portal-badge badge-amber'
    case 'completed':
    case 'approved':
      return 'portal-badge badge-green'
    default:
      return 'portal-badge badge-gray'
  }
}

export default function ProjectsPage() {
  return (
    <PortalShell title="Projects" breadcrumb="WORKSPACE / PROJECTS">
      <ProjectsContent />
    </PortalShell>
  )
}

function ProjectsContent() {
  const { role, user } = usePortal()

  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [showAddForm, setShowAddForm] = useState(false)

  // Form State
  const [reference, setReference] = useState('')
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const canCreateProject = role === 'senior_dev_pm'

  const loadProjects = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_reference, name, stage, status, created_at, clients(client_code, name)')
      .order('created_at', { ascending: false })

    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not load projects: ' + error.message })
    } else {
      setProjects((data as unknown as Project[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let ignore = false

    async function init() {
      const { data: clientData } = await supabase
        .from('clients')
        .select('id, client_code, name')
        .order('client_code')

      if (!ignore && clientData) {
        setClients(clientData)
      }

      const { data: projectData, error: projErr } = await supabase
        .from('projects')
        .select('id, project_reference, name, stage, status, created_at, clients(client_code, name)')
        .order('created_at', { ascending: false })

      if (!ignore) {
        if (projErr) {
          setStatusMessage({ type: 'error', text: 'Could not load projects: ' + projErr.message })
        } else {
          setProjects((projectData as unknown as Project[]) ?? [])
        }
        setLoading(false)
      }
    }

    init()

    return () => {
      ignore = true
    }
  }, [])

  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      setStatusMessage({ type: 'error', text: 'Please choose a client for this project.' })
      return
    }
    if (!reference.trim() || !name.trim()) {
      setStatusMessage({ type: 'error', text: 'Project reference and project name are required.' })
      return
    }

    setSaving(true)
    setStatusMessage(null)

    const cleanRef = reference.trim().toUpperCase()
    const cleanName = name.trim()

    const { error } = await supabase.from('projects').insert({
      project_reference: cleanRef,
      client_id: clientId,
      name: cleanName,
      created_by: user?.id,
    })

    if (error) {
      setSaving(false)
      setStatusMessage({
        type: 'error',
        text:
          error.code === '23505'
            ? `Project reference "${cleanRef}" already exists. Please choose a unique reference.`
            : 'Could not save project: ' + error.message,
      })
      return
    }

    // Record audit entry
    await supabase.from('audit_entries').insert({
      actor_user_id: user?.id,
      action: 'project.created',
      entity_type: 'project',
      after_value: {
        project_reference: cleanRef,
        name: cleanName,
        client_id: clientId,
      },
    })

    setReference('')
    setName('')
    setClientId('')
    setSaving(false)
    setShowAddForm(false)
    setStatusMessage({ type: 'success', text: `Project "${cleanName}" created successfully.` })
    await loadProjects()
  }

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesSearch =
        !search.trim() ||
        p.project_reference.toLowerCase().includes(search.toLowerCase()) ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.clients && p.clients.name.toLowerCase().includes(search.toLowerCase())) ||
        (p.clients && p.clients.client_code.toLowerCase().includes(search.toLowerCase()))

      const matchesStage = stageFilter === 'all' || p.stage.toLowerCase() === stageFilter.toLowerCase()

      return matchesSearch && matchesStage
    })
  }, [projects, search, stageFilter])

  return (
    <div>
      {/* Stats Row */}
      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon projects-tone">▤</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Total Projects</span>
            <span className="portal-stat-value">{projects.length}</span>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon clients-tone">♙</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Clients with Projects</span>
            <span className="portal-stat-value">
              {new Set(projects.map((p) => p.clients?.client_code).filter(Boolean)).size}
            </span>
          </div>
        </div>
      </div>

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

      {/* Add Project Collapsible Form */}
      {showAddForm && canCreateProject && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <h3>Create New Project</h3>
            <button
              type="button"
              className="portal-back-btn"
              onClick={() => setShowAddForm(false)}
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleAddProject} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="project-client-select">
                  Select Client <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  id="project-client-select"
                  className="form-input"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={saving}
                  required
                >
                  <option value="">— Choose a Client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.client_code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="project-ref-input">
                  Project Reference <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="project-ref-input"
                  className="form-input"
                  placeholder="e.g. PRJ-ACME-01"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={saving}
                  required
                />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Unique identifier</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="project-name-input">
                  Project Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="project-name-input"
                  className="form-input"
                  placeholder="e.g. Customer Portal Redesign"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setShowAddForm(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
                disabled={saving}
              >
                {saving ? 'Creating Project...' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toolbar / Filters */}
      <div className="portal-toolbar">
        <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
          <div className="portal-search-wrap">
            <span className="portal-search-icon">🔍</span>
            <input
              type="text"
              className="portal-search-input"
              placeholder="Search by reference, name, client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 150, height: 40 }}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">All Stages</option>
            <option value="discovery">Discovery</option>
            <option value="scoping">Scoping</option>
            <option value="development">Development</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {canCreateProject && !showAddForm && (
          <button
            type="button"
            className="portal-btn-primary"
            onClick={() => setShowAddForm(true)}
          >
            <span>+</span> Add Project
          </button>
        )}
      </div>

      {/* Projects Data Table */}
      <div className="portal-table-container">
        {loading ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">⏳</div>
            <p className="portal-empty-title">Loading projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="portal-empty-state">
            <div className="portal-empty-icon">📁</div>
            <p className="portal-empty-title">
              {search || stageFilter !== 'all' ? 'No matching projects found' : 'No projects created yet'}
            </p>
            <p className="portal-empty-desc">
              {search || stageFilter !== 'all'
                ? 'Try adjusting your search criteria or stage filter.'
                : canCreateProject
                ? 'Get started by creating your first client project.'
                : 'Projects created by senior managers will appear here.'}
            </p>
            {canCreateProject && !search && stageFilter === 'all' && (
              <button
                type="button"
                className="portal-btn-primary"
                onClick={() => setShowAddForm(true)}
              >
                + Create First Project
              </button>
            )}
          </div>
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Project Name</th>
                <th>Client</th>
                <th>Stage</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <span className="code-badge">{project.project_reference}</span>
                  </td>
                  <td>
                    <Link
                      href={`/projects/${project.id}`}
                      className="portal-table-link"
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td>
                    {project.clients ? (
                      <span style={{ color: '#334155', fontWeight: 500 }}>
                        {project.clients.name}{' '}
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>({project.clients.client_code})</span>
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Unassigned</span>
                    )}
                  </td>
                  <td>
                    <span className={getStageBadgeClass(project.stage)}>
                      {project.stage}
                    </span>
                  </td>
                  <td>
                    <span className="portal-badge badge-gray">
                      {project.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="portal-btn-secondary"
                      style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    >
                      Manage →
                    </Link>
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
