'use client'

import { useState, useEffect } from 'react'
import PortalShell from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

export default function Settings() {
  const [darkMode, setDarkMode] = useState(() => {
    // Server-side rendering guard
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('dark-mode')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    localStorage.setItem('dark-mode', darkMode)
    document.documentElement.classList.toggle('dark', darkMode)
    document.documentElement.classList.toggle('light', !darkMode)
  }, [darkMode])

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  const toggleDarkMode = () => setDarkMode((prev) => !prev)

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setPasswordError('')
    setPasswordSuccess('')

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        setPasswordError(error.message)
      } else {
        setPasswordSuccess('Password updated successfully!')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setShowChangePassword(false)
      }
    } catch (err: unknown) {
      setPasswordError(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
    }
  }

  return (
    <PortalShell title="Settings" breadcrumb="WORKSPACE / SETTINGS">
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '40px',
          textAlign: 'center',
          background: darkMode ? '#14213d' : '#f5f7fb',
          color: darkMode ? '#fff' : '#18243a',
        }}
      >
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            margin: '0 0 16px',
          }}
        >
          Settings
        </h1>

        <div style={{ margin: '32px 0', textAlign: 'left', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
          {/* Dark Mode Section */}
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '13px',
              fontWeight: 600,
              color: darkMode ? '#cbd5e1' : '#334155',
            }}
          >
            Dark mode
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderRadius: '10px',
              background: darkMode ? '#1e293b' : '#f1f5f9',
              border: `1px solid ${darkMode ? '#334155' : '#e2e8f0'}`,
            }}
          >
            <span
              style={{
                color: darkMode ? '#94a3b8' : '#64748b',
                fontSize: '13px',
              }}
            >
              Dark mode
            </span>
            <button
              onClick={toggleDarkMode}
              style={{
                background: 'none',
                border: 'none',
                color: darkMode ? '#3b82f6' : '#1d4ed8',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px',
              }}
            >
              {darkMode ? 'Light' : 'Dark'}
            </button>
          </div>
          <p
            style={{
              marginTop: '12px',
              fontSize: '11px',
              color: darkMode ? '#64748b' : '#94a3b8',
              textAlign: 'center',
            }}
          >
            Saved to preferences
          </p>

          {/* Change Password Section */}
          <div style={{ margin: '32px 0' }}>
            <button
              onClick={() => setShowChangePassword(true)}
              style={{
                width: '100%',
                marginBottom: '16px',
                textAlign: 'left',
                padding: '12px 16px',
                borderRadius: '10px',
                background: '#f3f4f6',
                border: '1px solid #e5e7eb',
                color: '#1f2937',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              Change password
              <span>→</span>
            </button>

            {showChangePassword && (
              <div
                style={{
                  background: darkMode ? '#1e293b' : '#fff',
                  border: `1px solid ${darkMode ? '#334155' : '#e5e7eb'}`,
                  borderRadius: '12px',
                  padding: '24px',
                  maxWidth: 400,
                  margin: '0 auto',
                }}
              >
                <h2
                  style={{
                    margin: '0 0 20px',
                    fontSize: '18px',
                    fontWeight: 700,
                    color: darkMode ? '#fff' : '#1f2937',
                  }}
                >
                  Change your password
                </h2>

                {passwordError && (
                  <div
                    style={{
                      background: darkMode ? '#fef2f2' : '#fee2e2',
                      border: `1px solid ${darkMode ? '#b91c1c' : '#fca5a5'}`,
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '16px',
                      color: darkMode ? '#fecaca' : '#b91c1c',
                      fontSize: '13px',
                    }}
                  >
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div
                    style={{
                      background: darkMode ? '#10b981' : '#d1f2eb',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '16px',
                      color: darkMode ? '#fff' : '#052e1f',
                      fontSize: '13px',
                    }}
                  >
                    {passwordSuccess}
                  </div>
                )}

                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: darkMode ? '#cbd5e1' : '#334155',
                    }}
                  >
                    Current password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="form-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      background: darkMode ? '#1f2937' : '#f9fafb',
                      color: darkMode ? '#f9fafb' : '#111827',
                      fontSize: '14px',
                      marginBottom: '16px',
                    }}
                    required
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: darkMode ? '#cbd5e1' : '#334155',
                    }}
                  >
                    New password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      background: darkMode ? '#1f2937' : '#f9fafb',
                      color: darkMode ? '#f9fafb' : '#111827',
                      fontSize: '14px',
                      marginBottom: '16px',
                    }}
                    required
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '6px',
      fontSize: '13px',
      fontWeight: 600,
      color: darkMode ? '#cbd5e1' : '#334155',
    }}
                  >
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      background: darkMode ? '#1f2937' : '#f9fafb',
                      color: darkMode ? '#f9fafb' : '#111827',
                      fontSize: '14px',
                      marginBottom: '16px',
                    }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowChangePassword(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: darkMode ? '#6b7280' : '#6b7280',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleChangePassword}
                    style={{
                      background: '#4f46e5',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Update password
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalShell>
  )
}