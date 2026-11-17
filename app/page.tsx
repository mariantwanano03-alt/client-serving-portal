'use client'

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const { profile } = usePortal()
  const userName = profile?.full_name?.trim() || 'User'

  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)

  const resetForm = useCallback(() => {
    setTitle('')
    setNotes('')
    setAudioFile(null)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setMessage({ type: 'error', text: 'Project title is required.' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      // Optional audio upload (best-effort, non-fatal)
      let audioStorageRef: string | null = null
      if (audioFile) {
        try {
          const fileName = `meeting-${Date.now()}.${audioFile.name.split('.').pop() || 'webm'}`
          const filePath = `home-uploads/${fileName}`
          const { error: uploadError } = await supabase.storage
            .from('meeting-transcripts')
            .upload(filePath, audioFile, {
              contentType: audioFile.type || 'audio/webm',
              cacheControl: '3600',
            })
          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('meeting-transcripts')
              .getPublicUrl(filePath)
            audioStorageRef = publicUrl
          }
        } catch {
          // Non-fatal: continue without audio ref
        }
      }

      // Step 1: Create discovery session
      const meetingDate = new Date().toISOString().split('T')[0]
      const startRes = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_date: meetingDate,
          client_name: title.trim(),
          primary_contact: userName,
          additional_notes: notes.trim() || null,
          audio_storage_ref: audioStorageRef || null,
        }),
      })

      const startResult = await startRes.json()
      if (!startRes.ok || !startResult?.data?.id) {
        setMessage({ type: 'error', text: startResult?.error || 'Failed to create discovery session.' })
        setLoading(false)
        return
      }

      const sessionId = startResult.data.id

      // Step 2: Immediately approve → creates client + project + documents
      const approveRes = await fetch('/api/discovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      })

      const approveResult = await approveRes.json()
      if (!approveRes.ok || !approveResult?.project?.id) {
        const errText = approveResult?.error || 'Failed to create project.'
        setMessage({ type: 'error', text: `Failed to create project: ${errText}` })
        setLoading(false)
        return
      }

      // Reset form fields before redirecting
      resetForm()
      setMessage({ type: 'success', text: 'Project created!' })
      setLoading(false)

      // Redirect to the new project workspace
      router.push(`/projects/${approveResult.project.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.'
      setMessage({ type: 'error', text: `Failed to create project: ${msg}` })
      setLoading(false)
    }
  }

  return (
    <PortalShell title="Home" breadcrumb="WORKSPACE / HOME">
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px', textAlign: 'center' }}>
        {!showForm ? (
          <>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: '#14213d', margin: '0 0 16px' }}>
              Client Serving Portal
            </h1>
            <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 32px', lineHeight: '1.6' }}>
              Create your first project from a discovery meeting. The client record and project
              workspace are generated immediately — no approval step required.
            </p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="portal-btn-primary"
              style={{ height: 52, padding: '0 32px', fontSize: 16, fontWeight: 700 }}
              disabled={loading}
            >
              {loading ? 'Creating project...' : '+ Add New Project'}
            </button>
            {message && (
              <div
                style={{ marginTop: 16, padding: 12, borderRadius: 8, background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: 13 }}
              >
                {message.text}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="portal-back-btn"
              style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>←</span> Back
            </button>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#14213d', margin: '0 0 8px' }}>New Project</h2>
            <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 13 }}>
              Enter the project title and any notes from your discovery conversation.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
              <div className="form-group">
                <label className="form-label">Project Title <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. Acme Customer Portal"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Transcript / Notes</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: 120 }}
                  placeholder="Key points from the discovery conversation..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Audio Upload <span style={{ color: '#94a3b8' }}>(Optional)</span></label>
                <input
                  type="file"
                  className="form-input"
                  accept="audio/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setAudioFile(file)
                  }}
                  disabled={loading}
                />
                {audioFile && (
                  <p style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                    {audioFile.name} ({Math.round(audioFile.size / 1024)} KB) — will be uploaded with the session.
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="portal-btn-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Creating project...' : 'Create Project'}
                </button>
              </div>
            </form>
            {message && (
              <div
                style={{ marginTop: 16, padding: 12, borderRadius: 8, background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: 13 }}
              >
                {message.text}
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  )
}
