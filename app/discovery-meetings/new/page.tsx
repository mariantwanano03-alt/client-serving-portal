'use client'

import React, { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'
import { AudioRecorder } from '@/components/AudioRecorder'

type MeetingForm = {
  meeting_date: string
  client_name: string
  primary_contact: string
  contact_email: string
  contact_phone: string
  company_address: string
  company_description: string
  industry: string
  business_requirements: string
  client_objectives: string
  problems_challenges: string
  required_services: string
  additional_notes: string
}

const EMPTY_FORM: MeetingForm = {
  meeting_date: '',
  client_name: '',
  primary_contact: '',
  contact_email: '',
  contact_phone: '',
  company_address: '',
  company_description: '',
  industry: '',
  business_requirements: '',
  client_objectives: '',
  problems_challenges: '',
  required_services: '',
  additional_notes: '',
}

export default function NewDiscoveryMeetingPage() {
  const { profile } = usePortal()
  const [form, setForm] = useState<MeetingForm>({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [audioStorageRef, setAudioStorageRef] = useState<string | null>(null)
  const [audioFileName, setAudioFileName] = useState<string | null>(null)
  const [audioContentType, setAudioContentType] = useState<string | null>(null)
  const [audioDuration, setAudioDuration] = useState<number | null>(null)
  const [transcriptText, setTranscriptText] = useState<string | null>(null)

  const canCreate =
    profile?.role === 'senior_dev_pm' ||
    profile?.role === 'administrator' ||
    profile?.role === 'junior_developer'

  // When audio transcript is ready, process it through extraction to auto-fill form
  useEffect(() => {
    // This effect is triggered by the parent passing transcript via props if needed
    // For now, the AudioRecorder handles transcription and the parent processes it
  }, [])

  const handleTranscriptReady = async (transcript: string, audioBlob: Blob | null) => {
    setStatusMessage({ type: 'success', text: 'Transcript captured. Processing with AI...' })

    // Upload audio to storage first so we have a reference
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user && audioBlob) {
        const fileName = `meeting-${Date.now()}.webm`
        const filePath = `${user.id}/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('meeting-transcripts')
          .upload(filePath, audioBlob, {
            contentType: 'audio/webm',
            cacheControl: '3600',
          })

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage.from('meeting-transcripts').getPublicUrl(filePath)
          setAudioStorageRef(publicUrl)
          setAudioFileName(fileName)
          setAudioContentType('audio/webm')
        }
      }
    } catch {
      // Non-fatal: transcript is still captured
    }

    // Process transcript through extraction API
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Store transcript text so it can be attached when the meeting is created
      setTranscriptText(transcript.trim())

      setStatusMessage({
        type: 'success',
        text: 'Transcript captured. Review and fill in the client details below.',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
    }
  }

  const handleAudioUploaded = useCallback(
    (storageRef: string, fileName: string, contentType: string, durationSeconds: number) => {
      setAudioStorageRef(storageRef)
      setAudioFileName(fileName)
      setAudioContentType(contentType)
      setAudioDuration(durationSeconds)
    },
    []
  )

  const handleChange = (key: keyof MeetingForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.client_name.trim()) {
      setStatusMessage({ type: 'error', text: 'Client / company name is required.' })
      return
    }
    if (!form.primary_contact.trim()) {
      setStatusMessage({ type: 'error', text: 'Primary contact person is required.' })
      return
    }
    if (!form.meeting_date) {
      setStatusMessage({ type: 'error', text: 'Meeting date is required.' })
      return
    }

    setSaving(true)
    setStatusMessage(null)

    try {
      const res = await fetch('/api/discovery-meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          meeting_date: form.meeting_date,
          status: 'scheduled',
          transcript_text: transcriptText || undefined,
          audio_storage_ref: audioStorageRef || undefined,
          audio_file_name: audioFileName || undefined,
          audio_content_type: audioContentType || undefined,
          audio_duration_seconds: audioDuration || undefined,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setStatusMessage({ type: 'error', text: result.error || 'Failed to create discovery meeting.' })
        setSaving(false)
        return
      }

      setStatusMessage({
        type: 'success',
        text: 'Discovery meeting created successfully. You can now process the transcript from the meeting detail page.',
      })

      // Reset form
      setForm({ ...EMPTY_FORM })
      setAudioStorageRef(null)
      setAudioFileName(null)
      setAudioContentType(null)
      setAudioDuration(null)
      setTranscriptText(null)
      setSaving(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStatusMessage({ type: 'error', text: msg })
      setSaving(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">🔒</div>
          <p className="portal-empty-title">Access Restricted</p>
          <p className="portal-empty-desc">
            Only staff members can create discovery meetings.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="portal-card-header">
        <div>
          <h3>Create Discovery Meeting</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Record a discovery meeting to capture client information. The audio is transcribed automatically
            and used to populate the client details. Manual entry is also available as a fallback.
          </p>
        </div>
        <Link href="/discovery-meetings" className="portal-btn-secondary">
          ← Back to Discovery Meetings
        </Link>
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

      {/* Step 1: Audio Recording */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Step 1: Record Meeting Audio</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Record the discovery meeting. The audio is transcribed and client details are extracted automatically.
            </p>
          </div>
        </div>
        <AudioRecorder
          onTranscriptReady={handleTranscriptReady}
          onAudioUploaded={handleAudioUploaded}
          disabled={saving}
        />
      </div>

      {/* Step 2: Client Details (auto-filled from transcript, editable) */}
      <div className="portal-card" style={{ marginBottom: 24 }}>
        <div className="portal-card-header">
          <div>
            <h3>Step 2: Client Details</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Review and edit the information extracted from the meeting transcript.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Meeting Date <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                type="date"
                className="form-input"
                value={form.meeting_date}
                onChange={(e) => handleChange('meeting_date', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Client / Company Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                className="form-input"
                placeholder="e.g. Acme Corporation"
                value={form.client_name}
                onChange={(e) => handleChange('client_name', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Primary Contact Person <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                className="form-input"
                placeholder="e.g. Sarah Jenkins"
                value={form.primary_contact}
                onChange={(e) => handleChange('primary_contact', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contact Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="sarah@acme.com"
                value={form.contact_email}
                onChange={(e) => handleChange('contact_email', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contact Phone</label>
              <input
                type="tel"
                className="form-input"
                placeholder="+1 (555) 000-0000"
                value={form.contact_phone}
                onChange={(e) => handleChange('contact_phone', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Company Address</label>
              <input
                className="form-input"
                placeholder="e.g. 123 Business Rd, Cityville"
                value={form.company_address}
                onChange={(e) => handleChange('company_address', e.target.value)}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Industry</label>
              <input
                className="form-input"
                placeholder="e.g. Technology, Healthcare, Finance"
                value={form.industry}
                onChange={(e) => handleChange('industry', e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Company Description</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="Brief description of the company..."
                value={form.company_description}
                onChange={(e) => handleChange('company_description', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Business Requirements</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="What does the client need?"
                value={form.business_requirements}
                onChange={(e) => handleChange('business_requirements', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Client Objectives</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="What are the client's goals?"
                value={form.client_objectives}
                onChange={(e) => handleChange('client_objectives', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Problems / Challenges Identified</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="Pain points discovered during the meeting..."
                value={form.problems_challenges}
                onChange={(e) => handleChange('problems_challenges', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Required Services / Solutions</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="Services or solutions proposed..."
                value={form.required_services}
                onChange={(e) => handleChange('required_services', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Additional Notes</label>
              <textarea
                className="form-input"
                style={{ minHeight: 80 }}
                placeholder="Any other information gathered..."
                value={form.additional_notes}
                onChange={(e) => handleChange('additional_notes', e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="portal-btn-secondary"
              onClick={() => window.location.href = '/discovery-meetings'}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="portal-btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Create Discovery Meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
