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

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      // Generous timeout: cloud auth can be slow under load. The old 7s limit
      // produced a misleading "backend offline" error during normal use.
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Sign-in timed out. Check your connection and try again.')),
          20000
        )
      })

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

      router.push('/')
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred during sign-in.'
      setErrorMessage(msg)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      // ALWAYS unlock loading state so the button and form are immediately usable
      setLoading(false)
    }
  }

  return (
    <main className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-brand-logo" src="/xspark-logo-on-light.png" alt="X Spark" />
          <span className="auth-brand-name">Client Serving Portal</span>
          <span className="auth-brand-tagline">by X Spark</span>
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

        <div className="auth-signup-prompt">
          <span>Don&apos;t have an account? </span>
          <Link href="/signup" data-testid="signup-link">
            Sign up
          </Link>
        </div>

        <div className="auth-footer">
          <Link href="/">
            <span>←</span> Back to overview
          </Link>
          <span className="auth-security-note">
            Protected workspace · Client Serving Portal for X Spark
          </span>
        </div>
      </div>
    </main>
  )
}
