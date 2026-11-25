import { NextRequest, NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// GET /api/admin/users — trusted user list for the oversight-only role.
// account_status is returned so the UI can identify accounts awaiting role
// assignment without inventing a second status field on the client.
export async function GET(req: NextRequest) {
  const denied = await requireAdministrator(req)
  if (denied) return denied

  try {
    const db = getSupabaseAdmin()
    const [{ data: profiles, error }, { data: authData, error: authError }] = await Promise.all([
      db
        .from('profiles')
        .select('id, full_name, role, is_active, account_status, created_at')
        .order('created_at', { ascending: false }),
      db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    const emails = new Map((authData?.users || []).map((u) => [u.id, u.email || null]))
    const users = (profiles || []).map((p) => ({
      id: p.id as string,
      full_name: (p.full_name as string) || '',
      email: emails.get(p.id as string) || null,
      role: p.role as 'administrator' | 'senior_dev_pm' | 'junior_developer' | 'client',
      is_active: Boolean(p.is_active),
      account_status: (p.account_status as 'pending_role_assignment' | 'active' | 'suspended') || 'active',
      created_at: (p.created_at as string) || null,
    }))

    return NextResponse.json({ users })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load users.' },
      { status: 500 }
    )
  }
}
