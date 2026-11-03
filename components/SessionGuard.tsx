'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const CHECK_INTERVAL_MS = 20_000

// Watches the signed-in user's account status and signs them out as soon as
// an Administrator suspends them (PRD BR-01: only authenticated, ACTIVE
// internal users may access the portal). The auth-level ban blocks new
// logins and token refreshes immediately, but an already-open session holds
// a stateless JWT that would otherwise stay valid until expiry — this guard
// closes that gap by re-checking on a short interval plus window focus, so
// every open tab of a suspended user signs itself out within seconds.
export default function SessionGuard() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // The login page handles its own suspension messaging.
    if (pathname?.startsWith('/login')) return

    let cancelled = false

    async function checkSuspended() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user.id
      if (!userId) return

      // RLS allows a user to read their own profile row, so even the
      // suspended account can see the flag that ends its own session.
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', userId)
        .maybeSingle()

      if (!cancelled && profile && profile.is_active === false) {
        await supabase.auth.signOut()
        router.replace('/login?suspended=1')
      }
    }

    checkSuspended()
    const interval = setInterval(checkSuspended, CHECK_INTERVAL_MS)
    // Also check the moment the user interacts (clicks into the tab or
    // switches back to it), so they don't wait out the full interval.
    const onActivity = () => {
      if (document.visibilityState === 'visible') checkSuspended()
    }
    document.addEventListener('visibilitychange', onActivity)
    window.addEventListener('focus', onActivity)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onActivity)
      window.removeEventListener('focus', onActivity)
    }
  }, [pathname, router])

  return null
}
