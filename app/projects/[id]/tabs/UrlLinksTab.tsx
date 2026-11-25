'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type LinkRecord = {
  id: string
  link_type: string | null
  url: string
  recorded_at?: string | null
  verified?: boolean | null
}

type UrlLinksTabProps = {
  projectId: string
  readOnly?: boolean
}

export default function UrlLinksTab({ projectId, readOnly = false }: UrlLinksTabProps) {
  const [links, setLinks] = useState<LinkRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const loadLinks = useCallback(async () => {
    // NOTE: this table uses `recorded_at`, not `created_at`. Querying the wrong
    // column silently failed and left the list empty after a successful insert.
    const { data, error } = await supabase
      .from('development_links')
      .select('id, link_type, url, recorded_at, verified')
      .eq('project_id', projectId)
      .order('recorded_at', { ascending: false })
    if (error) {
      setMessage({ type: 'error', text: 'Could not load links: ' + error.message })
      return
    }
    setLinks((data as LinkRecord[]) || [])
  }, [projectId])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly) return
    if (!url.trim() || !label.trim()) {
      setMessage({ type: 'error', text: 'URL and label are required.' })
      return
    }

    // Validate before saving: only absolute http(s) URLs are useful here.
    try {
      const parsed = new URL(url.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setMessage({ type: 'error', text: 'URL must start with http:// or https://.' })
        return
      }
    } catch {
      setMessage({ type: 'error', text: 'Enter a valid URL, for example https://github.com/org/repo.' })
      return
    }

    setAdding(true)
    setMessage(null)

    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('development_links').insert({
      project_id: projectId,
      link_type: label.trim(),
      url: url.trim(),
      recorded_by: userData?.user?.id ?? null,
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
    if (readOnly || !window.confirm('Delete this link?')) return

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
      {!readOnly && (
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, background: 'var(--surface-alt)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '16px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="link-label">Label</label>
            <input id="link-label" data-testid="link-label" className="form-input" placeholder="e.g. Repository" value={label} onChange={(e) => setLabel(e.target.value)} disabled={adding} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="link-url">URL</label>
            <input id="link-url" data-testid="link-url" type="url" className="form-input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} disabled={adding} />
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
      )}

      {message && (
        <div
          style={{ padding: '10px', borderRadius: '8px', background: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)', border: `1px solid ${message.type === 'success' ? 'var(--success-border)' : 'var(--error-border)'}`, color: message.type === 'success' ? 'var(--success-text)' : 'var(--error-text)', fontSize: '13px' }}
        >
          {message.text}
        </div>
      )}

      <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, color: 'var(--heading)' }}>URL Links ({links.length})</h3>

      {links.length === 0 ? (
        <div style={{ color: 'var(--muted-light)', fontSize: '13px', paddingTop: '8px' }}>
          {readOnly ? 'No links recorded for this project.' : 'No links yet. Add one above.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 16px', background: 'var(--surface-alt)', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>Label</th>
                <th style={{ padding: '12px 16px', background: 'var(--surface-alt)', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>URL</th>
                {!readOnly && (
                  <th style={{ padding: '12px 16px', background: 'var(--surface-alt)', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--text)' }}>{link.link_type || '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>{link.url}</a>
                  </td>
                  {!readOnly && (
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
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
