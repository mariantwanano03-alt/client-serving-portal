'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

type Shortcut = {
  title: string
  description: string
  icon: string
  href: string
  tone: string
  testId?: string
}

const ABOUT_SERVICES = [
  'Bespoke software development',
  'Web and mobile applications',
  'ERP systems',
  'AI automation',
  'Cloud infrastructure',
  'Data centre infrastructure management',
  'Network infrastructure',
  'Technical support',
  'Staff augmentation',
]

export default function Home() {
  return (
    <PortalShell title="Home" breadcrumb="WORKSPACE / HOME">
      <HomeContent />
    </PortalShell>
  )
}

function shortcutsFor(role: string, isAdministrator: boolean): Shortcut[] {
  if (isAdministrator) {
    return [
      { title: 'User Management', description: 'Review roles, statuses and pending account requests.', icon: '🛡', href: '/admin', tone: 'purple' },
      { title: 'Client Records', description: 'Browse client records and their project associations.', icon: '♙', href: '/clients', tone: 'blue' },
      { title: 'Projects', description: 'Review project workspaces and their read-only details.', icon: '▤', href: '/projects', tone: 'green' },
      { title: 'Financial Records', description: 'Inspect deposits, payments and outstanding balances.', icon: '◈', href: '/financials', tone: 'amber' },
      { title: 'Audit Trail', description: 'Follow recorded activity across the workspace.', icon: '📜', href: '/audit', tone: 'slate' },
    ]
  }

  if (role === 'senior_dev_pm') {
    return [
      { title: 'Projects', description: 'Open project workspaces and manage delivery.', icon: '▤', href: '/projects', tone: 'purple' },
      { title: 'Clients', description: 'Review client records and contact details.', icon: '♙', href: '/clients', tone: 'blue' },
      { title: 'Discovery Meetings', description: 'Capture a meeting and review the extracted details.', icon: '🎙', href: '/create-project', tone: 'green' },
      { title: 'Documents', description: 'Manage documents inside each project workspace.', icon: '📄', href: '/projects', tone: 'amber' },
      { title: 'Messages', description: 'Read and reply to client conversations.', icon: '✉', href: '/messages', tone: 'slate' },
    ]
  }

  if (role === 'junior_developer') {
    return [
      { title: 'My Assigned Projects', description: 'See the project work you have been assigned.', icon: '▤', href: '/projects', tone: 'purple' },
      { title: 'Messages', description: 'Stay in sync with the team and clients.', icon: '✉', href: '/messages', tone: 'blue' },
      { title: 'Documents', description: 'Find the documents relevant to your work.', icon: '📄', href: '/projects', tone: 'green' },
      { title: 'Financial Records', description: 'Review payment progress on your projects.', icon: '◈', href: '/financials', tone: 'amber' },
    ]
  }

  if (role === 'client') {
    return [
      { title: 'Messages', description: 'Communicate with your X Spark delivery team.', icon: '✉', href: '/messages', tone: 'purple' },
      { title: 'Settings', description: 'Manage your account preferences and password.', icon: '⚙', href: '/settings', tone: 'blue' },
    ]
  }

  return [
    { title: 'Projects', description: 'Open your project workspace.', icon: '▤', href: '/projects', tone: 'purple' },
    { title: 'Messages', description: 'Read and reply to messages.', icon: '✉', href: '/messages', tone: 'blue' },
  ]
}

function HomeContent() {
  const { profile, isAdministrator, role } = usePortal()
  const userName = profile?.full_name?.trim() || 'User'
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const shortcuts = shortcutsFor(role || '', isAdministrator)

  useEffect(() => {
    if (isAdministrator || role === 'client') return
    let ignore = false
    supabase.from('projects').select('id', { count: 'exact', head: true }).then(({ count }) => {
      if (!ignore) setProjectCount(count ?? 0)
    })
    return () => { ignore = true }
  }, [isAdministrator, role])

  return (
    <div className="home-page" data-testid="home-page">
      {isAdministrator && (
        <div className="readonly-banner" data-testid="admin-readonly-banner">
          <span aria-hidden="true">🛡️</span>
          <span>
            Read-only oversight access. You can review records and audit activity, but
            cannot perform business operations.
          </span>
        </div>
      )}

      <section className="home-hero" data-testid="home-branding">
        <div className="home-hero-content">
          <span className="dashboard-pill">
            {isAdministrator ? 'ADMINISTRATOR OVERSIGHT' : 'X SPARK WORKSPACE'}
          </span>
          <h1>Welcome to your workspace</h1>
          <p>
            Hello {userName}. Manage projects, clients and business operations in one place,
            or open a shortcut below to pick up where you left off.
          </p>
          <div className="home-hero-actions">
            {isAdministrator ? (
              <Link href="/dashboard" className="portal-btn-primary">
                Open oversight dashboard <span aria-hidden="true">→</span>
              </Link>
            ) : role === 'client' ? (
              <Link href="/messages" className="portal-btn-primary">
                Open Messages <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <Link href="/create-project" className="portal-btn-primary" data-testid="add-new-project">
                + Add New Project
              </Link>
            )}
            <Link
              href={isAdministrator || role === 'client' ? '/settings' : '/messages'}
              className="portal-btn-secondary"
            >
              {isAdministrator || role === 'client' ? 'Open Settings' : 'Open Messages'}
            </Link>
          </div>
        </div>
        <div className="home-hero-mark" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xspark-logo-on-light.png" alt="" className="home-hero-logo" />
          <div className="home-hero-mark-card">
            <span>⌂</span>
            <div />
            <div />
            <b>✓</b>
          </div>
        </div>
      </section>

      <section className="home-section" data-testid="workspace-shortcuts">
        <div className="dashboard-section-heading">
          <div>
            <h2>Your Workspace</h2>
            <p>Quick access to the areas available to your role.</p>
          </div>
          <span className="dashboard-role-badge" data-testid="home-role-label">
            {isAdministrator ? 'Administrator' : role === 'senior_dev_pm' ? 'Senior Dev / PM' : role === 'junior_developer' ? 'Junior Developer' : role === 'client' ? 'Client' : 'Team Member'}
          </span>
        </div>

        <div className="home-shortcut-grid">
          {shortcuts.map((shortcut) => (
            <Link
              key={shortcut.title}
              href={shortcut.href}
              className={`home-shortcut-card ${shortcut.tone}`}
              data-testid={shortcut.testId ? shortcut.testId : undefined}
            >
              <span className="home-shortcut-icon" aria-hidden="true">{shortcut.icon}</span>
              <h3>{shortcut.title}</h3>
              <p>{shortcut.description}</p>
              <span className="dashboard-card-action">Open →</span>
            </Link>
          ))}
        </div>

        {projectCount !== null && !isAdministrator && (
          <p className="home-project-count">
            {projectCount} project{projectCount === 1 ? '' : 's'} currently in the workspace.
          </p>
        )}
      </section>

      <section className="home-about" data-testid="home-about">
        <div className="home-about-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xspark-logo-on-light.png" alt="X Spark" className="home-about-logo" />
          <div>
            <h2>About X Spark</h2>
            <p>
              X Spark is a software development and IT infrastructure company providing
              technology solutions across software development, business systems, cloud
              infrastructure and IT services.
            </p>
          </div>
        </div>
        <dl className="home-about-facts">
          <div><dt>Company</dt><dd>X Spark</dd></div>
          <div><dt>Industry</dt><dd>Software Development and IT Infrastructure</dd></div>
          <div><dt>Established</dt><dd>2007</dd></div>
          <div><dt>Location</dt><dd>Randjespark, Midrand, South Africa</dd></div>
          <div>
            <dt>Website</dt>
            <dd>
              <a href="https://www.xspark.co.za/" target="_blank" rel="noreferrer">
                www.xspark.co.za
              </a>
            </dd>
          </div>
        </dl>
        <div className="home-about-services">
          <h3>Services</h3>
          <ul>
            {ABOUT_SERVICES.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
