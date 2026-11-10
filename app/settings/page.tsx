'use client'

import { useState, useEffect } from 'react'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { supabase } from '@/lib/supabase'

export default function SettingsPage() {
  return (
    <PortalShell title="Settings" breadcrumb="WORKSPACE / SETTINGS">
      <SettingsContent />
    </PortalShell>
  )
}

function SettingsContent() {
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [mounted, setMounted] = useState(false)
  
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'dark') {
      setIsDarkMode(true)
      document.documentElement.classList.add('dark')
    } else {
      setIsDarkMode(false)
      document.documentElement.classList.remove('dark')
    }
  }, [])

  if (!mounted) return null

  function toggleDarkMode() {
    const newDarkMode = !isDarkMode
    setIsDarkMode(newDarkMode)
    
    if (newDarkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setStatusMessage(null)

    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    if (newPassword.length < 6) {
      setStatusMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSubmitting(false)

    if (error) {
      setStatusMessage({ type: 'error', text: error.message })
      return
    }

    setStatusMessage({ type: 'success', text: 'Password updated successfully.' })
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <>
      {/* 
        CORRECTED DARK MODE CSS:
        We only target the structural elements (body, cards, sidebar, tables).
        We DO NOT target all divs or spans, so buttons and colored badges keep their visibility.
      */}
           <style jsx global>{`
        /* 1. Base Backgrounds */
        html.dark {
          background-color: #0f172a !important;
          color: #f8fafc !important;
        }
        html.dark body {
          background-color: #0f172a !important;
          color: #f8fafc !important;
        }

        /* 2. Structural Cards & Modals */
        html.dark .portal-card,
        html.dark .auth-card,
        html.dark .portal-drawer {
          background-color: #1e293b !important;
          border-color: #334155 !important;
          color: #f8fafc !important;
        }

        /* 3. Text inside cards (Headers, Paragraphs) */
        html.dark .portal-card h1, 
        html.dark .portal-card h2, 
        html.dark .portal-card h3, 
        html.dark .portal-card h4,
        html.dark .portal-card p,
        html.dark .portal-card label {
          color: #f8fafc !important;
        }

        /* 4. Inputs & Forms */
        html.dark .form-input, 
        html.dark .portal-search-input,
        html.dark textarea {
          background-color: #0f172a !important;
          border-color: #334155 !important;
          color: #f8fafc !important;
        }

        /* 5. Tables */
        html.dark .portal-table th {
          background-color: #0f172a !important;
          color: #94a3b8 !important;
          border-color: #334155 !important;
        }
        html.dark .portal-table td {
          border-color: #334155 !important;
          color: #cbd5e1 !important;
        }

        /* 6. Sidebar */
        html.dark aside, 
        html.dark .portal-sidebar {
          background-color: #020617 !important;
          border-right: 1px solid #1e293b !important;
        }
        
        /* 7. Keep Badges & Primary Buttons Intact */
        /* This ensures that if you have a blue button or a green badge, it stays visible! */
        html.dark .portal-btn-primary {
          background-color: #2563eb !important;
          color: #ffffff !important;
        }
        html.dark .badge-green { background-color: #10b981 !important; color: #ffffff !important; }
        html.dark .badge-amber { background-color: #f59e0b !important; color: #ffffff !important; }
        html.dark .badge-red { background-color: #ef4444 !important; color: #ffffff !important; }
        
        /* 8. Fix any remaining hardcoded white backgrounds */
        html.dark [style*="background-color: #fff"],
        html.dark [style*="background-color: white"],
        html.dark [style*="backgroundColor: '#fff'"],
        html.dark [style*="backgroundColor: 'white'"] {
          background-color: #1e293b !important;
          color: #f8fafc !important;
        }
      `}</style>

      <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
        
        {statusMessage && (
          <div 
            style={{ 
              padding: '16px', 
              borderRadius: '8px', 
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontWeight: 600,
              fontSize: '14px',
              backgroundColor: statusMessage.type === 'error' ? '#ef4444' : '#10b981',
              color: '#ffffff',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }} 
            role="alert"
          >
            <span style={{ fontSize: '18px' }}>{statusMessage.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div style={{ display: 'grid', gap: 24 }}>
          
          {/* Appearance Settings */}
          <div className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3 style={{ color: isDarkMode ? '#f8fafc' : '#14213d' }}>Appearance</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>Customize how the portal looks on your device.</p>
              </div>
            </div>

            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '16px', 
              backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', 
              border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
              borderRadius: '8px',
              marginTop: 12
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: isDarkMode ? '#f8fafc' : '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🌙 Dark Mode
                </span>
                <span style={{ fontSize: '12px', color: isDarkMode ? '#94a3b8' : '#64748b', marginTop: '4px' }}>
                  Your preference is saved automatically and applies across the portal.
                </span>
              </div>
              
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                onClick={toggleDarkMode}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  height: '28px',
                  width: '52px',
                  flexShrink: 0,
                  cursor: 'pointer',
                  borderRadius: '9999px',
                  border: '2px solid transparent',
                  backgroundColor: isDarkMode ? '#2563eb' : '#cbd5e1',
                  transition: 'background-color 0.2s ease-in-out',
                  padding: 0,
                  outline: 'none',
                }}
              >
                <span
                  style={{
                    pointerEvents: 'none',
                    display: 'inline-block',
                    height: '24px',
                    width: '24px',
                    transform: isDarkMode ? 'translateX(24px)' : 'translateX(0px)',
                    borderRadius: '9999px',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    transition: 'transform 0.2s ease-in-out',
                    marginTop: '0px',
                    marginLeft: '0px'
                  }}
                />
              </button>
            </div>
          </div>

          {/* Security Settings */}
          <div className="portal-card">
            <div className="portal-card-header">
              <div>
                <h3 style={{ color: isDarkMode ? '#f8fafc' : '#14213d' }}>Security</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>Update the password for your account.</p>
              </div>
            </div>

            <form onSubmit={handleChangePassword} style={{ display: 'grid', gap: 16, marginTop: 12, maxWidth: 400 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: isDarkMode ? '#f8fafc' : '#14213d' }}>New Password</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)} 
                  placeholder="Enter new password"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: isDarkMode ? '#f8fafc' : '#14213d' }}>Confirm New Password</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={confirmPassword} 
                  onChange={(e) => setConfirmPassword(e.target.value)} 
                  placeholder="Confirm new password"
                  required
                />
              </div>
              <div>
                <button type="submit" className="portal-btn-primary" disabled={submitting}>
                  {submitting ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </>
  )
}