'use client'

import React, { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type DiscoverySession = {
  id: string
  meeting_title: string | null
  meeting_date: string | null
  generation_status: string
  created_at: string
  client_id: string | null
  project_id: string | null
}

export default function DiscoveryMeetingsPage() {
  return (
    <PortalShell title="Discovery Meetings" breadcrumb="WORKSPACE / DISCOVERY">
      <DiscoveryMeetingsContent />
    </PortalShell>
  )
}

function DiscoveryMeetingsContent() {
  const { role } = usePortal()
  const [meetings, setMeetings] = useState<DiscoverySession[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const canCreate =
    role === 'senior_dev_pm' ||
    role === 'junior_developer' ||
    role === 'administrator'

  const loadMeetings = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('discovery_sessions')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        setStatusMessage({ type: 'error', text: 'Could not load discovery meetings: ' + error.message })
      } else {
        setMeetings((data ?? []) as DiscoverySession[])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMeetings()
  }, [loadMeetings])

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pending',
    extracting: 'Extracting',
    promoting: 'Promoting',
    generating: 'Generating',
    complete: 'Approved',
    failed: 'Failed',
  }

  const STATUS_BADGE_CLASS: Record<string, string> = {
    pending: 'portal-badge badge-amber',
    extracting: 'portal-badge badge-purple',
    promoting: 'portal-badge badge-purple',
    generating: 'portal-badge badge-purple',
    complete: 'portal-badge badge-green',
    failed: 'portal-badge badge-red',
  }

  const handleStartSession = async (title: string) => {
    if (!title.trim()) {
      setStatusMessage({ type: 'error', text: 'Meeting title is required.' })
      return
    }

    const today = new Date().toISOString().split('T')[0]

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      const res = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          meetingTitle: title.trim(),
          meetingDate: today,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start discovery session')
      }

      setStatusMessage({ type: 'success', text: 'Discovery session created successfully.' })
      await loadMeetings()
      // Redirect to the new meeting
      const sessionId = data.data?.id
      if (sessionId) {
        window.location.href = `/discovery/${sessionId}`
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
  }

  if (loading) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⏳</div>
          <p className="portal-empty-title">Loading discovery meetings...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="portal-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3>Discovery Meetings ({meetings.length})</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Create discovery meetings to capture prospective client information before a project or client exists.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              const title = window.prompt('Enter meeting title:')
              if (title) {
                handleStartSession(title)
              }
            }}
            className="portal-btn-primary"
          >
            <span>+</span> New Discovery Meeting
          </button>
        )}
      </div>

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

      {meetings.length === 0 ? (
        <div className="portal-empty-state">
          <div className="portal-empty-icon">📋</div>
          <p className="portal-empty-title">No discovery meetings yet</p>
          <p className="portal-empty-desc">
            Start a discovery meeting to capture prospective client information. The client and project will be created automatically upon approval.
          </p>
        </div>
      ) : (
        <div className="portal-table-container">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Meeting Title</th>
                <th>Date</th>
                <th>Status</th>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.meeting_title || 'Untitled Meeting'}</strong>
                  </td>
                  <td>{m.meeting_date || '—'}</td>
                  <td>
                    <span className={STATUS_BADGE_CLASS[m.generation_status]}>
                      {STATUS_LABEL[m.generation_status] || m.generation_status}
                    </span>
                  </td>
                  <td>
                    {m.client_id ? <span style={{ color: '#334155', fontWeight: 500 }}>Linked</span> : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      href={`/discovery/${m.id}`}
                      className="portal-btn-secondary"
                      style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
