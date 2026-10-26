'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  async function handleSignIn() {
    setMessage('Signing in...')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setMessage('Sign-in failed: ' + error.message)
      return
    }
    router.push('/dashboard')
  }

  return (
    <main style={{ padding: 40, maxWidth: 400 }}>
      <h1>Sign in</h1>
      <p>Client Serving Portal</p>
      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 8, color: 'black' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 8, color: 'black' }}
        />
        <button onClick={handleSignIn} style={{ padding: 10 }}>
          Sign in
        </button>
        <p>{message}</p>
      </div>
    </main>
  )
}