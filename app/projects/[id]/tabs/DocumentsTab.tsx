'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type DocumentRecord = {
  id: string
  title: string
  type: string | null
  status: string
  created_at?: string | null
}

type DocumentsTabProps = {
  projectId: string
}

const DOC_TYPES = [
  { label: 'Generate PRD', type: 'PRD' },
  { label: 'Generate SRS', type: 'SRS' },
  { label: 'Generate Quotation', type: 'Quotation' },
  { label: 'Generate Proposal', type: 'Proposal' },
  { label: 'Generate Invoice', type: 'Invoice' },
  { label: 'Generate .md File', type: 'md' },
]

export default function DocumentsTab({ projectId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, type, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (!error && data) {
      setDocuments(data as DocumentRecord[])
    }
  }, [projectId])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const handleGenerate = async (type: string) => {
    setGenerating(type)
    setMessage(null)

    try {
      const res = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          type,
          title: `${type} Document`,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setMessage({ type: 'error', text: result.error || `Failed to generate ${type}.` })
        setGenerating(null)
        return
      }

      setMessage({ type: 'success', text: `${type} generated!` })
      await loadDocuments()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed to generate ${type}.`
      setMessage({ type: 'error', text: msg })
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {DOC_TYPES.map((dt) => (
          <button
            key={dt.type}
            type="button"
            onClick={() => handleGenerate(dt.type)}
            disabled={loading || generating === dt.type}
            className="portal-btn-primary"
            style={{ height: '36px', fontSize: '12px', padding: '0 14px', opacity: generating === dt.type ? 0.7 : 1 }}
          >
            {generating === dt.type ? 'Generating…' : dt.label}
          </button>
        ))}
      </div>

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${message.type === 'success' ? '#a7f3d0' : '#fee2e2'}`, color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: '13px' }}
        >
          {message.text}
        </div>
      )}

      <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, color: '#14213d' }}>Documents ({documents.length})</h3>

      {documents.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: '13px', paddingTop: '8px' }}>
          No documents yet. Generate one above.
        </div>
      ) : (
        <div style={{ border: '1px solid #e8ecf3', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Title</th>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Type</th>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Status</th>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', color: '#1e293b', fontWeight: 600 }}>{doc.title}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{doc.type}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{doc.status}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
