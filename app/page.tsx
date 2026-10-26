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
    </main>
  )
}