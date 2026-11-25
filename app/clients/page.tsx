'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import PortalShell from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type ClientRow = {
  id: string
  client_code: string
  name: string
  primary_contact: string | null
  email: string | null
  phone: string | null
  created_at: string | null
}

export default function ClientsPage() {
  return (
    <PortalShell title="Clients" breadcrumb="WORKSPACE / CLIENTS">
      <ClientsContent />
    </PortalShell>
  )
}

function formatCreated(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ClientsContent() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadClients() {
      setLoading(true)
      setErrorMessage('')
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('id, client_code, name, primary_contact, email, phone, created_at')
          .order('name', { ascending: true })

        if (ignore) return
        if (error) {
          setErrorMessage('Could not load clients: ' + error.message)
          return
        }
        setClients((data ?? []) as ClientRow[])
      } catch (err: unknown) {
        if (!ignore) setErrorMessage(err instanceof Error ? err.message : 'Could not load clients.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadClients()
    return () => { ignore = true }
  }, [])

  const filtered = clients.filter((client) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [client.name, client.client_code, client.primary_contact, client.email, client.phone]
      .some((value) => (value || '').toLowerCase().includes(q))
  })

  return (
    <div className="admin-design">
      <div className="oversight-page">
        <div className="readonly-banner" data-testid="client-readonly">
          <span aria-hidden="true">👁</span>
          <span>
            Read-only client directory. Records can be viewed, but not created, edited,
            deleted or uploaded to from this page.
          </span>
        </div>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <h2 className="admin-surface-title">Client records</h2>
              <p className="admin-surface-desc">
                Client names, codes, primary contacts and creation dates as stored in the portal.
              </p>
            </div>
            <div className="portal-search-wrap admin-search">
              <span className="portal-search-icon" aria-hidden="true">🔍</span>
              <input
                className="portal-search-input"
                aria-label="Search clients"
                placeholder="Search clients..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          {errorMessage && (
            <div className="auth-alert-error" role="alert">
              <span aria-hidden="true">⚠️</span><span>{errorMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">⏳</div>
              <p className="portal-empty-title">Loading clients...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon">♙</div>
              <p className="portal-empty-title">{search ? 'No matching clients' : 'No clients yet'}</p>
              <p className="portal-empty-desc">
                {search ? 'Try a different search term.' : 'Client records will appear here once they are created.'}
              </p>
            </div>
          ) : (
            <div className="portal-table-container admin-table-scroll">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Client name</th>
                    <th>Code</th>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((client) => (
                    <tr key={client.id} data-testid="client-row">
                      <td>
                        <Link
                          href={`/clients/${client.id}`}
                          className="portal-table-link admin-cell-truncate is-name"
                          title={client.name}
                        >
                          {client.name}
                        </Link>
                      </td>
                      <td>
                        <span className="admin-badge admin-cell-truncate is-code" title={client.client_code || ''}>
                          {client.client_code || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="admin-cell-truncate is-contact" title={client.primary_contact || ''}>
                          {client.primary_contact || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="admin-cell-truncate" title={client.email || ''}>
                          {client.email || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="admin-cell-truncate" title={client.phone || ''}>
                          {client.phone || '—'}
                        </span>
                      </td>
                      <td className="admin-registered-at">{formatCreated(client.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
