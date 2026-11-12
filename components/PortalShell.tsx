'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
export type UserProfile = {
  id: string
  full_name: string
  role: string
  is_active?: boolean
}

export interface PortalContextValue {
  user: User | null
  profile: UserProfile | null
  role: string
  loading: boolean
  refreshProfile: () => Promise<void>
}

const PortalContext = createContext<PortalContextValue>({
  user: null,
  profile: null,
  role: '',
  loading: true,
  refreshProfile: async () => {},
})

export function usePortal() {
  return useContext(PortalContext)
}

export function formatRole(role?: string): string {
  switch (role) {
    case 'senior_dev_pm':
      return 'Senior Dev / PM'
    case 'junior_developer':
      return 'Junior Developer'
    case 'administrator':
      return 'Administrator'
    default:
      return role || 'Team Member'
  }
}

interface PortalShellProps {
  title?: string
  breadcrumb?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

export default function PortalShell({
  title = 'Workspace',
  breadcrumb = 'WORKSPACE',
  actions,
  children,
}: PortalShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('Loading your workspace...')
  const [signingOut, setSigningOut] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError || !userData.user) {
        const next = `${window.location.pathname}${window.location.search}`
        router.replace(`/login?next=${encodeURIComponent(next)}`)
        return
      }

      setUser(userData.user)

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('id', userData.user.id)
        .single()

      if (error) {
        setMessage('Could not load profile: ' + error.message)
        setLoading(false)
        return
      }

      setProfile(data as UserProfile)

      if (!data.is_active) {
        setMessage('Your account has been removed or suspended. Please contact an administrator.')
        await supabase.auth.signOut()
        router.replace('/login')
        setLoading(false)
        return
      }

      setLoading(false)
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'Unknown error'
      setMessage('Failed to authenticate: ' + errMessage)
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    let isMounted = true

    async function checkAuth() {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser()

        if (!isMounted) return

        if (userError || !userData.user) {
          const next = `${window.location.pathname}${window.location.search}`
          router.replace(`/login?next=${encodeURIComponent(next)}`)
          return
        }

        setUser(userData.user)

        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role, is_active')
          .eq('id', userData.user.id)
          .single()

        if (!isMounted) return

        if (error) {
          setMessage('Could not load profile: ' + error.message)
          setLoading(false)
          return
        }

        setProfile(data as UserProfile)
        setLoading(false)

        if (!data.is_active) {
          setMessage('Your account has been removed or suspended. Please contact an administrator.')
          await supabase.auth.signOut()
          router.replace('/login')
        }
      } catch (err: unknown) {
        if (!isMounted) return
        const errMessage = err instanceof Error ? err.message : 'Unknown error'
        setMessage('Failed to authenticate: ' + errMessage)
        setLoading(false)
      }
    }

    checkAuth()

    return () => {
      isMounted = false
    }
  }, [router])

  async function handleSignOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage('Could not sign out: ' + error.message)
      setSigningOut(false)
      return
    }

    router.push('/login')
  }

  if (loading || !profile) {
    return (
      <main className="dashboard-loading">
        <div className="loading-card">
          <div className="loading-mark">C</div>
          <h2>Client Serving Portal</h2>
          <p>{message}</p>
          {message.startsWith('Could not') && (
            <button
              className="dashboard-button"
              onClick={() => {
                setLoading(true)
                loadProfile()
              }}
            >
              Try again
            </button>
          )}
        </div>
      </main>
    )
  }

  const displayName = profile.full_name?.trim() || 'User'
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const isClientsActive = pathname === '/clients' || pathname.startsWith('/clients/')
  const isProjectsActive = pathname === '/projects' || pathname.startsWith('/projects/')
  const isDiscoveryActive = pathname === '/discovery' || pathname.startsWith('/discovery/')
  const isAdminActive = pathname === '/admin' || pathname.startsWith('/admin')
  const isDashboardActive = pathname === '/dashboard'
  const isHomeActive = pathname === '/'
  const isSettingsActive = pathname === '/settings' || pathname.startsWith('/settings')

  return (
    <PortalContext.Provider
      value={{
        user,
        profile,
        role: profile.role || '',
        loading,
        refreshProfile: loadProfile,
      }}
    >
        <main className="dashboard-shell">
          <aside className="dashboard-sidebar">
            <Link href="/dashboard" className="dashboard-brand">
              <span className="brand-icon">C</span>
              <span>
                <strong>Client Serving Portal</strong>
                <small>Client Delivery Portal</small>
              </span>
            </Link>

            <p className="dashboard-nav-label">WORKSPACE</p>

            <nav className="dashboard-nav">
              <Link
                href="/dashboard"
                className={`dashboard-nav-link ${isDashboardActive ? 'selected' : ''}`}
              >
                <span>◫</span> Overview
              </Link>
              <Link
                href="/clients"
                className={`dashboard-nav-link ${isClientsActive ? 'selected' : ''}`}
              >
                <span>♙</span> Clients
              </Link>
              <Link
                href="/projects"
                className={`dashboard-nav-link ${isProjectsActive ? 'selected' : ''}`}
              >
                <span>▤</span> Projects
              </Link>
              {profile?.role !== 'administrator' && (
                <Link
                  href="/discovery"
                  className={`dashboard-nav-link ${isDiscoveryActive ? 'selected' : ''}`}
                >
                  <span>🎙️</span> Discovery Meetings
                </Link>
              )}
              {profile?.role === 'administrator' && (
                <Link
                  href="/admin"
                  className={`dashboard-nav-link ${isAdminActive ? 'selected' : ''}`}
                >
                  <span>⚙</span> Admin
                </Link>
              )}
              <Link
                href="/settings"
                className={`dashboard-nav-link ${isSettingsActive ? 'selected' : ''}`}
              >
                <span>⚙</span> Settings
              </Link>
              <Link
                href="/dashboard"
                className={`dashboard-nav-link ${isHomeActive ? 'selected' : ''}`}
              >
                <span>⌂</span> Home
              </Link>
            </nav>

          <div className="dashboard-sidebar-bottom">
            <div className="dashboard-help">
              <span className="help-symbol">✳</span>
              <strong>Need a hand?</strong>
              <p>Keep your client accounts and deliverables organized.</p>
              <Link href="/clients">Explore clients →</Link>
            </div>

            <button
              className="dashboard-signout"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <span>↪</span>
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-topbar">
            <div>
              <p className="dashboard-breadcrumb">{breadcrumb}</p>
              <h1>{title}</h1>
            </div>

            <div className="portal-topbar-actions">
              {actions}
              <div className="dashboard-account">
                <div className="dashboard-avatar">{initials}</div>
                <div className="dashboard-account-details">
                  <strong>{displayName}</strong>
                  <span>{formatRole(profile.role)}</span>
                </div>
              </div>
            </div>
          </header>

          <div className="portal-page-body">{children}</div>

          <footer className="dashboard-footer">
            <span>Client Serving Portal</span>
            <span>All in one workspace</span>
          </footer>
        </section>
      </main>
    </PortalContext.Provider>
  )
}
