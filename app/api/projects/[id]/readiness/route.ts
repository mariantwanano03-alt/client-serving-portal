import { NextResponse } from 'next/server'
import { ALL_ROLES, requireRole, resolveCaller } from '@/lib/authz'
import { getDevelopmentReadiness } from '@/lib/development-readiness'
import { canAccessProject } from '@/lib/project-access'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/readiness — read-only, human-readable readiness state.
// Internal staff and administrators may view it; clients and suspended users
// are denied before any signed-document data is read.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole(
    req,
    ALL_ROLES,
    'You do not have permission to view development readiness.'
  )
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (resolved.response || !resolved.caller) return resolved.response

  try {
    const { id } = await params
    const admin = getSupabaseAdmin()

    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    if (
      resolved.caller.role === 'junior_developer' &&
      !(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, id))
    ) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const readiness = await getDevelopmentReadiness(admin, id)
    return NextResponse.json(readiness, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load development readiness.' },
      { status: 500 }
    )
  }
}
