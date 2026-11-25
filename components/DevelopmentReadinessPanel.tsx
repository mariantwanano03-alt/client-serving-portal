'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePortal } from './PortalShell'

type Prerequisite = {
  key: string
  label: string
  complete: boolean
  detail: string
}

type Readiness = {
  ready: boolean
  development: 'ready' | 'locked'
  clientAgreement: {
    verified: boolean
    label: string
    detail: string
    signedAt: string | null
  }
  prerequisites: Prerequisite[]
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

export default function DevelopmentReadinessPanel({
  projectId,
  refreshKey = 0,
}: {
  projectId: string
  refreshKey?: string | number
}) {
  const { role, loading: profileLoading, signingOut } = usePortal()
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    if (profileLoading || signingOut) return
    if (!['administrator', 'senior_dev_pm', 'junior_developer'].includes(role)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (signal?.aborted) return
      if (!session) {
        setError('Your session has expired. Please sign in again.')
        return
      }
      const response = await fetch(`/api/projects/${projectId}/readiness`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (signal?.aborted) return
      if (!response.ok) {
        setError(payload.error || 'Could not load development readiness.')
        return
      }
      setReadiness(payload as Readiness)
    } catch (err: unknown) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load development readiness.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [projectId, role, profileLoading, signingOut])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [load, refreshKey])

  const beginDevelopment = async () => {
    setStarting(true)
    setActionMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated.')
      const response = await fetch(`/api/projects/${projectId}/development/begin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Development is still locked.')
      }
      if (payload.readiness) setReadiness(payload.readiness as Readiness)
      setActionMessage(payload.message || 'Development is ready to begin.')
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'Could not begin development.')
    } finally {
      setStarting(false)
    }
  }

  const agreement = readiness?.clientAgreement
  const initials = readiness
    ? readiness.prerequisites.map((item) => item.complete ? '✓' : '✗').join(' ')
    : ''

  return (
    <section
      className="portal-card"
      data-testid="development-readiness-panel"
      style={{ padding: '14px 16px', marginBottom: 18 }}
      aria-label="Development readiness"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>Development Readiness</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Verified from signed records and existing project prerequisites.
          </p>
        </div>
        <span
          data-testid="development-status"
          style={{
            padding: '5px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: readiness?.ready ? 'var(--success-bg)' : 'var(--warning-bg, var(--surface-alt))',
            color: readiness?.ready ? 'var(--success-text)' : 'var(--muted)',
            border: `1px solid ${readiness?.ready ? 'var(--success-border)' : 'var(--border)'}`,
          }}
        >
          Development: {readiness?.ready ? 'Ready' : 'Locked'}
        </span>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '12px 0 0' }}>Checking readiness…</p>
      ) : error ? (
        <p data-testid="readiness-error" style={{ fontSize: 12, color: 'var(--error-text)', margin: '12px 0 0' }}>{error}</p>
      ) : readiness && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border-soft)' }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>SLA status</span>
              <strong data-testid="sla-status" style={{ display: 'block', marginTop: 3, fontSize: 13, color: agreement?.verified ? 'var(--success-text)' : 'var(--warning-text, var(--text))' }}>
                {agreement?.detail || 'SLA Awaiting Client Signature.'}
              </strong>
              {agreement?.signedAt && (
                <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>
                  Verified by signing service: {formatDate(agreement.signedAt)}
                </span>
              )}
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border-soft)' }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>Client agreement</span>
              <strong data-testid="client-agreement-status" style={{ display: 'block', marginTop: 3, fontSize: 13, color: agreement?.verified ? 'var(--success-text)' : 'var(--error-text)' }}>
                {agreement?.label || 'Client Approved & Agreed to Terms: ✗'}
              </strong>
            </div>
          </div>

          <div data-testid="readiness-prerequisites" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8, marginTop: 10 }}>
            {readiness.prerequisites.map((item) => (
              <div key={item.key} style={{ fontSize: 11, color: item.complete ? 'var(--success-text)' : 'var(--muted)' }}>
                <strong>{item.complete ? '✓' : '✗'} {item.label}</strong>
                <span style={{ display: 'block', color: 'var(--muted)', marginTop: 2 }}>{item.detail}</span>
              </div>
            ))}
          </div>

          <span aria-hidden="true" data-testid="readiness-summary" style={{ display: 'none' }}>{initials}</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {role === 'senior_dev_pm' ? (
              <button
                type="button"
                data-testid="begin-development"
                onClick={beginDevelopment}
                disabled={!readiness.ready || starting}
                className="portal-btn-primary"
                style={{ height: 34, fontSize: 12, opacity: readiness.ready ? 1 : 0.55 }}
              >
                {starting ? 'Starting…' : 'Begin Development'}
              </button>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {readiness.ready ? 'Development is ready for senior approval.' : 'Development remains locked.'}
              </span>
            )}
            {actionMessage && (
              <span data-testid="development-action-message" style={{ fontSize: 11, color: actionMessage.includes('locked') || actionMessage.includes('Locked') ? 'var(--error-text)' : 'var(--success-text)' }}>
                {actionMessage}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
