import { NextResponse } from 'next/server'
import { requireRole, resolveCaller } from '@/lib/authz'
import { writeAudit } from '@/lib/audit'
import { getDevelopmentReadiness } from '@/lib/development-readiness'
import { canAccessProject } from '@/lib/project-access'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/projects/[id]/development/begin
// The only API path that moves a project into development. It is senior-only
// and re-checks every prerequisite server-side; the database trigger is the
// final enforcement layer if someone attempts a direct status update.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole(
    req,
    ['senior_dev_pm'],
    'Only Senior Developers / Project Managers can begin development.'
  )
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (resolved.response || !resolved.caller) return resolved.response

  try {
    const { id } = await params
    const admin = getSupabaseAdmin()

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, name, stage, status')
      .eq('id', id)
      .maybeSingle()
    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    if (!(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, id))) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const readiness = await getDevelopmentReadiness(admin, id)
    if (!readiness.ready) {
      await writeAudit(resolved.caller.db, {
        action: 'development.gate_denied',
        entity_type: 'project',
        entity_id: id,
        after_value: {
          project_name: project.name,
          outcome: 'locked',
        },
      })
      return NextResponse.json(
        {
          error: 'Development is locked until every mandatory prerequisite is complete.',
          readiness,
        },
        { status: 409 }
      )
    }

    if ((project.stage || '').toLowerCase() !== 'development') {
      const { error: updateError } = await admin
        .from('projects')
        .update({ stage: 'development', status: 'in_progress' })
        .eq('id', id)
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    const { data: check } = await admin
      .from('readiness_checks')
      .upsert(
        { project_id: id, run_by: resolved.caller.user.id, result: 'ready' },
        { onConflict: 'project_id' }
      )
      .select('id')
      .single()

    if (check) {
      await admin.from('readiness_items').delete().eq('readiness_check_id', check.id)
      await admin.from('readiness_items').insert(
        readiness.prerequisites.map((item) => ({
          readiness_check_id: check.id,
          criterion: item.label,
          mandatory: true,
          overridable: false,
          result: item.complete ? 'met' : 'outstanding',
        }))
      )
    }

    await writeAudit(resolved.caller.db, {
      action: 'sla.signature_verified',
      entity_type: 'project',
      entity_id: id,
      after_value: {
        project_name: project.name,
        verified_date: readiness.clientAgreement.signedAt,
      },
    })
    await writeAudit(resolved.caller.db, {
      action: 'development.readiness_changed',
      entity_type: 'project',
      entity_id: id,
      after_value: { project_name: project.name, outcome: 'ready' },
    })
    await writeAudit(resolved.caller.db, {
      action: 'project.development_started',
      entity_type: 'project',
      entity_id: id,
      after_value: { project_name: project.name },
    })

    return NextResponse.json({
      message: 'All prerequisites are complete. Development is now ready to begin.',
      readiness: { ...readiness, development: 'ready' },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not begin development.' },
      { status: 500 }
    )
  }
}
