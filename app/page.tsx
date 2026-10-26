import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { error } = await supabase.auth.getSession()

  return (
    <main style={{ padding: 40 }}>
      <h1>Client Serving Portal</h1>
      <p>
        {error
          ? 'Supabase connection failed: ' + error.message
          : 'Supabase connected ✅'}
      </p>
      <nav style={{ marginTop: 20, display: 'flex', gap: 16 }}>
        <a href="/login" style={{ color: 'blue', textDecoration: 'underline' }}>Sign in</a>
        <a href="/dashboard" style={{ color: 'blue', textDecoration: 'underline' }}>Dashboard</a>
        <a href="/clients" style={{ color: 'blue', textDecoration: 'underline' }}>Clients</a>
        <a href="/projects" style={{ color: 'blue', textDecoration: 'underline' }}>Projects</a>
      </nav>
    </main>
  )
}