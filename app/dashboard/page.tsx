'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Profile = { full_name: string; role: string }

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.push('/login')
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', userData.user.id)
        .single()
      if (error) {
        setMessage('Could not load profile: ' + error.message)
        return
      }
      setProfile(data)
    }
    load()
  }, [router])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!profile) return <main style={{ padding: 40 }}>{message}</main>

  return (
    <main style={{ padding: 40 }}>
      <h1>Dashboard</h1>
      <p>Welcome, {profile.full_name}</p>
      <p>Role: {profile.role}</p>
      <nav style={{ marginTop: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href="/clients" style={{ color: 'blue', textDecoration: 'underline' }}>Clients</a>
        <a href="/projects" style={{ color: 'blue', textDecoration: 'underline' }}>Projects</a>
      </nav>
      <button onClick={handleSignOut} style={{ padding: 10, marginTop: 20 }}>
        Sign out
      </button>
    </main>
  )
}