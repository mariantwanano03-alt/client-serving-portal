'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type DiscoverySession = {
  id: string
  client_id: string
  project_id: string
  meeting_title: string | null
  meeting_date: string | null
  transcript: string | null
  extraction: {
    company_name?: string | null
    email?: string | null
    phone?: string | null
    contacts?: { name: string; role?: string | null }[]
    requirements?: { title: string; priority?: string }[]
  } | null
  generation_status: 'pending' | 'extracting' | 'promoting' | 'generating' | 'complete' | 'failed'
  failure_reason: string | null
  created_at: string
}

type SummaryCounts = {
  clientName: string
  clientCode: string
  contactsCount: number
  requirementsCount: number
  documentsCount: number
}

export default function DiscoveryClient({ id }: { id: string }) {
  return (
    <PortalShell title="Discovery Meeting" breadcrumb="WORKSPACE / DISCOVERY">
      <DiscoveryInner id={id} />
    </PortalShell>
  )
}

function DiscoveryInner({ id }: { id: string }) {
  const { role } = usePortal()
  const canApprove = role === 'senior_dev_pm' || role === 'administrator'

  const [session, setSession] = useState<DiscoverySession | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [transcriptDraft, setTranscriptDraft] = useState('')
  const [savingTranscript, setSavingTranscript] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Summary counts for complete state
  const [summary, setSummary] = useState<SummaryCounts | null>(null)

  // Fallback client name confirmation
  const [confirmedClientName, setConfirmedClientName] = useState('')
  const [savingClientName, setSavingClientName] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // Audio recording state
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])

  const loadSession = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('discovery_sessions')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        setStatusMessage({ type: 'error', text: 'Could not load discovery session: ' + (error?.message || 'not found') })
        return
      }

      setSession(data as DiscoverySession)
      setTranscriptDraft(data.transcript || '')

      if (data.generation_status === 'complete') {
        // Fetch summary details
        const [clientRes, contactsRes, reqsRes, docsRes] = await Promise.all([
          supabase.from('clients').select('name, client_code').eq('id', data.client_id).single(),
          supabase.from('client_contacts').select('id', { count: 'exact', head: true }).eq('client_id', data.client_id),
          supabase.from('requirements').select('id', { count: 'exact', head: true }).eq('project_id', data.project_id),
          supabase.from('documents').select('id', { count: 'exact', head: true }).eq('project_id', data.project_id),
        ])

        setSummary({
          clientName: clientRes.data?.name || 'Active Client',
          clientCode: clientRes.data?.client_code || '',
          contactsCount: contactsRes.count || 0,
          requirementsCount: reqsRes.count || 0,
          documentsCount: docsRes.count || 0,
        })
        setConfirmedClientName(clientRes.data?.name || '')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let ignore = false

    async function init() {
      if (!ignore) {
        await loadSession()
      }
    }

    init()

    return () => {
      ignore = true
    }
  }, [loadSession])

  // Resumable Polling when in active generation states
  useEffect(() => {
    let ignore = false
    const isProcessing =
      session?.generation_status === 'extracting' ||
      session?.generation_status === 'promoting'

    if (isProcessing) {
      pollingRef.current = setInterval(() => {
        if (!ignore) {
          void loadSession()
        }
      }, 2000)
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }

    return () => {
      ignore = true
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [session?.generation_status, loadSession])

  // Save Transcript changes
  async function handleSaveTranscript() {
    if (!session) return
    setSavingTranscript(true)
    setStatusMessage(null)

    const { error } = await supabase
      .from('discovery_sessions')
      .update({ transcript: transcriptDraft.trim(), updated_at: new Date().toISOString() })
      .eq('id', session.id)

    setSavingTranscript(false)
    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not save transcript: ' + error.message })
    } else {
      setStatusMessage({ type: 'success', text: 'Transcript updated.' })
      setSession((prev) => (prev ? { ...prev, transcript: transcriptDraft.trim() } : prev))
    }
  }

  // Trigger Approval & Document Generation
  async function handleApproveAndGenerate() {
    if (!session) return
    if (!transcriptDraft.trim()) {
      setStatusMessage({ type: 'error', text: 'Please add a meeting transcript before approving.' })
      return
    }

    setApproving(true)
    setStatusMessage(null)

    try {
      // Auto-save any pending transcript draft first
      if (transcriptDraft.trim() !== (session.transcript || '').trim()) {
        await supabase
          .from('discovery_sessions')
          .update({ transcript: transcriptDraft.trim() })
          .eq('id', session.id)
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      const res = await fetch('/api/discovery/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: session.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Approval processing failed')
      }

      await loadSession()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      await loadSession()
    } finally {
      setApproving(false)
    }
  }

  // Update client name fallback
  async function handleSaveClientName() {
    if (!session || !confirmedClientName.trim()) return
    setSavingClientName(true)
    const { error } = await supabase
      .from('clients')
      .update({ name: confirmedClientName.trim() })
      .eq('id', session.client_id)

    setSavingClientName(false)
    if (error) {
      setStatusMessage({ type: 'error', text: 'Could not update client name: ' + error.message })
    } else {
      setStatusMessage({ type: 'success', text: 'Client name confirmed.' })
      await loadSession()
    }
  }

  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = handleUploadAudio
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setStatusMessage(null)
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Microphone access denied',
      })
    }
  }
  function handleStopRecording() {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }
  async function handleUploadAudio() {
    if (!session) return
    setTranscribing(true)
    setStatusMessage({ type: 'success', text: '⏳ Uploading audio and transcribing...' })
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const filePath = `discoveries/${session.id}/${Date.now()}.webm`
      const { error: uploadError } = await supabase.storage
        .from('discovery-media')
        .upload(filePath, blob, { contentType: 'audio/webm', upsert: false })
      if (uploadError) throw new Error('Upload failed: ' + uploadError.message)
      // Get a signed URL (bucket is private)
      const { data: signedData, error: signedErr } = await supabase.storage
        .from('discovery-media')
        .createSignedUrl(filePath, 300) // 5 min TTL
      if (signedErr || !signedData?.signedUrl) throw new Error('Could not get signed URL')
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ audioUrl: signedData.signedUrl, recordId: session.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Transcription failed')
      setTranscriptDraft(data.transcript || '')
      setStatusMessage({ type: 'success', text: '✓ Audio transcribed. Review and edit below, then approve.' })
      await loadSession()
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Audio processing failed',
      })
    } finally {
      setTranscribing(false)
    }
  }

  if (loading) {
    return (
      <div className="portal-card" style={{ maxWidth: 900, margin: '40px auto', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>Loading discovery session...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="portal-card" style={{ maxWidth: 900, margin: '40px auto' }}>
        <div className="portal-empty-state">
          <p className="portal-empty-title">Discovery Session Not Found</p>
          <Link href="/projects" className="portal-btn-primary">
            Back to Projects
          </Link>
        </div>
      </div>
    )
  }

  const isComplete = session.generation_status === 'complete'
  const isFailed = session.generation_status === 'failed'
  const isPending = session.generation_status === 'pending'
  const isRunning =
    session.generation_status === 'extracting' ||
    session.generation_status === 'promoting' ||
    approving

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 24 }}>
      {/* Back button & Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/projects" className="portal-back-btn">
          <span>←</span> Back to Projects
        </Link>
        <span
          className={`portal-badge ${
            isComplete ? 'badge-green' : isFailed ? 'badge-red' : isRunning ? 'badge-purple' : 'badge-amber'
          }`}
        >
          {isComplete
            ? '✓ Discovery Approved & Client Created'
            : isFailed
            ? '⚠️ Generation Failed'
            : isRunning
            ? `⏳ ${session.generation_status.toUpperCase()}...`
            : 'Pending Approval'}
        </span>
      </div>

      {statusMessage && (
        <div
          className={statusMessage.type === 'error' ? 'auth-alert-error' : 'connection-status'}
          role="alert"
        >
          <span>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Meeting Header Card */}
      <div className="portal-detail-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="code-badge" style={{ marginBottom: 8 }}>
              {session.meeting_date || 'Meeting'}
            </span>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: '4px 0 0' }}>
              {session.meeting_title || 'Discovery Session'}
            </h2>
          </div>
          {isComplete && (
            <Link
              href={`/projects/${session.project_id}`}
              className="portal-btn-primary"
              style={{ height: 38, fontSize: 13 }}
            >
              Open Project Workspace →
            </Link>
          )}
        </div>
      </div>

      {/* Complete State Summary Card */}
      {isComplete && summary && (
        <div
          className="portal-card"
          style={{
            background: '#f0fdf4',
            border: '1.5px solid #86efac',
            borderRadius: 14,
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 32 }}>🎉</span>
            <div>
              <h3 style={{ margin: 0, color: '#166534', fontSize: 18 }}>
                Discovery Approved & Promoted
              </h3>
              <p style={{ margin: '4px 0 0', color: '#15803d', fontSize: 13 }}>
                Provisional client promoted to active status. Contacts and requirements extracted from transcript. Generate PRD/SRS manually in the Documents tab.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              background: '#ffffff',
              padding: 16,
              borderRadius: 10,
              border: '1px solid #bbf7d0',
              marginBottom: 16,
            }}
          >
            <div>
              <span style={{ fontSize: 12, color: '#64748b', display: 'block' }}>Client Organization</span>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{summary.clientName}</strong>
              <small style={{ display: 'block', color: '#94a3b8' }}>{summary.clientCode}</small>
            </div>
            <div>
              <span style={{ fontSize: 12, color: '#64748b', display: 'block' }}>Extracted Contacts</span>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{summary.contactsCount} Contacts</strong>
            </div>
            <div>
              <span style={{ fontSize: 12, color: '#64748b', display: 'block' }}>Requirements Logged</span>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{summary.requirementsCount} Items</strong>
            </div>
            <div>
              <span style={{ fontSize: 12, color: '#64748b', display: 'block' }}>Documents Ready</span>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{summary.documentsCount} Documents (SRS/PRD)</strong>
            </div>
          </div>

          {/* Name Confirmation Fallback */}
          {(!session.extraction?.company_name || summary.clientName.startsWith('Unnamed')) && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="form-input"
                style={{ maxWidth: 320 }}
                placeholder="Confirm client company name"
                value={confirmedClientName}
                onChange={(e) => setConfirmedClientName(e.target.value)}
              />
              <button
                type="button"
                className="portal-btn-primary"
                onClick={handleSaveClientName}
                disabled={savingClientName}
              >
                {savingClientName ? 'Saving...' : 'Confirm Client Name'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Link href={`/projects/${session.project_id}`} className="portal-btn-primary">
              View Project Workspace →
            </Link>
          </div>
        </div>
      )}

      {/* Failure State Card */}
      {isFailed && (
        <div
          className="portal-card"
          style={{
            background: '#fef2f2',
            border: '1.5px solid #fca5a5',
            borderRadius: 14,
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div>
              <h3 style={{ margin: 0, color: '#991b1b', fontSize: 16 }}>Generation Failed</h3>
              <p style={{ margin: '4px 0 0', color: '#b91c1c', fontSize: 13 }}>
                {session.failure_reason || 'An error occurred during extraction or document generation.'}
              </p>
            </div>
          </div>
          {canApprove && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                type="button"
                className="portal-btn-primary"
                onClick={handleApproveAndGenerate}
                disabled={approving}
              >
                {approving ? 'Retrying...' : '↻ Retry Generation'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Processing Step Card */}
      {isRunning && (
        <div
          className="portal-card"
          style={{
            background: '#faf5ff',
            border: '1.5px solid #d8b4fe',
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <h3 style={{ margin: '0 0 6px', color: '#6b21a8' }}>
            {session.generation_status === 'extracting' && 'Extracting Client & Scope Deliverables...'}
            {session.generation_status === 'promoting' && 'Promoting Client & Adding Stakeholders...'}
            {(!session.generation_status || session.generation_status === 'pending') && 'Initializing...'}
          </h3>
          <p style={{ margin: 0, color: '#9333ea', fontSize: 13 }}>
            Please wait while the client profile is created from the transcript.
          </p>
        </div>
      )}

      {/* Transcript Card & Approval Action */}
      <div className="portal-card">
        <div className="portal-card-header">
          <div>
            <h3>Meeting Transcript</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Paste or review the client briefing discussion. AI extracts client details and scope automatically.
            </p>
          </div>
          {!isComplete && !isRunning && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {recording ? (
                <button
                  type="button"
                  className="portal-btn-primary"
                  style={{ height: 32, fontSize: 12, background: '#ef4444', borderColor: '#ef4444' }}
                  onClick={handleStopRecording}
                >
                  ⏹ Stop Recording
                </button>
              ) : (
                <button
                  type="button"
                  className="portal-btn-secondary"
                  style={{ height: 32, fontSize: 12 }}
                  onClick={handleStartRecording}
                  disabled={transcribing}
                >
                  {transcribing ? '⏳ Transcribing...' : '🎙 Record Meeting'}
                </button>
              )}
              <button
                type="button"
                className="portal-btn-secondary"
                style={{ height: 32, fontSize: 12 }}
                onClick={handleSaveTranscript}
                disabled={savingTranscript || recording || transcribing}
              >
                {savingTranscript ? 'Saving...' : 'Save Draft'}
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <textarea
            className="form-input"
            style={{ minHeight: 280, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
            placeholder="Paste your meeting notes or call transcript here..."
            value={transcriptDraft}
            onChange={(e) => setTranscriptDraft(e.target.value)}
            disabled={isComplete || isRunning}
          />
        </div>

        {/* Primary Approval Button */}
        {isPending && canApprove && (
          <div
            style={{
              marginTop: 20,
              paddingTop: 18,
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              Approving promotes the client, writes contacts & requirements from the transcript.
            </p>
            <button
              type="button"
              className="portal-btn-primary"
              style={{ height: 42, padding: '0 20px', fontSize: 14, fontWeight: 600 }}
              onClick={handleApproveAndGenerate}
              disabled={approving || !transcriptDraft.trim()}
            >
              {approving ? 'Processing...' : 'Approve Transcript & Create Client →'}
            </button>
          </div>
        )}

        {isPending && !canApprove && (
          <p style={{ margin: '16px 0 0', fontSize: 12, color: '#94a3b8' }}>
            ℹ️ Awaiting review by a Senior Developer / PM or Administrator to approve and generate deliverables.
          </p>
        )}
      </div>
    </div>
  )
}
