'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { usePortal } from '@/components/PortalShell'
import {
  GENERATION_CONFIG,
  GENERATION_TYPES,
  defaultGenerationFields,
  normalizeGenerationType,
  validateGenerationFields,
  type GenerationField,
  type GenerationFields,
  type GenerationType,
  type LineItem,
  type Milestone,
} from '@/lib/document-generation'

type DocumentRecord = {
  id: string
  title: string
  type: string | null
  status: string
  created_at?: string | null
}

type DocumentDetail = DocumentRecord & {
  project_id: string
  current_revision_id: string | null
  content: string
  revision_no: number | null
  revision_status: string | null
  source: string | null
  uploaded_file_name: string | null
  uploaded_mime_type: string | null
  created_by_name: string
  last_edited_by_name: string
  last_edited_at: string | null
  approved_by_name: string | null
  approved_at: string | null
  rejection_reason: string | null
  review_decision: string | null
  review_comment: string | null
  reviewed_at: string | null
  project: { name: string; project_reference: string; client_id: string | null; clients?: { name: string } | null } | null
}

type DocumentsTabProps = {
  projectId: string
  readOnly?: boolean
}

const UPLOAD_TYPES = [
  'Requirements', 'Quotation', 'Proposal', 'Timeline', 'SLA',
  'Purchase Order', 'Invoice', 'PRD', 'SRS', 'Handover', 'Other',
]

function asLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      description: typeof row.description === 'string' ? row.description : '',
      quantity: typeof row.quantity === 'number' || typeof row.quantity === 'string' ? row.quantity : '',
      unit_price: typeof row.unit_price === 'number' || typeof row.unit_price === 'string' ? row.unit_price : '',
    }))
}

function asMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name : '',
      duration: typeof row.duration === 'string' ? row.duration : '',
      date: typeof row.date === 'string' ? row.date : '',
    }))
}

type DynamicFieldProps = {
  field: GenerationField
  value: unknown
  onChange: (value: unknown) => void
  compactStyle: React.CSSProperties
}

function DynamicField({ field, value, onChange, compactStyle }: DynamicFieldProps) {
  const inputStyle: React.CSSProperties = {
    ...compactStyle,
    height: 38,
    padding: '0 10px',
  }

  if (field.kind === 'line_items') {
    const rows = asLineItems(value)
    const update = (index: number, key: keyof LineItem, next: string) => {
      const updated = rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: next } : row)
      onChange(updated)
    }
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{field.label}</label>
        {rows.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>No line items added yet.</p>}
        {rows.map((row, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 0.9fr auto', gap: 6, marginBottom: 6 }}>
            <input
              aria-label={`${field.label} description ${index + 1}`}
              data-testid={`generation-${field.key}-description-${index}`}
              placeholder="Description"
              value={row.description}
              onChange={(event) => update(index, 'description', event.target.value)}
              style={inputStyle}
            />
            <input
              aria-label={`${field.label} quantity ${index + 1}`}
              data-testid={`generation-${field.key}-quantity-${index}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="Qty"
              value={row.quantity}
              onChange={(event) => update(index, 'quantity', event.target.value)}
              style={inputStyle}
            />
            <input
              aria-label={`${field.label} unit price ${index + 1}`}
              data-testid={`generation-${field.key}-price-${index}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="Unit price"
              value={row.unit_price}
              onChange={(event) => update(index, 'unit_price', event.target.value)}
              style={inputStyle}
            />
            <button
              type="button"
              aria-label={`Remove line item ${index + 1}`}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              className="portal-btn-secondary"
              style={{ ...compactStyle, height: 38 }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid={`generation-${field.key}-add`}
          onClick={() => onChange([...rows, { description: '', quantity: 1, unit_price: '' }])}
          className="portal-btn-secondary"
          style={compactStyle}
        >
          Add line item
        </button>
        {field.help && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{field.help}</p>}
      </div>
    )
  }

  if (field.kind === 'milestones') {
    const rows = asMilestones(value)
    const update = (index: number, key: keyof Milestone, next: string) => {
      const updated = rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: next } : row)
      onChange(updated)
    }
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{field.label}</label>
        {rows.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>No milestones added yet.</p>}
        {rows.map((row, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
            <input
              aria-label={`Milestone name ${index + 1}`}
              data-testid={`generation-milestone-name-${index}`}
              placeholder="Milestone"
              value={row.name}
              onChange={(event) => update(index, 'name', event.target.value)}
              style={inputStyle}
            />
            <input
              aria-label={`Milestone duration ${index + 1}`}
              data-testid={`generation-milestone-duration-${index}`}
              placeholder="Duration"
              value={row.duration}
              onChange={(event) => update(index, 'duration', event.target.value)}
              style={inputStyle}
            />
            <input
              aria-label={`Milestone date ${index + 1}`}
              data-testid={`generation-milestone-date-${index}`}
              type="date"
              value={row.date}
              onChange={(event) => update(index, 'date', event.target.value)}
              style={inputStyle}
            />
            <button
              type="button"
              aria-label={`Remove milestone ${index + 1}`}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              className="portal-btn-secondary"
              style={{ ...compactStyle, height: 38 }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid="generation-milestones-add"
          onClick={() => onChange([...rows, { name: '', duration: '', date: '' }])}
          className="portal-btn-secondary"
          style={compactStyle}
        >
          Add milestone
        </button>
        {field.help && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{field.help}</p>}
      </div>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          {field.label}{field.required ? ' *' : ''}
        </label>
        <textarea
          aria-label={field.label}
          data-testid={`generation-field-${field.key}`}
          rows={3}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...compactStyle, height: 'auto', padding: 10, lineHeight: 1.45, resize: 'vertical' }}
        />
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {field.label}{field.required ? ' *' : ''}
      </label>
      <input
        aria-label={field.label}
        data-testid={`generation-field-${field.key}`}
        type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
        min={field.kind === 'number' ? field.min : undefined}
        step={field.kind === 'number' ? '0.01' : undefined}
        placeholder={field.placeholder}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      />
      {field.help && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{field.help}</p>}
    </div>
  )
}

function statusLabel(status: string) {
  switch (status) {
    case 'draft': return 'Draft'
    case 'pending_review': return 'Pending Review'
    case 'approved': return 'Approved'
    case 'rejected':
    case 'declined': return 'Rejected'
    case 'sent_to_client':
    case 'shared': return 'Shared'
    default: return status.replace(/_/g, ' ')
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export default function DocumentsTab({ projectId, readOnly = false }: DocumentsTabProps) {
  const { role } = usePortal()
  const isSenior = role === 'senior_dev_pm'
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const [generateStep, setGenerateStep] = useState<'type' | 'form' | null>(null)
  const [selectedType, setSelectedType] = useState<GenerationType | null>(null)
  const [formFields, setFormFields] = useState<GenerationFields>({})
  const [generationError, setGenerationError] = useState('')

  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadType, setUploadType] = useState(UPLOAD_TYPES[0])
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [editorContent, setEditorContent] = useState('')
  const [editorTitle, setEditorTitle] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const loadDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, type, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (!error && data) setDocuments(data as DocumentRecord[])
  }, [projectId])

  useEffect(() => {
    // Defer the initial fetch so React does not warn about a synchronous
    // setState call during the effect body.
    const timeout = window.setTimeout(() => { void loadDocuments() }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadDocuments])

  const authFetch = async (url: string, options: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated.')
    const isForm = options.body instanceof FormData
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`)
    return result
  }

  const openDocument = async (documentId: string, preserveMessage = false) => {
    setEditorLoading(true)
    if (!preserveMessage) setMessage(null)
    try {
      const result = await authFetch(`/api/documents/${documentId}`)
      setDetail(result.document)
      setCanEdit(Boolean(result.can_edit) && !readOnly)
      setEditorContent(result.document.content || '')
      setEditorTitle(result.document.title || '')
      setRejectionReason(result.document.review_comment || result.document.rejection_reason || '')
      setEditorOpen(true)
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not open document.' })
    } finally {
      setEditorLoading(false)
    }
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setDetail(null)
    setCanEdit(false)
  }

  const refreshEditor = async () => {
    // Keep the success feedback visible while restoring the saved revision.
    if (detail) await openDocument(detail.id, true)
    await loadDocuments()
  }

  const downloadDocument = async (documentId: string, title: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setMessage({ type: 'error', text: 'Not authenticated.' })
        return
      }
      const response = await fetch(`/api/documents/${documentId}/download-pdf`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        setMessage({ type: 'error', text: result.error || 'Could not download document.' })
        return
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setMessage({ type: 'success', text: 'PDF downloaded. The editable document remains in the portal.' })
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not download document.' })
    }
  }

  const openGenerateModal = () => {
    if (readOnly) return
    setGenerateStep('type')
    setSelectedType(null)
    setFormFields({})
    setGenerationError('')
    setMessage(null)
  }

  const chooseGenerationType = (type: GenerationType) => {
    setSelectedType(type)
    setFormFields(defaultGenerationFields(type))
    setGenerationError('')
  }

  const continueToForm = () => {
    if (!selectedType) {
      setGenerationError('Select a document type to continue.')
      return
    }
    setGenerationError('')
    setGenerateStep('form')
  }

  const updateGenerationField = (key: string, value: unknown) => {
    setFormFields((previous) => ({ ...previous, [key]: value }))
    setGenerationError('')
  }

  const submitGeneration = async () => {
    const type = selectedType && normalizeGenerationType(selectedType)
    if (!type) {
      setGenerationError('Select a document type first.')
      return
    }
    const validationError = validateGenerationFields(type, formFields)
    if (validationError) {
      setGenerationError(validationError)
      return
    }

    setGenerating(true)
    setGenerationError('')
    setMessage(null)
    try {
      const result = await authFetch('/api/generate-document', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          type,
          fields: formFields,
        }),
      })
      setGenerateStep(null)
      setMessage({ type: 'success', text: result.message || 'Document created as a draft. Review and submit it for approval.' })
      await loadDocuments()
    } catch (err: unknown) {
      setGenerationError(err instanceof Error ? err.message : 'Could not generate document.')
    } finally {
      setGenerating(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      setMessage({ type: 'error', text: 'Choose a file to upload.' })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('type', uploadType)
      formData.append('title', uploadTitle.trim() || uploadFile.name)
      await authFetch(`/api/documents/${projectId}/upload`, {
        method: 'POST',
        body: formData,
      })
      setUploadModalOpen(false)
      setUploadFile(null)
      setUploadTitle('')
      setMessage({ type: 'success', text: 'Document uploaded and submitted for review.' })
      await loadDocuments()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not upload document.' })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!detail) return
    setSaving(true)
    setMessage(null)
    try {
      await authFetch(`/api/documents/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: editorContent, title: editorTitle }),
      })
      setMessage({ type: 'success', text: 'Document saved.' })
      await refreshEditor()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not save document.' })
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!detail) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await authFetch(`/api/documents/${detail.id}/submit`, { method: 'POST' })
      setMessage({ type: 'success', text: result.message || 'Document submitted for review.' })
      await refreshEditor()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not submit document.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    if (!detail) return
    if (decision === 'rejected' && !rejectionReason.trim()) {
      setMessage({ type: 'error', text: 'Enter a reason so the creator can see what to correct.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const result = await authFetch(`/api/documents/${detail.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comment: rejectionReason.trim() || null,
          revision_id: detail.current_revision_id,
        }),
      })
      setMessage({ type: 'success', text: result.message || `Document ${decision}.` })
      await refreshEditor()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : `Could not ${decision} document.` })
    } finally {
      setSaving(false)
    }
  }

  const buttonStyle = { height: '36px', fontSize: '12px', padding: '0 14px' }
  const smallButtonStyle = { fontSize: '11px', padding: '4px 8px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!readOnly && (
          <button
            type="button"
            data-testid="generate-document-button"
            onClick={openGenerateModal}
            className="portal-btn-primary"
            style={buttonStyle}
          >
            Generate Document
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            data-testid="upload-document-button"
            onClick={() => setUploadModalOpen(true)}
            className="portal-btn-secondary"
            style={buttonStyle}
          >
            Upload Document
          </button>
        )}
      </div>

      {message && (
        <div
          data-testid="documents-message"
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)', border: `1px solid ${message.type === 'success' ? 'var(--success-border)' : 'var(--error-border)'}`, color: message.type === 'success' ? 'var(--success-text)' : 'var(--error-text)', fontSize: '13px' }}
        >
          {message.text}
        </div>
      )}

      <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, color: 'var(--heading)' }}>Documents ({documents.length})</h3>

      {documents.length === 0 ? (
        <div style={{ color: 'var(--muted-light)', fontSize: '13px', paddingTop: '8px' }}>
          {readOnly ? 'No documents recorded for this project.' : 'No documents yet. Generate or upload one above.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr>
                {['Title', 'Type', 'Status', 'Created', 'Actions'].map((heading) => (
                  <th key={heading} style={{ padding: '12px 16px', background: 'var(--surface-alt)', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--text)', fontWeight: 600 }}>{doc.title}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{doc.type}</td>
                  <td data-testid="document-status" style={{ padding: '12px 16px', color: doc.status === 'approved' ? 'var(--success-text)' : doc.status === 'pending_review' ? 'var(--warning-text, var(--muted))' : 'var(--muted)' }}>
                    {statusLabel(doc.status)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" data-testid="open-document" onClick={() => openDocument(doc.id)} className="portal-btn-secondary" style={smallButtonStyle}>
                        Open
                      </button>
                      <button type="button" data-testid="download-document" onClick={() => downloadDocument(doc.id, doc.title)} className="portal-btn-secondary" style={smallButtonStyle}>
                        Download
                      </button>
                      {!readOnly && (doc.status === 'draft' || doc.status === 'rejected' || doc.status === 'declined') && (
                        <button type="button" data-testid="submit-document" onClick={async () => {
                          try {
                            const result = await authFetch(`/api/documents/${doc.id}/submit`, { method: 'POST' })
                            setMessage({ type: 'success', text: result.message || 'Document submitted for review.' })
                            await loadDocuments()
                          } catch (err: unknown) {
                            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not submit document.' })
                          }
                        }} className="portal-btn-primary" style={smallButtonStyle}>
                          Submit for Review
                        </button>
                      )}
                      {isSenior && !readOnly && doc.status === 'pending_review' && (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Review in Open</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {generateStep && (
        <div className="portal-modal-overlay" data-testid="generate-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--heading)' }}>Generate Document</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                  {generateStep === 'type'
                    ? 'Choose the document type. The correct form, template and validation will open next.'
                    : `${GENERATION_CONFIG[selectedType!].label} · project and client are attached automatically.`}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close generate document"
                onClick={() => setGenerateStep(null)}
                className="portal-btn-secondary"
                style={buttonStyle}
              >
                Close
              </button>
            </div>

            {generationError && (
              <div data-testid="generation-error" role="alert" style={{ padding: '9px 11px', marginBottom: 12, borderRadius: 8, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', fontSize: 12 }}>
                {generationError}
              </div>
            )}

            {generateStep === 'type' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {GENERATION_TYPES.map((type) => {
                    const config = GENERATION_CONFIG[type]
                    const active = selectedType === type
                    return (
                      <button
                        key={type}
                        type="button"
                        data-testid={`generate-type-${type}`}
                        aria-pressed={active}
                        onClick={() => chooseGenerationType(type)}
                        style={{
                          textAlign: 'left',
                          padding: '12px 14px',
                          borderRadius: 10,
                          border: `1px solid ${active ? 'var(--accent-strong)' : 'var(--border)'}`,
                          background: active ? 'var(--accent-soft)' : 'var(--surface-alt)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <strong style={{ display: 'block', fontSize: 13, color: 'var(--heading)' }}>{config.label}</strong>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>{config.description}</span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => setGenerateStep(null)} className="portal-btn-secondary" style={buttonStyle}>Cancel</button>
                  <button
                    type="button"
                    data-testid="generate-continue"
                    onClick={continueToForm}
                    disabled={!selectedType}
                    className="portal-btn-primary"
                    style={{ ...buttonStyle, opacity: selectedType ? 1 : 0.55 }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setGenerateStep('type')} className="portal-btn-secondary" style={{ ...smallButtonStyle, marginBottom: 14 }}>
                  ← Change document type
                </button>
                {GENERATION_CONFIG[selectedType!].fields.map((field) => (
                  <DynamicField
                    key={field.key}
                    field={field}
                    value={formFields[field.key]}
                    onChange={(value) => updateGenerationField(field.key, value)}
                    compactStyle={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                  />
                ))}
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 14px' }}>
                  The draft is saved in the portal and submitted for senior review by you afterwards. No financial values are invented.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => setGenerateStep('type')} className="portal-btn-secondary" style={buttonStyle}>Back</button>
                  <button
                    type="button"
                    data-testid="generate-submit"
                    onClick={submitGeneration}
                    disabled={generating}
                    className="portal-btn-primary"
                    style={buttonStyle}
                  >
                    {generating ? 'Generating…' : 'Generate Draft'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {uploadModalOpen && (
        <div className="portal-modal-overlay" data-testid="upload-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ width: 'min(440px, 100%)', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 17, color: 'var(--heading)' }}>Upload Document</h3>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Document type</label>
            <select
              data-testid="upload-type-select"
              aria-label="Upload document type"
              value={uploadType}
              onChange={(event) => setUploadType(event.target.value)}
              style={{ width: '100%', height: 38, marginBottom: 12, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
            >
              {UPLOAD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Title (optional)</label>
            <input
              data-testid="upload-title-input"
              aria-label="Upload title"
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              style={{ width: '100%', height: 38, marginBottom: 12, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
            />
            <input
              type="file"
              data-testid="upload-file-input"
              aria-label="Document file"
              accept=".pdf,.doc,.docx,.txt,.md"
              onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              style={{ width: '100%', marginBottom: 16, fontSize: 12, color: 'var(--text)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setUploadModalOpen(false)} className="portal-btn-secondary" style={buttonStyle}>Cancel</button>
              <button type="button" data-testid="upload-submit" onClick={handleUpload} disabled={uploading} className="portal-btn-primary" style={buttonStyle}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editorOpen && (
        <div className="portal-modal-overlay" data-testid="document-editor" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ width: 'min(860px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--heading)' }}>{detail?.title}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                  {detail?.type} · {statusLabel(detail?.status || '')}
                  {detail?.project ? ` · ${detail.project.name}` : ''}
                  {detail?.project?.clients?.name ? ` · ${detail.project.clients.name}` : ''}
                </p>
              </div>
              <button type="button" onClick={closeEditor} className="portal-btn-secondary" style={smallButtonStyle}>Close</button>
            </div>

            {editorLoading ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading document…</p>
            ) : detail && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, padding: '12px', marginBottom: 14, border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--surface-alt)', fontSize: 12 }}>
                  <span><strong>Created by:</strong> {detail.created_by_name}</span>
                  <span><strong>Created:</strong> {formatDate(detail.created_at)}</span>
                  <span><strong>Last edited by:</strong> {detail.last_edited_by_name}</span>
                  <span><strong>Last edited:</strong> {formatDate(detail.last_edited_at)}</span>
                  <span><strong>Approved by:</strong> {detail.approved_by_name || '—'}</span>
                  <span><strong>Approved:</strong> {formatDate(detail.approved_at)}</span>
                  <span><strong>Revision:</strong> {detail.revision_no ?? '—'}</span>
                  {detail.uploaded_file_name && <span><strong>Uploaded file:</strong> {detail.uploaded_file_name}</span>}
                </div>

                {detail.rejection_reason && (
                  <div style={{ padding: '10px', marginBottom: 14, borderRadius: 8, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', fontSize: 13 }} data-testid="rejection-reason-display">
                    <strong>Rejection reason:</strong> {detail.rejection_reason}
                  </div>
                )}

                <input
                  aria-label="Document title"
                  data-testid="editor-title"
                  value={editorTitle}
                  onChange={(event) => setEditorTitle(event.target.value)}
                  disabled={!canEdit}
                  style={{ width: '100%', height: 38, marginBottom: 10, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontWeight: 600 }}
                />
                <textarea
                  aria-label="Document content"
                  data-testid="document-content"
                  value={editorContent}
                  onChange={(event) => setEditorContent(event.target.value)}
                  disabled={!canEdit}
                  rows={16}
                  style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
                />

                {isSenior && !readOnly && detail.status === 'pending_review' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Review note / rejection reason</label>
                    <textarea
                      aria-label="Review note"
                      data-testid="rejection-reason"
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      rows={3}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button type="button" data-testid="approve-document" onClick={() => handleDecision('approved')} disabled={saving} className="portal-btn-primary" style={buttonStyle}>Approve</button>
                      <button type="button" data-testid="reject-document" onClick={() => handleDecision('rejected')} disabled={saving} className="portal-btn-secondary" style={buttonStyle}>Reject</button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {canEdit && (
                    <button type="button" data-testid="save-document" onClick={handleSave} disabled={saving} className="portal-btn-primary" style={buttonStyle}>{saving ? 'Saving…' : 'Save Changes'}</button>
                  )}
                  {canEdit && (detail.status === 'draft' || detail.status === 'rejected' || detail.status === 'declined') && (
                    <button type="button" data-testid="submit-review" onClick={handleSubmit} disabled={saving} className="portal-btn-secondary" style={buttonStyle}>Submit for Review</button>
                  )}
                  <button type="button" data-testid="download-pdf" onClick={() => downloadDocument(detail.id, detail.title)} className="portal-btn-secondary" style={buttonStyle}>Download PDF</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
