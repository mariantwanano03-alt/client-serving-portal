'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type DiscoveryMeeting = {
  id: string
  meeting_date: string | null
  status: string
  client_name: string
  primary_contact: string
  contact_email: string | null
  contact_phone: string | null
  company_address: string | null
  company_description: string | null
  industry: string | null
  business_requirements: string | null
  client_objectives: string | null
  problems_challenges: string | null
  required_services: string | null
  additional_notes: string | null
  client_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  scheduled: 'badge-gray',
  'in_progress': 'badge-amber',
  'pending_review': 'badge-blue',
  approved: 'badge-green',
  rejected: 'badge-purple',
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  'in_progress': 'In Progress',
  'pending_review': 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default function DiscoveryMeetingsPage() {
  return (
    <PortalShell title="Discovery Meetings" breadcrumb="WORKSPACE / DISCOVERY">
      <DiscoveryMeetingsContent />
    </PortalShell>
  )
}

function DiscoveryMeetingsContent() {
  const { role, profile } = usePortal()
  const router = useRouter()
  const [meetings, setMeetings] = useState<DiscoveryMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const canCreate =
    role === 'senior_dev_pm' ||
    role === 'administrator' ||
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator'

  const canApprove =
    role === 'senior_dev_pm' ||
    role === 'administrator' ||
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator'

  const [showStartForm, setShowStartForm] = useState(false)
  const [startMeetingDate, setStartMeetingDate] = useState('')
  const [startClientName, setStartClientName] = useState('')
  const [startPrimaryContact, setStartPrimaryContact] = useState('')
  const [starting, setStarting] = useState(false)

  const handleStartSession = async () => {
    if (!startMeetingDate || !startClientName || !startPrimaryContact) {
      setStatusMessage({ type: 'error', text: 'Meeting date, client name, and primary contact are required.' })
      return
    }

    setStarting(true)
    setStatusMessage(null)

    try {
      const res = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_date: startMeetingDate,
          client_name: startClientName,
          primary_contact: startPrimaryContact,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to start discovery session.' })
        setStarting(false)
        return
      }

      setStatusMessage({ type: 'success', text: 'Discovery session started successfully.' })
      setShowStartForm(false)
      setStarting(false)
      setStartMeetingDate('')
      setStartClientName('')
      setStartPrimaryContact('')
      router.push(`/discovery-meetings/${result.data.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setStarting(false)
    }
  }

  const loadMeetings = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('discovery_meetings')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        setStatusMessage({ type: 'error', text: 'Could not load discovery meetings: ' + error.message })
      } else {
        setMeetings((data ?? []) as DiscoveryMeeting[])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      await loadMeetings()
    }

    if (mounted) {
      init()
    }

    return () => {
      mounted = false
    }
  }, [loadMeetings])

  const isClientCreated = (m: DiscoveryMeeting) => m.status === 'approved' && !!m.client_id

  const handleApprove = async (id: string) => {
    if (!window.confirm('Approve this discovery meeting? This will automatically create a client record.')) return

    try {
      const res = await fetch(`/api/discovery-meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to approve meeting.' })
        return
      }

      setStatusMessage({
        type: 'success',
        text: result.message || 'Discovery meeting approved. Client created automatically.',
      })
      await loadMeetings()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
  }

  const handleReject = async (id: string) => {
    if (!window.confirm('Reject this discovery meeting? No client will be created.')) return

    try {
      const res = await fetch(`/api/discovery-meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to reject meeting.' })
        return
      }

      setStatusMessage({ type: 'success', text: result.message || 'Discovery meeting rejected.' })
      await loadMeetings()
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
      <div className="portal-card-header">
        <div>
          <h3>Discovery Meetings ({meetings.length})</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Controlled client onboarding: Discovery Meeting → AI Document → Review → Approval → Client Creation.
          </p>
        </div>
        {canCreate && (
          <>
            <Link href="/discovery-meetings/new" className="portal-btn-primary">
              <span>+</span> New Discovery Meeting
            </Link>
            <button
              type="button"
              onClick={() => setShowStartForm(true)}
              className="portal-btn-secondary"
              disabled={starting}
            >
              {starting ? 'Starting...' : 'Start Discovery Session'}
            </button>
          </>
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

      {showStartForm && canCreate && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <h3>Start Discovery Session</h3>
            <button
              type="button"
              className="portal-back-btn"
              onClick={() => setShowStartForm(false)}
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleStartSession() }} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="start-meeting-date">
                  Meeting Date <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="start-meeting-date"
                  type="date"
                  className="form-input"
                  value={startMeetingDate}
                  onChange={(e) => setStartMeetingDate(e.target.value)}
                  disabled={starting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="start-client-name">
                  Client / Company Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="start-client-name"
                  className="form-input"
                  placeholder="e.g. Acme Corporation"
                  value={startClientName}
                  onChange={(e) => setStartClientName(e.target.value)}
                  disabled={starting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="start-primary-contact">
                  Primary Contact Person <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="start-primary-contact"
                  className="form-input"
                  placeholder="e.g. Sarah Jenkins"
                  value={startPrimaryContact}
                  onChange={(e) => setStartPrimaryContact(e.target.value)}
                  disabled={starting}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setShowStartForm(false)}
                disabled={starting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
                disabled={starting}
              >
                {starting ? 'Starting...' : 'Start Discovery Session'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="portal-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon home-tone">📋</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Total Meetings</span>
            <span className="portal-stat-value">{meetings.length}</span>
          </div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-icon projects-tone">⏳</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Pending Review</span>
            <span className="portal-stat-value">{meetings.filter((m) => m.status === 'pending_review').length}</span>
          </div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-icon clients-tone">✓</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Approved Clients</span>
            <span className="portal-stat-value">{meetings.filter(isClientCreated).length}</span>
          </div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-icon home-tone">✗</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Rejected</span>
            <span className="portal-stat-value">{meetings.filter((m) => m.status === 'rejected').length}</span>
          </div>
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="portal-empty-state">
          <div className="portal-empty-icon">📋</div>
          <p className="portal-empty-title">No discovery meetings yet</p>
          <p className="portal-empty-desc">
            Start the preferred client onboarding process by creating a new discovery meeting.
          </p>
          {canCreate && (
            <Link href="/discovery-meetings/new" className="portal-btn-primary">
              <span>+</span> Create First Discovery Meeting
            </Link>
          )}
        </div>
      ) : (
        <div className="portal-table-container">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Primary Contact</th>
                <th>Email</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Client Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.client_name}</strong>
                  </td>
                  <td>{m.primary_contact}</td>
                  <td>{m.contact_email || '—'}</td>
                  <td>{m.industry || '—'}</td>
                  <td>
                    <span className={`portal-badge ${STATUS_BADGE_CLASS[m.status]}`}>
                      {STATUS_LABEL[m.status] || m.status}
                    </span>
                  </td>
                  <td>
                    {isClientCreated(m) ? (
                      <span className="portal-badge badge-green">✓ Client</span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.status === 'approved' ? 'Pending' : '—'}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link
                        href={`/discovery-meetings/${m.id}`}
                        className="portal-btn-secondary"
                        style={{ height: 30, padding: '0 10px', fontSize: 12 }}
                      >
                        View
                      </Link>
                      {m.status === 'pending_review' && canApprove && (
                        <button
                          type="button"
                          onClick={() => handleApprove(m.id)}
                          disabled={false}
                          className="portal-btn-primary"
                          style={{ height: 30, padding: '0 10px', fontSize: 12 }}
                        >
                          Approve
                        </button>
                      )}
                      {m.status === 'pending_review' && canApprove && (
                        <button
                          type="button"
                          onClick={() => handleReject(m.id)}
                          className="portal-danger-btn"
                          style={{ height: 30, padding: '0 10px', fontSize: 12 }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
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
