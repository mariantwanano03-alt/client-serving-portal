'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'
import AudioRecorder, { type RecordingMeta } from '@/components/AudioRecorder'

type Client = { id: string; client_code: string; name: string; email: string | null }

type Details = {
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

const EMPTY_DETAILS: Details = {
  client_name: '', primary_contact: '', contact_email: '', contact_phone: '',
  company_address: '', company_description: '', industry: '', business_requirements: '',
  client_objectives: '', problems_challenges: '', required_services: '', additional_notes: '',
}

const FIELD_LABELS: Record<keyof Details, string> = {
  client_name: 'Company / Client name',
  primary_contact: 'Primary contact',
  contact_email: 'Contact email',
  contact_phone: 'Contact phone',
  company_address: 'Company address',
  company_description: 'Company description',
  industry: 'Industry',
  business_requirements: 'Business requirements',
  client_objectives: 'Client objectives',
  problems_challenges: 'Problems / challenges',
  required_services: 'Required services',
  additional_notes: 'Additional notes',
}

const FIELD_ALIASES: Record<keyof Details, string[]> = {
  client_name: ['company name', 'client name', 'organization', 'organisation'],
  primary_contact: ['primary contact', 'contact person', 'main contact'],
  contact_email: ['email', 'e-mail'],
  contact_phone: ['phone', 'telephone', 'contact number'],
  company_address: ['address', 'location'],
  company_description: ['description', 'about the company', 'company overview'],
  industry: ['industry', 'sector'],
  business_requirements: ['business requirements', 'requirements', 'needs'],
  client_objectives: ['objectives', 'goals', 'aims'],
  problems_challenges: ['problems', 'challenges', 'pain points', 'issues'],
  required_services: ['required services', 'services needed', 'solutions'],
  additional_notes: ['additional notes', 'notes', 'other'],
}

// Only fills fields that are explicitly present in the transcript. Missing
// data stays blank so the reviewer can enter it — nothing is invented.
function extractFromTranscript(text: string): { details: Details; found: string[] } {
  const details = { ...EMPTY_DETAILS }
  const found: string[] = []
  const lines = text.split(/\r?\n/)
  for (const field of Object.keys(FIELD_ALIASES) as (keyof Details)[]) {
    for (const line of lines) {
      const lower = line.toLowerCase()
      const alias = FIELD_ALIASES[field].find((a) => lower.includes(a))
      if (!alias) continue
      const at = lower.indexOf(alias)
      let value = line.slice(at + alias.length).replace(/^[\s:–—-]+/, '').trim()
      const index = lines.indexOf(line)
      for (let j = index + 1; j < Math.min(index + 4, lines.length); j++) {
        const next = lines[j].trim()
        if (!next || Object.values(FIELD_ALIASES).flat().some((a) => next.toLowerCase().includes(a))) break
        value = value ? `${value} ${next}` : next
      }
      if (value) {
        details[field] = value
        found.push(field)
      }
      break
    }
  }
  return { details, found }
}

export default function CreateProjectPage() {
  const router = useRouter()
  return (
    <PortalShell title="Create Project" breadcrumb="WORKSPACE / PROJECTS / CREATE">
      <CreateProjectContent router={router} />
    </PortalShell>
  )
}

function CreateProjectContent({ router }: { router: ReturnType<typeof useRouter> }) {
  const { profile } = usePortal()
  const [clients, setClients] = useState<Client[]>([])
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [transcript, setTranscript] = useState('')
  const [audioMeta, setAudioMeta] = useState<RecordingMeta | null>(null)
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [detectedFields, setDetectedFields] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [useExisting, setUseExisting] = useState(false)
  const [selectedClient, setSelectedClient] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ projectId: string; reference: string; name: string } | null>(null)

  const canCreate = ['senior_dev_pm', 'junior_developer'].includes(profile?.role || '')

  useEffect(() => {
    let ignore = false
    supabase.from('clients').select('id, client_code, name, email').order('name').then(({ data }) => {
      if (!ignore) setClients(data ?? [])
    })
    return () => { ignore = true }
  }, [])

  const handleTranscript = useCallback((text: string, _blob: Blob | null, meta?: RecordingMeta) => {
    setTranscript(text)
    if (meta) setAudioMeta(meta)
  }, [])

  const goToReview = () => {
    if (!transcript.trim() && !useExisting) {
      setErrorMessage('Record or paste a transcript first, or choose an existing client.')
      return
    }
    const extracted = extractFromTranscript(transcript)
    setDetails(extracted.details)
    setDetectedFields(extracted.found)
    setConfirmed(false)
    setErrorMessage('')
    setStep(2)
  }

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }, [])

  const createFromTranscript = async () => {
    if (!details.client_name.trim() || !details.primary_contact.trim()) {
      setErrorMessage('Company / client name and primary contact are required.')
      return
    }
    if (!confirmed) {
      setErrorMessage('Please confirm you have reviewed the client details.')
      return
    }
    setBusy(true)
    setErrorMessage('')
    try {
      const headers = await authHeaders()
      const createRes = await fetch('/api/projects/create-from-meeting', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          details,
          transcript: transcript.trim(),
          audio: audioMeta || null,
        }),
      })
      const createResult = await createRes.json()
      if (!createRes.ok || !createResult?.project?.id) {
        throw new Error(createResult?.error || 'Could not create the project.')
      }
      setResult({
        projectId: createResult.project.id,
        reference: createResult.project.project_reference || '—',
        name: createResult.project.name || details.client_name.trim(),
      })
      setStep(3)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setBusy(false)
    }
  }

  const createForExistingClient = async () => {
    if (!selectedClient) {
      setErrorMessage('Choose an existing client first.')
      return
    }
    setBusy(true)
    setErrorMessage('')
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_id: selectedClient,
          name: `${clients.find((item) => item.id === selectedClient)?.name || 'Client'} Project`,
          description: '',
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.data?.id) throw new Error(json?.error || 'Failed to create project.')
      router.push(`/projects/${json.data.id}`)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create project.')
      setBusy(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="portal-card">
        <div className="portal-empty-state">
          <div className="portal-empty-icon">🔒</div>
          <p className="portal-empty-title">Access Restricted</p>
          <p className="portal-empty-desc">Only staff members can create projects.</p>
          <Link href="/dashboard" className="portal-btn-primary">Return to Dashboard</Link>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div style={{ maxWidth: 820 }}>
        <div className="portal-card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>🎉</div>
          <h3 style={{ fontSize: 22, color: 'var(--heading)', margin: '12px 0 6px' }}>Project created</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>
            The client record, project workspace and starter documents have been created from your meeting.
          </p>
          <div style={{ display: 'inline-block', textAlign: 'left', padding: 16, background: 'var(--surface-alt)', borderRadius: 10, marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Project reference</div>
            <div data-testid="created-project-reference" style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--heading)' }}>{result.reference}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{result.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link data-testid="open-project-link" href={`/projects/${result.projectId}`} className="portal-btn-primary">Open Project Workspace →</Link>
            <Link href={`/projects/${result.projectId}?tab=documents`} className="portal-btn-secondary">Open Documents</Link>
            <Link href={`/projects/${result.projectId}?tab=links`} className="portal-btn-secondary">Add GitHub / Supabase links</Link>
          </div>
        </div>
      </div>
    )
  }

  const cardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: 24, background: 'var(--surface)', marginBottom: 20 }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="portal-card-header">
        <div>
          <h3>Create Project</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Follow the steps: capture the meeting, review the details, then create the project.
          </p>
        </div>
        <Link href="/projects" className="portal-btn-secondary">← Back to Projects</Link>
      </div>

      <div data-testid="wizard-steps" style={{ display: 'flex', gap: 8, margin: '20px 0' }}>
        {['1 · Audio & Transcript', '2 · Review Details', '3 · Create'].map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3
          return (
            <div key={label} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: step === n ? 'var(--accent-gradient)' : 'var(--surface-alt)', color: step === n ? 'var(--accent-contrast)' : 'var(--muted)', boxShadow: step === n ? 'var(--accent-glow)' : 'none', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
              {label}
            </div>
          )
        })}
      </div>

      {errorMessage && (
        <div className="auth-alert-error" style={{ marginBottom: 18 }} role="alert">
          <span>⚠️</span><span>{errorMessage}</span>
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <>
          <AudioRecorder onTranscriptReady={handleTranscript} disabled={busy} className="ai-card" />
          <div style={cardStyle}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--heading)' }}>
              <input type="checkbox" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} />
              Use an existing client instead (skip audio)
            </label>
            {useExisting && (
              <div style={{ marginTop: 14 }}>
                <label className="form-label">Select client</label>
                <select className="form-input" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                  <option value="">— Choose a client —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.client_code})</option>)}
                </select>
              </div>
            )}
          </div>
          <button data-testid="continue-to-review" type="button" onClick={useExisting ? createForExistingClient : goToReview} disabled={busy} className="portal-btn-primary" style={{ height: 44, padding: '0 24px', fontSize: 14 }}>
            {busy ? 'Creating…' : useExisting ? 'Create Project for Client →' : 'Continue to Review →'}
          </button>
        </>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--heading)' }}>Review client details</h4>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>
            Fields detected in the transcript have been filled in. Empty fields were <strong>not</strong> guessed — please enter them yourself.
          </p>
          {detectedFields.length > 0 ? (
            <p style={{ fontSize: 12, color: 'var(--success-text)' }}>
              ✓ Detected from transcript: {detectedFields.map((f) => FIELD_LABELS[f as keyof Details]).join(', ')}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              No labelled fields were detected. Complete the details below manually.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginTop: 16 }}>
            {(Object.keys(FIELD_LABELS) as (keyof Details)[]).map((field) => (
              <div className="form-group" key={field}>
                <label className="form-label">
                  {FIELD_LABELS[field]}
                  {(field === 'client_name' || field === 'primary_contact') && <span style={{ color: 'var(--danger)' }}> *</span>}
                  {detectedFields.includes(field) && <span style={{ color: 'var(--success-text)', fontSize: 10 }}> · detected</span>}
                </label>
                <input
                  className="form-input"
                  data-testid={`detail-${field}`}
                  value={details[field]}
                  placeholder={detectedFields.includes(field) ? '' : 'Not provided — enter manually'}
                  onChange={(e) => setDetails((d) => ({ ...d, [field]: e.target.value }))}
                  disabled={busy}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Original transcript</strong>
            <pre data-testid="review-transcript" style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text)' }}>
              {transcript || 'No transcript provided.'}
            </pre>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, fontSize: 13, color: 'var(--heading)' }}>
            <input type="checkbox" data-testid="confirm-details" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have reviewed and confirm these client details are correct.
          </label>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" className="portal-btn-secondary" onClick={() => setStep(1)} disabled={busy}>← Back</button>
            <button data-testid="create-project-submit" type="button" className="portal-btn-primary" onClick={createFromTranscript} disabled={busy}>
              {busy ? 'Creating client, project & documents…' : 'Confirm & Create Project →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
