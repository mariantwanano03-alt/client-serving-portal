'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import PortalShell from '@/components/PortalShell'

type Theme = 'light' | 'dark'

export default function Settings() {
  const [theme, setTheme] = useState<Theme>('light')
  const [themeReady, setThemeReady] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [changePasswordMessage, setChangePasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Load the saved preference on mount (bootstrap has already applied the class).
  // localStorage is the source of truth: the live database has no theme column,
  // so querying/updating it would only produce noisy 400 responses.
  useEffect(() => {
    const saved = (localStorage.getItem('cf-theme') as Theme | null) || 'light'
    setTheme(saved)
    document.documentElement.classList.toggle('dark', saved === 'dark')
    setThemeReady(true)
  }, [])

  const applyTheme = useCallback((next: Theme) => {
    setTheme(next)
    localStorage.setItem('cf-theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }, [])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.trim()) {
      setResetMessage({ type: 'error', text: 'Email address is required.' })
      return
    }
    setResetLoading(true)
    setResetMessage(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/login`,
      })
      setResetLoading(false)
      if (error) {
        setResetMessage({ type: 'error', text: error.message })
        return
      }
      setResetMessage({ type: 'success', text: 'Password reset email sent. Check your inbox.' })
      setResetEmail('')
    } catch (err: unknown) {
      setResetLoading(false)
      setResetMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPassword.trim()) {
      setChangePasswordMessage({ type: 'error', text: 'Current password is required.' })
      return
    }
    if (newPassword.length < 6) {
      setChangePasswordMessage({ type: 'error', text: 'New password must be at least 6 characters.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordMessage({ type: 'error', text: 'New passwords do not match.' })
      return
    }

    setChangePasswordLoading(true)
    setChangePasswordMessage(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setChangePasswordMessage({ type: 'error', text: error.message })
        return
      }
      setChangePasswordMessage({ type: 'success', text: 'Password updated successfully!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      setChangePasswordMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    } finally {
      setChangePasswordLoading(false)
    }
  }

  return (
    <PortalShell title="Settings" breadcrumb="WORKSPACE / SETTINGS">
      <div className="settings-page">
        <h1 className="settings-title">
          Settings
        </h1>

        {/* Appearance */}
        <div className="settings-card">
          <h2 className="settings-section-title">
            Appearance
          </h2>
          <p className="settings-section-desc">
            Choose a theme. The whole workspace updates instantly and your choice is remembered.
          </p>
          <div className="theme-switcher">
            {(['light', 'dark'] as Theme[]).map((option) => {
              const active = theme === option
              return (
                <button
                  key={option}
                  type="button"
                  data-testid={`theme-${option}`}
                  data-theme={option}
                  aria-pressed={active}
                  onClick={() => applyTheme(option)}
                  className={`theme-option ${active ? 'active' : ''} ${themeReady ? '' : 'pending'}`}
                >
                  <span className="theme-option-icon" aria-hidden="true">
                    {option === 'light' ? '☀' : '☾'}
                  </span>
                  <span className="theme-option-label">
                    {option === 'light' ? 'Light Mode' : 'Dark Mode'}
                  </span>
                  <span className="theme-option-check" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                </button>
              )
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
            Current theme: <strong style={{ color: 'var(--heading)' }}>{themeReady ? theme : 'loading…'}</strong>
            {' '}· Applied across every page, including after refresh.
          </p>
        </div>

        {/* Change password */}
        <div className="settings-card">
          <h2 className="settings-section-title">
            Account &amp; Security
          </h2>
          <p className="settings-section-desc">
            Change your password using Supabase Auth.
          </p>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="current-password">Current Password</label>
              <input
                id="current-password"
                type="password"
                className="form-input"
                placeholder="Enter your current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                className="form-input"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirm-new-password">Confirm New Password</label>
              <input
                id="confirm-new-password"
                type="password"
                className="form-input"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button type="submit" className="portal-btn-primary" disabled={changePasswordLoading} style={{ height: 36, fontSize: 12 }}>
                {changePasswordLoading ? 'Updating…' : 'Change Password'}
              </button>
              {changePasswordMessage && (
                <span style={{ fontSize: 12, color: changePasswordMessage.type === 'success' ? 'var(--success-text)' : 'var(--error-text)' }}>
                  {changePasswordMessage.type === 'success' ? '✓' : '✗'} {changePasswordMessage.text}
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Reset password */}
        <div className="settings-card">
          <h2 className="settings-section-title">
            Password Reset
          </h2>
          <p className="settings-section-desc">
            Receive a secure reset link by email.
          </p>
          <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="reset-email">Email address</label>
              <input
                id="reset-email"
                type="email"
                className="form-input"
                placeholder="name@company.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="portal-btn-primary" disabled={resetLoading} style={{ height: 36, fontSize: 12 }}>
              {resetLoading ? 'Sending…' : 'Send Reset Email'}
            </button>
          </form>
          {resetMessage && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 8,
                background: resetMessage.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
                color: resetMessage.type === 'success' ? 'var(--success-text)' : 'var(--error-text)',
                fontSize: 13,
              }}
            >
              {resetMessage.text}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
