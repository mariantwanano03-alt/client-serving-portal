'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.')
      return
    }

    setLoading(true)
    setErrorMessage('')

    try {
      // 7-second timeout to prevent indefinite hangs if the local backend is offline
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
        setErrorMessage(res.error.message)
        return
      }

      router.push('/dashboard')
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred during sign-in.'
      setErrorMessage(msg)
    } finally {
      // ALWAYS unlock loading state so the button and form are immediately usable
      setLoading(false)
    }
  }

  return (
    <main className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-icon">C</div>
          <span className="auth-brand-name">ClientFlow</span>
          <span className="auth-brand-tagline">Client Serving Portal</span>
        </div>

        <div className="auth-heading">
          <h1>Sign in</h1>
          <p>Enter your workspace credentials to continue</p>
        </div>

        <form onSubmit={handleSignIn} className="auth-form">
          {errorMessage && (
            <div className="auth-alert-error" role="alert">
              <span>⚠️</span>
              <div>{errorMessage}</div>
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

          <button
            type="submit"
            className="auth-submit-btn"
          >
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
            Protected workspace · ClientFlow v1.0
          </span>
        </div>
      </div>
    </main>
  )
}
