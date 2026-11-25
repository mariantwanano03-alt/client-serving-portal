import { NextResponse } from 'next/server'
import { requireAdministrator, resolveCaller } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { writeAudit } from '@/lib/audit'

// Administrator-only developer reassignment. The assignment is written to the
// real assignments relationship through the database functions that already
// enforce the assignment matrix; admins still cannot make other business edits.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdministrator(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const { id } = await params
    const body = await req.json()
    const developerUserId = typeof body?.developer_user_id === 'string' ? body.developer_user_id : ''
    if (!developerUserId) {
      return NextResponse.json({ error: 'Choose a developer to assign.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, name, project_reference')
      .eq('id', id)
      .maybeSingle()
    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    const { data: developer, error: developerError } = await admin
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('id', developerUserId)
      .maybeSingle()
    if (developerError || !developer) {
      return NextResponse.json({ error: 'Developer not found.' }, { status: 404 })
    }
    if (
      !developer.is_active ||
      !['senior_dev_pm', 'junior_developer'].includes(developer.role)
    ) {
      return NextResponse.json(
        { error: 'Only an active senior developer or junior developer can be assigned.' },
        { status: 400 }
      )
    }

    const isSenior = developer.role === 'senior_dev_pm'

    const { data: current } = await admin
      .from('assignments')
      .select('id, developer_user_id')
      .eq('project_id', id)
      .eq('is_active', true)
      .maybeSingle()

    if (current?.id) {
      const { error: revokeError } = await admin.rpc('remove_project_assignment', {
        p_assignment_id: current.id,
      })
      if (revokeError) {
        return NextResponse.json({ error: revokeError.message }, { status: 500 })
      }
    }

    const { error: assignError } = await admin.rpc('assign_project_developer', {
      p_project_id: id,
      p_user_id: developerUserId,
    })
    if (assignError) {
      return NextResponse.json({ error: assignError.message }, { status: 500 })
    }

    const { data: newAssignment, error: newAssignmentError } = await admin
      .from('assignments')
      .select('id')
      .eq('project_id', id)
      .eq('developer_user_id', developerUserId)
      .eq('is_active', true)
      .maybeSingle()
    if (newAssignmentError || !newAssignment) {
      return NextResponse.json(
        { error: 'The assignment could not be confirmed.' },
        { status: 500 }
      )
    }

    const { error: updateError } = await admin
      .from('assignments')
      .update({
        assigned_by: resolved.caller.user.id,
        assignment_role: isSenior ? 'lead' : 'developer',
        approval_authority: isSenior,
      })
      .eq('id', newAssignment.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await writeAudit(resolved.caller.db, {
      action: 'project.developer_assigned',
      entity_type: 'project',
      entity_id: id,
      before_value: current?.developer_user_id
        ? { previous_developer: current.developer_user_id }
        : null,
      after_value: {
        developer_user_id: developerUserId,
        developer: developer.full_name || developer.email || 'Team member',
        role: developer.role,
        project: project.name,
        assigned_by_administrator: true,
      },
    })

    return NextResponse.json({
      message: `${project.name} assigned to ${developer.full_name || developer.email || 'the selected developer'}.`,
      assignment: {
        id: newAssignment.id,
        developer_user_id: developerUserId,
        developer_name: developer.full_name || developer.email || '',
        approval_authority: isSenior,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to reassign developer.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
