'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type LinkRecord = {
  id: string
  link_type: string | null
  url: string
  created_at?: string | null
}

type UrlLinksTabProps = {
  projectId: string
}

export default function UrlLinksTab({ projectId }: UrlLinksTabProps) {
  const [links, setLinks] = useState<LinkRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const loadLinks = useCallback(async () => {
    const { data, error } = await supabase
      .from('development_links')
      .select('id, link_type, url, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (!error && data) {
      setLinks(data as LinkRecord[])
    }
  }, [projectId])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !label.trim()) {
      setMessage({ type: 'error', text: 'URL and label are required.' })
      return
    }

    setAdding(true)
    setMessage(null)

    const { error } = await supabase.from('development_links').insert({
      project_id: projectId,
      link_type: label.trim(),
      url: url.trim(),
    })

    setAdding(false)
    if (error) {
      setMessage({ type: 'error', text: 'Could not add link: ' + error.message })
      return
    }

    setMessage({ type: 'success', text: 'Link added!' })
    setLabel('')
    setUrl('')
    await loadLinks()
  }

  const handleDelete = async (linkId: string) => {
    if (!window.confirm('Delete this link?')) return

    const { error } = await supabase.from('development_links').delete().eq('id', linkId)
    if (error) {
      setMessage({ type: 'error', text: 'Could not delete link: ' + error.message })
      return
    }

    setMessage({ type: 'success', text: 'Link deleted!' })
    await loadLinks()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
        <div className="form-group">
          <label className="form-label">Label</label>
          <input className="form-input" placeholder="e.g. Repository" value={label} onChange={(e) => setLabel(e.target.value)} disabled={adding} />
        </div>
        <div className="form-group">
          <label className="form-label">URL</label>
          <input className="form-input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} disabled={adding} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '6px' }}>
          <button type="button" onClick={() => { setLabel(''); setUrl('') }} className="portal-btn-secondary" disabled={adding}>
            Clear
          </button>
          <button type="submit" className="portal-btn-primary" disabled={adding}>
            {adding ? 'Adding…' : 'Save Link'}
          </button>
        </div>
      </form>

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${message.type === 'success' ? '#a7f3d0' : '#fee2e2'}`, color: message.type === 'success' ? '#065f46' : '#b91c1c', fontSize: '13px' }}
        >
          {message.text}
        </div>
      )}

      <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, color: '#14213d' }}>URL Links ({links.length})</h3>

      {links.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: '13px', paddingTop: '8px' }}>
          No links yet. Add one above.
        </div>
      ) : (
        <div style={{ border: '1px solid #e8ecf3', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Label</th>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>URL</th>
                <th style={{ padding: '12px 16px', background: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e8ecf3' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', color: '#1e293b' }}>{link.link_type || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#1e293b' }}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4361ee', fontWeight: 600 }}>{link.url}</a>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(link.id)}
                      className="portal-danger-btn"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      Delete
                    </button>
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
