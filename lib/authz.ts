import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// SERVER-ONLY. Never import this module from a client component.
// Caller identity is resolved from the request's Supabase access token and the
// database profile (via the active-aware current_user_role() function), not
// from client-supplied metadata.

export type Role = 'administrator' | 'senior_dev_pm' | 'junior_developer' | 'client'

export const STAFF_ROLES: Role[] = ['senior_dev_pm', 'junior_developer']
export const BUSINESS_ROLES: Role[] = ['senior_dev_pm', 'junior_developer']
export const ALL_ROLES: Role[] = ['administrator', 'senior_dev_pm', 'junior_developer']
/** Roles allowed to read client conversations. Administrators are oversight-only. */
export const MESSAGE_ROLES: Role[] = ['senior_dev_pm', 'junior_developer', 'client']

type ResolvedCaller = {
  user: { id: string; email?: string }
  role: Role
  db: SupabaseClient
}

type CallerResult = { caller: ResolvedCaller; response?: never } | { caller?: never; response: NextResponse }

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

function callerDb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}

/** Resolve the caller from a validated token and their active database role. Fails closed. */
export async function resolveCaller(req: Request): Promise<CallerResult> {
  const token = bearerToken(req)
  if (!token) {
    return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) }
  }

  const db = callerDb(token)
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) {
    return { response: NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 }) }
  }

  const { data: role, error: roleError } = await db.rpc('current_user_role')
  // NULL role means the profile is suspended or missing — deny before any work.
  if (roleError || !role) {
    return {
      response: NextResponse.json(
        { error: 'Your role assignment is inactive or could not be verified.' },
        { status: 403 }
      ),
    }
  }

  return { caller: { user: { id: data.user.id, email: data.user.email }, role: role as Role, db } }
}

/**
 * Gate a route handler by role. Returns a NextResponse to return early when the
 * caller is unauthenticated, suspended, or not in `allowed`; otherwise null.
 */
export async function requireRole(
  req: Request,
  allowed: Role[],
  deniedMessage = 'You do not have permission to perform this operation.'
): Promise<NextResponse | null> {
  const result = await resolveCaller(req)
  if (result.response) return result.response
  if (!allowed.includes(result.caller.role)) {
    return NextResponse.json({ error: deniedMessage }, { status: 403 })
  }
  return null
}

/** Administrators are strictly read-only for business operations. */
export function denyBusinessOperation(
  req: Request,
  allowed: Role[] = BUSINESS_ROLES
): Promise<NextResponse | null> {
  return requireRole(
    req,
    allowed,
    'Administrators have read-only access to clients and projects and cannot perform business operations.'
  )
}

/** Only the oversight role may use user-management and audit endpoints. */
export function requireAdministrator(req: Request): Promise<NextResponse | null> {
  return requireRole(req, ['administrator'], 'Administrator access required.')
}
