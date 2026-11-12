'use client'

import React from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'

export default function ClientPage() {
  return (
    <PortalShell title="Client Dashboard" breadcrumb="WORKSPACE / CLIENT">
      <ClientContent />
    </PortalShell>
  )
}

function ClientContent() {
  const { profile } = usePortal()
  const displayName = profile?.full_name?.trim() || 'User'
  const firstName = displayName.split(' ')[0]

  return (
    <>
      <section className="dashboard-welcome">
        <div className="dashboard-welcome-content">
          <span className="dashboard-pill">CLIENT WORKSPACE</span>
          <h2>Welcome back, {firstName}!</h2>
          <p>
            Track your assigned projects, review readiness checklists, and
            collaborate with your team from your client workspace.
          </p>
        </div>

        <div className="dashboard-welcome-art" aria-hidden="true">
          <div className="dashboard-art-circle" />
          <div className="dashboard-art-card">
            <span>📋</span>
            <div />
            <div />
            <div />
            <b>✓</b>
          </div>
          <div className="dashboard-art-badge">Client Ready ✓</div>
        </div>
      </section>

      <section className="dashboard-section-heading">
        <div>
          <h2>Your Client Workspace</h2>
          <p>Quick access to your assigned projects and tasks.</p>
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
          <h3>My Projects</h3>
          <p>View projects assigned to you and track progress.</p>
          <span className="dashboard-card-action">Open projects →</span>
        </Link>

        <Link href="/clients" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon clients-tone">♙</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Clients</h3>
          <p>Access client information and contact details.</p>
          <span className="dashboard-card-action">Open clients →</span>
        </Link>

        <Link href="/discovery" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">🎙️</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Discovery Meetings</h3>
          <p>View discovery meetings and contribute transcripts.</p>
          <span className="dashboard-card-action">Open discovery →</span>
        </Link>

        <Link href="/settings" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">
              ⚙
            </span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Settings</h3>
          <p>Manage your profile and account preferences.</p>
          <span className="dashboard-card-action">
            Open settings →
          </span>
        </Link>
      </section>
    </>
  )
}
