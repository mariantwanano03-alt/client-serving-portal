'use client'

import React from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'

export default function SeniorPage() {
  return (
    <PortalShell title="Senior Dashboard" breadcrumb="WORKSPACE / SENIOR">
      <SeniorContent />
    </PortalShell>
  )
}

function SeniorContent() {
  const { profile } = usePortal()
  const displayName = profile?.full_name?.trim() || 'User'
  const firstName = displayName.split(' ')[0]

  return (
    <>
      <section className="dashboard-welcome">
        <div className="dashboard-welcome-content">
          <span className="dashboard-pill">SENIOR WORKSPACE</span>
          <h2>Welcome back, {firstName}!</h2>
          <p>
            Manage your projects, review team assignments, and approve discovery meetings
            from your senior workspace.
          </p>
        </div>

        <div className="dashboard-welcome-art" aria-hidden="true">
          <div className="dashboard-art-circle" />
          <div className="dashboard-art-card">
            <span>🎯</span>
            <div />
            <div />
            <div />
            <b>✓</b>
          </div>
          <div className="dashboard-art-badge">Senior Ready ✓</div>
        </div>
      </section>

      <section className="dashboard-section-heading">
        <div>
          <h2>Your Senior Workspace</h2>
          <p>Quick access to your day-to-day senior responsibilities.</p>
        </div>
        <span className="dashboard-role-badge">
          {formatRole(profile?.role)}
        </span>
      </section>

      <section className="dashboard-feature-grid">
        <Link href="/projects" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon projects-tone">▤</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>All Projects</h3>
          <p>Review and manage all projects in the system.</p>
          <span className="dashboard-card-action">Open projects →</span>
        </Link>

        <Link href="/clients" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon clients-tone">♙</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Clients</h3>
          <p>Access client information and manage relationships.</p>
          <span className="dashboard-card-action">Open clients →</span>
        </Link>

        <Link href="/discovery" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">🎙️</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Discovery Meetings</h3>
          <p>Review and approve discovery sessions from your team.</p>
          <span className="dashboard-card-action">Open discovery →</span>
        </Link>

        <Link
          href="/admin"
          className="dashboard-feature-card"
        >
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">
              ⚙
            </span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Admin Console</h3>
          <p>
            Manage users, project assignments and audit history.
          </p>
          <span className="dashboard-card-action">
            Open admin →
          </span>
        </Link>
      </section>
    </>
  )
}
