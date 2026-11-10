'use client'

import React, { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

function LoginPageContent() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const searchParams = useSearchParams()
  const suspendedNotice = searchParams.get('suspended') === '1'

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.')
      return
    }

    setLoading(true)
    setErrorMessage('')

    try {
      const timeoutPromise = new Promise<{ error: { message: string } }>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Connection timed out. Could not reach Supabase backend. Please ensure your Supabase instance is running.'
              )
            ),
          7000
        )
      )

      const authPromise = supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      const res = (await Promise.race([authPromise, timeoutPromise])) as {
        data?: { session: unknown }
        error?: { message: string } | null
      }

      if (res?.error) {
        setErrorMessage(
          /banned/i.test(res.error.message)
            ? 'This account is suspended. Please contact an administrator.'
            : res.error.message
        )
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user.id
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('id', userId)
          .maybeSingle()
        if (profile && profile.is_active === false) {
          await supabase.auth.signOut()
          setErrorMessage('This account is suspended. Please contact an administrator.')
          return
        }
      }

      const nextParam = new URLSearchParams(window.location.search).get('next')
      const destination =
        nextParam &&
        nextParam.startsWith('/') &&
        !nextParam.startsWith('//') &&
        !nextParam.startsWith('/login')
          ? nextParam
          : '/dashboard'

      router.push(destination)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred during sign-in.'
      setErrorMessage(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-icon">C</div>
          <span className="auth-brand-name">Client Serving Portal</span>
          <span className="auth-brand-tagline">Client Delivery Portal</span>
        </div>

        <div className="auth-heading">
          <h1>Sign in</h1>
          <p>Enter your workspace credentials to continue</p>
        </div>

        <form onSubmit={handleSignIn} className="auth-form">
          {suspendedNotice && (
            <div className="auth-alert-error" role="alert">
              <span>🔒</span>
              <div>Your session was ended because this account is suspended. Please contact an administrator.</div>
            </div>
          )}

          {/* HIGHLY VISIBLE ERROR BANNER */}
          {errorMessage && (
            <div 
              style={{ 
                padding: '12px 16px', 
                borderRadius: '8px', 
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontWeight: 600,
                fontSize: '14px',
                backgroundColor: '#ef4444', // Solid Red
                color: '#ffffff', // White text
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }} 
              role="alert"
            >
              <span style={{ fontSize: '18px' }}>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email-input">
              Email address
            </label>
            <input
              id="email-input"
              type="email"
              className="form-input"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password-input">
              Password
            </label>
            <input
              id="password-input"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <span>⏳</span> Signing in...
              </>
            ) : (
              <>
                <span>Sign in</span>
                <span>→</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <Link href="/">
            <span>←</span> Back to overview
          </Link>
          <span className="auth-security-note">
            Protected workspace · Client Serving Portal v1.0
          </span>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}