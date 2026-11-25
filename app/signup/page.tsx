'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim() || !password) {
      setErrorMessage('Please enter an email address.')
      return
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setLoading(true)
    setErrorMessage('')

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
      })

      if (error) {
        setErrorMessage(error.message)
        setLoading(false)
        return
      }

      // When email confirmation is disabled the session is returned directly.
      // If confirmation is required, try signing in so local test accounts work.
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        })
        if (signInError) {
          setErrorMessage(signInError.message)
          setLoading(false)
          return
        }
      }

      router.push('/')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.'
      setErrorMessage(msg)
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
          <h1>Create Account</h1>
          <p>Sign up to access the Client Serving Portal</p>
        </div>

        <form onSubmit={handleSignUp} className="auth-form">
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
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password-input">
              Confirm Password
            </label>
            <input
              id="confirm-password-input"
              type="password"
              className="form-input"
              placeholder="••••••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="confirm-password"
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
          >
            {loading ? (
              <>
                <span>⏳</span> Creating account...
              </>
            ) : (
              <>
                <span>Create account</span>
                <span>→</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <Link href="/login">
            <span>←</span> Already have an account?
          </Link>
          <span className="auth-security-note">
            Protected workspace · Client Serving Portal for X Spark
          </span>
        </div>
      </div>
    </main>
  )
}
