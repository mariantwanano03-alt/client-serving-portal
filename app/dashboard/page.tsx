'use client'

import React from 'react'
import Link from 'next/link'
import PortalShell, { usePortal, formatRole } from '@/components/PortalShell'

export default function DashboardPage() {
  return (
    <PortalShell title="Dashboard" breadcrumb="WORKSPACE / OVERVIEW">
      <DashboardContent />
    </PortalShell>
  )
}

function DashboardContent() {
  const { profile } = usePortal()
  const displayName = profile?.full_name?.trim() || 'User'
  const firstName = displayName.split(' ')[0]

  return (
    <>
      <section className="dashboard-welcome">
        <div className="dashboard-welcome-content">
          <span className="dashboard-pill">YOUR WORKSPACE</span>
          <h2>Welcome back, {firstName}!</h2>
          <p>
            Here is your workspace. Manage your clients and keep
            track of your projects from one place.
          </p>
          <Link href="/projects" className="dashboard-button">
            View projects <span>→</span>
          </Link>
        </div>

        <div className="dashboard-welcome-art" aria-hidden="true">
          <div className="dashboard-art-circle" />
          <div className="dashboard-art-card">
            <span>✳</span>
            <div />
            <div />
            <div />
            <b>✓</b>
          </div>
          <div className="dashboard-art-badge">Workspace ready ✓</div>
        </div>
      </section>

      <section className="dashboard-section-heading">
        <div>
          <h2>Your workspace</h2>
          <p>Quick access to your day-to-day work.</p>
        </div>
        <span className="dashboard-role-badge">
          {formatRole(profile?.role)}
        </span>
      </section>

      <section className="dashboard-feature-grid">
        <Link href="/clients" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon clients-tone">♙</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Clients</h3>
          <p>Access your client information and manage relationships.</p>
          <span className="dashboard-card-action">Open clients →</span>
        </Link>

        <Link href="/projects" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon projects-tone">▤</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Projects</h3>
          <p>View your projects and follow their progress.</p>
          <span className="dashboard-card-action">View projects →</span>
        </Link>

        <Link href="/" className="dashboard-feature-card">
          <div className="dashboard-feature-top">
            <span className="dashboard-feature-icon home-tone">⌂</span>
            <span className="dashboard-card-arrow">↗</span>
          </div>
          <h3>Home</h3>
          <p>Return to the Client Serving Portal home page.</p>
          <span className="dashboard-card-action">Go to home →</span>
        </Link>
      </section>
    </>
  )
}
