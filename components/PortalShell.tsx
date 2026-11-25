'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export type AccountStatus = 'pending_role_assignment' | 'active' | 'suspended'

export type UserProfile = {
  id: string
  full_name: string
  role: string
  is_active?: boolean
  account_status?: AccountStatus
}

export interface PortalContextValue {
  user: User | null
  profile: UserProfile | null
  role: string
  loading: boolean
  /** True while sign-out is invalidating the session and clearing the profile. */
  signingOut: boolean
  refreshProfile: () => Promise<void>
  /** True when the signed-in user has the oversight-only administrator role. */
  isAdministrator: boolean
  /** True while an administrator has not yet assigned the user's role. */
  isPending: boolean
  /** True when the signed-in user's profile is deactivated. */
  isSuspended: boolean
  /** True only for an active administrator. */
  canManageUsers: boolean
  /** True only for an active, non-administrator staff member. */
  canPerformBusinessOps: boolean
}

const PortalContext = createContext<PortalContextValue>({
  user: null,
  profile: null,
  role: '',
  loading: true,
  signingOut: false,
  refreshProfile: async () => {},
  isAdministrator: false,
  isPending: false,
  isSuspended: false,
  canManageUsers: false,
  canPerformBusinessOps: false,
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
    case 'client':
      return 'Client'
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

type NavItem = { href: string; label: string; icon: string; messageBadge?: boolean }

// The drawer shows only destinations the existing RLS policies and route
// guards already authorise. Navigation visibility is never an authorisation
// boundary; the route guard and Supabase policies remain unchanged.
const ADMIN_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/dashboard', label: 'Dashboard', icon: '◫' },
  { href: '/clients', label: 'Clients', icon: '♙' },
  { href: '/projects', label: 'Projects', icon: '▤' },
  { href: '/financials', label: 'Financial Records', icon: '◈' },
  { href: '/admin', label: 'User Management', icon: '🛡' },
  { href: '/audit', label: 'Audit Trails', icon: '📜' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

const SENIOR_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/projects', label: 'Projects', icon: '▤' },
  { href: '/clients', label: 'Clients', icon: '♙' },
  { href: '/financials', label: 'Financial Records', icon: '◈' },
  { href: '/messages', label: 'Messages', icon: '✉', messageBadge: true },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

const JUNIOR_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/projects', label: 'My Assigned Projects', icon: '▤' },
  { href: '/clients', label: 'Clients', icon: '♙' },
  { href: '/financials', label: 'Financial Records', icon: '◈' },
  { href: '/messages', label: 'Messages', icon: '✉', messageBadge: true },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

const CLIENT_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/messages', label: 'Messages', icon: '✉', messageBadge: true },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

const ADMIN_ONLY_PATHS = ['/admin', '/audit']
const BUSINESS_OP_PATHS = ['/create-project']
// Clients are limited to the client-facing home, messages and settings. These
// routes are internal workspace areas even when no navigation link exposes them.
const CLIENT_DENIED_PATHS = [
  '/dashboard', '/projects', '/clients', '/financials', '/create-project', '/admin', '/audit',
]

function navItemsFor(role: string, isAdministrator: boolean): NavItem[] {
  if (isAdministrator) return ADMIN_NAV
  if (role === 'senior_dev_pm') return SENIOR_NAV
  if (role === 'junior_developer') return JUNIOR_NAV
  if (role === 'client') return CLIENT_NAV
  return JUNIOR_NAV
}

function isOnPath(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function matchesAnyPath(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
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
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isPending = profile?.account_status === 'pending_role_assignment'
  // Pending accounts are intentionally inactive in the database; they must see
  // the pending screen rather than the suspended screen.
  const isSuspended = !isPending && (
    profile?.account_status === 'suspended' || profile?.is_active === false
  )
  const isAdministrator = profile?.role === 'administrator'
  const canManageUsers = Boolean(profile) && isAdministrator && !isSuspended && !isPending
  const canPerformBusinessOps = Boolean(profile) && !isAdministrator && !isSuspended && !isPending

  const loadProfile = useCallback(async () => {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError || !userData.user) {
        router.replace('/login')
        return
      }

      setUser(userData.user)

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active, account_status')
        .eq('id', userData.user.id)
        .single()

      if (error) {
        setMessage('Could not load profile: ' + error.message)
        setLoading(false)
        return
      }

      setProfile(data as UserProfile)
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
          router.replace('/login')
          return
        }

        setUser(userData.user)

        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role, is_active, account_status')
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

  // Client-side route guard. Pending accounts never reach a protected route;
  // administrators are oversight-only, and staff have no governance pages.
  useEffect(() => {
    if (loading || !profile || isPending || isSuspended) return

    if (isAdministrator && matchesAnyPath(pathname, BUSINESS_OP_PATHS)) {
      router.replace('/')
      return
    }

    if (!isAdministrator && matchesAnyPath(pathname, ADMIN_ONLY_PATHS)) {
      router.replace('/')
      return
    }

    if (profile.role === 'client' && matchesAnyPath(pathname, CLIENT_DENIED_PATHS)) {
      router.replace('/')
    }
  }, [loading, profile, isAdministrator, isPending, isSuspended, pathname, router])

  // The drawer is transient UI: its links close it directly, and browser
  // back/forward history closes it too. It never reserves layout space.
  useEffect(() => {
    function closeOnHistoryChange() {
      setDrawerOpen(false)
    }
    window.addEventListener('popstate', closeOnHistoryChange)
    return () => window.removeEventListener('popstate', closeOnHistoryChange)
  }, [])

  useEffect(() => {
    if (!drawerOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [drawerOpen])

  // Unread client messages are scoped by the same RLS-protected API as the
  // inbox itself. Administrators and pending accounts never make this request.
  useEffect(() => {
    // Do not read the badge while the profile is loading or while sign-out is
    // invalidating the token. A request started in either window can return a
    // 401 after the next session has already been created.
    if (loading || signingOut || !profile || isAdministrator || isPending || isSuspended) return
    let active = true
    const controller = new AbortController()

    async function loadUnread() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const response = await fetch('/api/messages', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const payload = (await response.json()) as { total_unread?: number }
        if (active) setUnreadMessages(payload.total_unread ?? 0)
      } catch {
        // Keep the last known count rather than breaking the whole shell.
      }
    }

    loadUnread()
    window.addEventListener('client-messages:changed', loadUnread)
    return () => {
      active = false
      controller.abort()
      window.removeEventListener('client-messages:changed', loadUnread)
    }
  }, [loading, signingOut, profile, isAdministrator, isPending, isSuspended, pathname])

  async function handleSignOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage('Could not sign out: ' + error.message)
      setSigningOut(false)
      return
    }

    // Clear the portal context before the route changes so child components
    // cannot issue one last authorised-looking request with the dead session.
    setProfile(null)
    setUser(null)
    setUnreadMessages(0)
    setDrawerOpen(false)
    setLoading(false)
    setSigningOut(false)
    router.push('/login')
  }

  const displayName = profile?.full_name?.trim() || 'User'
  const firstName = displayName.split(/\s+/)[0] || 'User'
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  if (loading || !profile) {
    return (
      <main className="dashboard-loading">
        <div className="loading-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="loading-logo" src="/xspark-logo-on-light.png" alt="X Spark" />
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

  // A pending account has a role value (the junior default) but no permission
  // to use it. Render only this screen — no navigation, no data, no actions —
  // until an administrator confirms the real role and activates the account.
  if (isPending) {
    return (
      <main className="dashboard-loading" data-testid="pending-role-screen">
        <div className="loading-card pending-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="loading-logo" src="/xspark-logo-on-light.png" alt="X Spark" />
          <h2>Your account has been created successfully.</h2>
          <div className="readonly-banner" data-testid="pending-role-banner" role="status">
            <span aria-hidden="true">⏳</span>
            <span>
              Your account is awaiting role assignment by an Administrator. You will receive
              access to the appropriate areas of the Client Serving Portal once your account
              has been reviewed.
            </span>
          </div>
          <p className="pending-help-text">
            Please contact your system administrator if you require assistance.
          </p>
          <button
            type="button"
            className="dashboard-button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {message.startsWith('Could not sign out') && <p>{message}</p>}
        </div>
      </main>
    )
  }

  // Suspended profiles get a dedicated read-only screen: no navigation,
  // no actions, no access to any workspace content.
  if (isSuspended) {
    return (
      <main className="dashboard-loading" data-testid="role-suspended-screen">
        <div className="loading-card suspended-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="loading-logo" src="/xspark-logo-on-light.png" alt="X Spark" />
          <h2>Role suspended</h2>
          <div className="readonly-banner" data-testid="role-suspended-banner" role="alert">
            <span aria-hidden="true">🔒</span>
            <span>
              Your role has been suspended. Access is read-only and all navigation and
              business actions are blocked until an administrator reactivates your role.
            </span>
          </div>
          <button
            type="button"
            className="dashboard-button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {message.startsWith('Could not sign out') && <p>{message}</p>}
        </div>
      </main>
    )
  }

  const navItems = navItemsFor(profile.role, isAdministrator)

  return (
    <PortalContext.Provider
      value={{
        user,
        profile,
        role: profile.role || '',
        loading,
        signingOut,
        refreshProfile: loadProfile,
        isAdministrator,
        isPending,
        isSuspended,
        canManageUsers,
        canPerformBusinessOps,
      }}
    >
      <main className="dashboard-shell">
        <header className="portal-header" data-testid="portal-header">
          <Link href="/" className="portal-brand" aria-label="Client Serving Portal home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="xspark-logo xspark-logo-on-light" src="/xspark-logo-on-light.png" alt="X Spark" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="xspark-logo xspark-logo-on-dark" src="/xspark-logo-on-dark.png" alt="" aria-hidden="true" />
            <span className="portal-brand-text">
              <strong>Client Serving Portal</strong>
              <small>by X Spark</small>
            </span>
          </Link>

          <div className="portal-header-right">
            <p className="portal-welcome">
              Welcome, <strong>{firstName}</strong>
            </p>
            <div className="dashboard-account">
              <div className="dashboard-avatar">{initials}</div>
              <div className="dashboard-account-details">
                <strong>{displayName}</strong>
                <span>{formatRole(profile.role)}</span>
              </div>
            </div>
            <button
              type="button"
              className="portal-menu-button"
              data-testid="menu-toggle"
              aria-label="Open navigation menu"
              aria-controls="portal-nav-drawer"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <span className="hamburger-lines" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </header>

        <div
          className={`portal-drawer-overlay ${drawerOpen ? 'open' : ''}`}
          data-testid="nav-overlay"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <aside
          id="portal-nav-drawer"
          className={`portal-drawer ${drawerOpen ? 'open' : ''}`}
          data-testid="nav-drawer"
          aria-label="Navigation menu"
          aria-hidden={!drawerOpen}
        >
          <div className="portal-drawer-head">
            <div className="portal-drawer-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="xspark-logo xspark-logo-on-light" src="/xspark-logo-on-light.png" alt="X Spark" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="xspark-logo xspark-logo-on-dark" src="/xspark-logo-on-dark.png" alt="" aria-hidden="true" />
              <span>
                <strong>Client Serving Portal</strong>
                <small>by X Spark</small>
              </span>
            </div>
            <button
              type="button"
              className="portal-drawer-close"
              data-testid="drawer-close"
              aria-label="Close navigation menu"
              onClick={() => setDrawerOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <p className="dashboard-nav-label">WORKSPACE</p>

          <nav className="dashboard-nav" aria-label="Workspace navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`dashboard-nav-link ${isOnPath(pathname, item.href) ? 'selected' : ''}`}
                data-testid={item.messageBadge ? 'messages-nav-link' : undefined}
                onClick={() => setDrawerOpen(false)}
              >
                <span aria-hidden="true">{item.icon}</span> {item.label}
                {item.messageBadge && unreadMessages > 0 && (
                  <span className="dashboard-nav-badge" data-testid="messages-nav-badge">
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="portal-drawer-foot">
            <span className="portal-drawer-user">
              Signed in as <strong>{displayName}</strong>
              <small>{formatRole(profile.role)} · X Spark</small>
            </span>
            <button
              type="button"
              className="dashboard-signout"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label="Sign out"
            >
              <span aria-hidden="true">↗</span>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </aside>

        <section className="dashboard-main">
          <div className="dashboard-topbar">
            <div>
              <p className="dashboard-breadcrumb">{breadcrumb}</p>
              <h1>{title}</h1>
            </div>

            <div className="portal-topbar-actions">
              {actions}
            </div>
          </div>

          <div className="portal-page-body">
            {children}
          </div>

          <footer className="dashboard-footer">
            <span>Client Serving Portal</span>
            <span>Created for X Spark · All in one workspace</span>
          </footer>
        </section>
      </main>
    </PortalContext.Provider>
  )
}
