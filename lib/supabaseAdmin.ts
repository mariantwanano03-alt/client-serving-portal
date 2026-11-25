import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY. The service-role key must never be imported by a client component
// or exposed through NEXT_PUBLIC_*. Only trusted admin route handlers use this.
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
