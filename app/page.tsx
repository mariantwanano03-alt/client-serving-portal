
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { error } = await supabase.auth.getSession()

  return (
    <main className="portal">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">C</span>
          <span>
            <strong>ClientFlow</strong>
            <small>Serving Portal</small>
          </span>
        </Link>

        <p className="nav-heading">WORKSPACE</p>

        <nav className="side-nav">
          <Link href="/" className="nav-link active">
            <span>◫</span> Overview
          </Link>
          <Link href="/dashboard" className="nav-link">
            <span>▦</span> Dashboard
          </Link>
          <Link href="/clients" className="nav-link">
            <span>♙</span> Clients
          </Link>
          <Link href="/projects" className="nav-link">
            <span>▤</span> Projects
          </Link>
          <Link href="/login" className="nav-link">
            <span>↗</span> Sign in
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <strong>Need assistance?</strong>
            <p>We&apos;re here to help you keep things moving.</p>
            <Link href="/login">Get started →</Link>
          </div>
          <p className="sidebar-footer">ClientFlow · Workspace</p>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">WORKSPACE / OVERVIEW</p>
            <h2>Client Serving Portal</h2>
          </div>
          <Link href="/login" className="profile-link">
            <span className="avatar">N</span>
            <span className="profile-label">Your account</span>
          </Link>
        </header>

        <section className="welcome">
          <div>
            <span className="welcome-tag">YOUR WORKSPACE</span>
            <h1>Everything in one place.</h1>
            <p>
              Manage client relationships, track projects and keep
              your work moving forward.
            </p>
            <Link href="/projects" className="primary-button">
              Explore projects <span>→</span>
            </Link>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-circle circle-one" />
            <div className="art-circle circle-two" />
            <div className="art-document">
              <span className="document-icon">✳</span>
              <div className="document-line long-line" />
              <div className="document-line" />
              <div className="document-line short-line" />
              <div className="document-check">✓</div>
            </div>
            <div className="floating-badge">✓ Organised</div>
          </div>
        </section>

        <div className={`connection-status ${error ? 'connection-error' : ''}`}>
          <span className="status-dot" />
          <span>
            {error
              ? 'Supabase connection failed: ' + error.message
              : 'Supabase connection successful'}
          </span>
        </div>

        <section className="section-heading">
          <div>
            <h2>Your workspace</h2>
            <p>Quick access to the tools you need.</p>
          </div>
        </section>

        <section className="feature-grid">
          <Link href="/clients" className="feature-card">
            <div className="feature-icon clients-icon">♙</div>
            <span className="card-arrow">↗</span>
            <h3>Clients</h3>
            <p>View and manage your client relationships.</p>
            <span className="card-link">Open clients →</span>
          </Link>

          <Link href="/projects" className="feature-card">
            <div className="feature-icon projects-icon">▤</div>
            <span className="card-arrow">↗</span>
            <h3>Projects</h3>
            <p>Keep track of projects and their progress.</p>
            <span className="card-link">View projects →</span>
          </Link>

          <Link href="/dashboard" className="feature-card">
            <div className="feature-icon dashboard-icon">◫</div>
            <span className="card-arrow">↗</span>
            <h3>Dashboard</h3>
            <p>Access your workspace overview.</p>
            <span className="card-link">Open dashboard →</span>
          </Link>
        </section>

        <footer className="page-footer">
          <span>ClientFlow</span>
          <span>Client Serving Portal · All in one workspace</span>
        </footer>
      </section>
    </main>
  )
}
