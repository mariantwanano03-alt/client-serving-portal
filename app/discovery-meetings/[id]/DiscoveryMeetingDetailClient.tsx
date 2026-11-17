'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
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
  discovery_document_content: string | null
  transcript_text: string | null
  transcript_file_name: string | null
  transcript_content_type: string | null
  transcript_storage_ref: string | null
  transcript_processed: boolean
  extracted_data: Record<string, unknown> | null
  extraction_status: string
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

const EXTRACTION_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner component — rendered INSIDE PortalShell so usePortal() gets the context
// ─────────────────────────────────────────────────────────────────────────────
function DiscoveryMeetingDetailInner({ id }: { id: string }) {
  const { profile } = usePortal()
  const [meeting, setMeeting] = useState<DiscoveryMeeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showTranscriptForm, setShowTranscriptForm] = useState(false)
  const [transcriptText, setTranscriptText] = useState('')
  const [showExtractedReview, setShowExtractedReview] = useState(false)
  const [editedExtracted, setEditedExtracted] = useState<Record<string, unknown>>({})

  const canApprove =
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator'
  const canEdit =
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator' ||
    profile?.role === 'junior_developer'

  const isClientCreated = !!meeting?.client_id && meeting?.status === 'approved'
  const isPendingReview = meeting?.status === 'pending_review'
  const isTranscriptProcessed = meeting?.transcript_processed === true
  const hasExtractedData = !!meeting?.extracted_data && Object.keys(meeting.extracted_data).length > 0

  const loadMeeting = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('discovery_meetings')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        setStatusMessage({ type: 'error', text: 'Could not load discovery meeting: ' + error.message })
        return
      }
      setMeeting(data as DiscoveryMeeting)
      if (data.extracted_data) {
        setEditedExtracted({ ...data.extracted_data })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    let ignore = false

    async function init() {
      if (!id) return
      await loadMeeting()
    }

    init()

    return () => {
      ignore = true
    }
  }, [id, loadMeeting])

  // ── Transcript capture ──
  async function handleSaveTranscript() {
    if (!transcriptText.trim()) {
      setStatusMessage({ type: 'error', text: 'Transcript text is required.' })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/discovery-meetings/${id}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript_text: transcriptText.trim(),
          transcript_file_name: 'meeting-transcript.txt',
          transcript_content_type: 'text/plain',
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to save transcript.' })
        setSubmitting(false)
        return
      }

      setStatusMessage({ type: 'success', text: 'Transcript saved successfully.' })
      setShowTranscriptForm(false)
      setTranscriptText('')
      await loadMeeting()
      setSubmitting(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSubmitting(false)
    }
  }

  // ── AI transcript processing ──
  async function handleProcessTranscript() {
    if (!meeting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/discovery-meetings/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to process transcript.' })
        setSubmitting(false)
        return
      }

      setStatusMessage({ type: 'success', text: 'Transcript processed. Review extracted information below.' })
      setShowExtractedReview(true)
      await loadMeeting()
      setSubmitting(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSubmitting(false)
    }
  }

  // ── Approve meeting → auto client creation + document generation ──
  async function handleApprove() {
    if (!meeting) return
    if (
      !window.confirm(
        'Approve this discovery meeting? This will automatically create a client record and generate PRD, SRS, and Developer Handover documents.'
      )
    )
      return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/discovery-meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to approve meeting.' })
        setSubmitting(false)
        return
      }

      setStatusMessage({
        type: 'success',
        text: result.message || 'Discovery meeting approved. Client created. Documents being generated.',
      })
      await loadMeeting()
      setSubmitting(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!meeting) return
    if (!window.confirm('Reject this discovery meeting? No client will be created.')) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/discovery-meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to reject meeting.' })
        setSubmitting(false)
        return
      }

      setStatusMessage({ type: 'success', text: result.message || 'Discovery meeting rejected.' })
      await loadMeeting()
      setSubmitting(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSubmitting(false)
    }
  }

  function buildDiscoveryDocumentContent(m: DiscoveryMeeting): string {
    const lines: string[] = []
    lines.push('DISCOVERY DOCUMENT')
    lines.push('==================')
    lines.push('')
    lines.push(`Client / Company: ${m.client_name}`)
    lines.push(`Primary Contact: ${m.primary_contact}`)
    if (m.contact_email) lines.push(`Contact Email: ${m.contact_email}`)
    if (m.contact_phone) lines.push(`Contact Phone: ${m.contact_phone}`)
    if (m.company_address) lines.push(`Company Address: ${m.company_address}`)
    if (m.industry) lines.push(`Industry: ${m.industry}`)
    lines.push('')
    lines.push('Company Description:')
    lines.push(m.company_description || '—')
    lines.push('')
    lines.push('Business Requirements:')
    lines.push(m.business_requirements || '—')
    lines.push('')
    lines.push('Client Objectives:')
    lines.push(m.client_objectives || '—')
    lines.push('')
    lines.push('Problems / Challenges Identified:')
    lines.push(m.problems_challenges || '—')
    lines.push('')
    lines.push('Required Services / Solutions:')
    lines.push(m.required_services || '—')
    lines.push('')
    lines.push('Additional Notes:')
    lines.push(m.additional_notes || '—')
    lines.push('')
    lines.push(`Meeting Date: ${m.meeting_date || '—'}`)
    lines.push(`Status: ${STATUS_LABEL[m.status] || m.status}`)
    lines.push('')
    lines.push('--- End of Discovery Document ---')
    return lines.join('\n')
  }

  if (loading) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⏳</div>
          <p className="portal-empty-title">Loading discovery meeting...</p>
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">⚠️</div>
          <p className="portal-empty-title">Discovery meeting not found</p>
          <Link href="/discovery-meetings" className="portal-btn-primary">
            Return to Discovery Meetings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <button
        type="button"
        className="portal-back-btn"
        onClick={() => window.location.href = '/discovery-meetings'}
      >
        <span>←</span> Back to Discovery Meetings
      </button>

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

      {/* Meeting Header */}
      <div className="portal-detail-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span className="code-badge" style={{ marginBottom: 8 }}>
              {meeting.id.slice(0, 8).toUpperCase()}…
            </span>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#14213d', margin: '4px 0 0' }}>
              {meeting.client_name}
            </h2>
            <span
              className={`portal-badge ${STATUS_BADGE_CLASS[meeting.status]}`}
              style={{ marginTop: 8 }}
            >
              {STATUS_LABEL[meeting.status] || meeting.status}
            </span>
            {isClientCreated && (
              <span className="portal-badge badge-green" style={{ marginTop: 6, marginLeft: 8 }}>
                ✓ Client Created
              </span>
            )}
            {isTranscriptProcessed && (
              <span className="portal-badge badge-blue" style={{ marginTop: 6, marginLeft: 8 }}>
                📝 Transcript Processed
              </span>
            )}
          </div>
          <div className="portal-detail-meta-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))' }}>
            <div className="portal-meta-item">
              <label>Meeting Date</label>
              <span>{meeting.meeting_date || '—'}</span>
            </div>
            <div className="portal-meta-item">
              <label>Primary Contact</label>
              <span>{meeting.primary_contact}</span>
            </div>
            <div className="portal-meta-item">
              <label>Contact Email</label>
              <span>{meeting.contact_email || '—'}</span>
            </div>
            <div className="portal-meta-item">
              <label>Contact Phone</label>
              <span>{meeting.contact_phone || '—'}</span>
            </div>
            <div className="portal-meta-item">
              <label>Company Address</label>
              <span>{meeting.company_address || '—'}</span>
            </div>
            <div className="portal-meta-item">
              <label>Industry</label>
              <span>{meeting.industry || '—'}</span>
            </div>
            <div className="portal-meta-item">
              <label>Transcript Status</label>
              <span>
                {meeting.transcript_text ? '✓ Captured' : '○ Not Captured'}
              </span>
            </div>
            <div className="portal-meta-item">
              <label>Extraction</label>
              <span>
                {EXTRACTION_STATUS_LABEL[meeting.extraction_status] || meeting.extraction_status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step 1: Transcript Capture ── */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Step 1: Meeting Transcript</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Capture or paste the meeting transcript. This is processed to extract client information.
            </p>
          </div>
          {!meeting.transcript_text && canEdit && (
            <button
              type="button"
              onClick={() => setShowTranscriptForm(true)}
              className="portal-btn-primary"
              style={{ height: 34, fontSize: 12 }}
            >
              <span>+</span> Add Transcript
            </button>
          )}
          {meeting.transcript_text && (
            <span className="portal-badge badge-green">✓ Transcript Captured</span>
          )}
        </div>

        {showTranscriptForm && canEdit && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 18 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#1e293b' }}>Enter Meeting Transcript</h4>
            <textarea
              className="form-input"
              style={{ minHeight: 150, width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder="Paste the meeting transcript here..."
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setShowTranscriptForm(false)}
                className="portal-btn-secondary"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTranscript}
                className="portal-btn-primary"
                disabled={submitting || !transcriptText.trim()}
              >
                {submitting ? 'Saving...' : 'Save Transcript'}
              </button>
            </div>
          </div>
        )}

        {meeting.transcript_text && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Transcript Preview</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {meeting.transcript_text.length} characters
              </span>
            </div>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: 14,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                color: '#1e293b',
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {meeting.transcript_text}
            </div>
            {!isTranscriptProcessed && canEdit && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={handleProcessTranscript}
                  disabled={submitting}
                  className="portal-btn-primary"
                  style={{ height: 36, fontSize: 13 }}
                >
                  {submitting ? 'Processing...' : '🤖 Process Transcript with AI'}
                </button>
              </div>
            )}
            {isTranscriptProcessed && !hasExtractedData && (
              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>
                No extractable information found. Please review transcript manually.
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Extracted Information Review ── */}
      {hasExtractedData && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <div>
              <h3>Step 2: Review Extracted Client Information</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Review and correct information extracted from the transcript before approval.
              </p>
            </div>
            {canEdit && !showExtractedReview && (
              <button
                type="button"
                onClick={() => setShowExtractedReview(true)}
                className="portal-btn-primary"
                style={{ height: 34, fontSize: 12 }}
              >
                <span>✎</span> Edit Extracted Information
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(250px, 1fr))', gap: 16 }}>
            {Object.entries(meeting.extracted_data as Record<string, string>).map(([key, value]) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  {key.replace(/_/g, ' ')}
                </label>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                  {value || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 3: Discovery Document ── */}
      {meeting.discovery_document_content && (
        <div className="portal-card" style={{ marginBottom: 24 }}>
          <div className="portal-card-header">
            <div>
              <h3>Step 3: AI-Generated Discovery Document</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Document generated from discovery meeting data. Ready for review.
              </p>
            </div>
          </div>
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 20,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
              color: '#1e293b',
            }}
          >
            {meeting.discovery_document_content}
          </div>
        </div>
      )}

      {/* ── Step 4: Approval ── */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Step 4: Approve or Reject</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Only an approved discovery meeting triggers automatic client creation and document generation.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!isClientCreated && isPendingReview && canApprove && (
            <>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="portal-btn-primary"
                style={{ height: 44, padding: '0 28px', fontSize: 14 }}
              >
                {submitting ? 'Approving...' : '✓ Approve & Create Client'}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting}
                className="portal-danger-btn"
                style={{ height: 44, padding: '0 28px', fontSize: 14 }}
              >
                ✗ Reject
              </button>
            </>
          )}
          {isClientCreated && (
            <span className="portal-badge badge-green" style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 28px' }}>
              ✓ Client Already Created
            </span>
          )}
          {!isPendingReview && !isClientCreated && canEdit && (
            <button
              type="button"
              onClick={() => {
                const docContent = buildDiscoveryDocumentContent(meeting)
                // Update document content and status
                setSubmitting(true)
                fetch(`/api/discovery-meetings/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    status: 'pending_review',
                    discovery_document_content: docContent,
                  }),
                })
                  .then(async (res) => {
                    const result = await res.json()
                    if (!res.ok) {
                      setStatusMessage({ type: 'error', text: result.error || 'Failed to generate document.' })
                    } else {
                      setStatusMessage({ type: 'success', text: 'Discovery document generated. Meeting moved to Pending Review.' })
                    }
                    await loadMeeting()
                    setSubmitting(false)
                  })
                  .catch((err) => {
                    setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' })
                    setSubmitting(false)
                  })
              }}
              disabled={submitting}
              className="portal-btn-primary"
              style={{ height: 44, padding: '0 28px', fontSize: 14 }}
            >
              {submitting ? 'Generating...' : '🤖 Generate Discovery Document'}
            </button>
          )}
          <Link href="/clients" className="portal-btn-secondary" style={{ height: 44, padding: '0 28px', fontSize: 14 }}>
            View All Clients
          </Link>
        </div>
      </div>

      {isClientCreated && meeting.client_id && (
        <div className="portal-card">
          <div className="portal-card-header">
            <div>
              <h3>Linked Client & Project</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                This discovery meeting resulted in automatic client creation. The project is now associated with the client.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href={`/clients/${meeting.client_id}`} className="portal-btn-primary" style={{ height: 40, padding: '0 24px' }}>
              View Client Record →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Outer wrapper — provides PortalShell context so usePortal() works inside
// ─────────────────────────────────────────────────────────────────────────────
export default function DiscoveryMeetingDetailClient({ id }: { id: string }) {
  return (
    <PortalShell title="Discovery Meeting Details" breadcrumb="WORKSPACE / DISCOVERY / DETAILS">
      <DiscoveryMeetingDetailInner id={id} />
    </PortalShell>
  )
}
