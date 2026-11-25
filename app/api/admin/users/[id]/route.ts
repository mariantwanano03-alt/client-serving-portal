import { NextRequest, NextResponse } from 'next/server'
import { resolveCaller, type Role } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type AccountStatus = 'pending_role_assignment' | 'active' | 'suspended'

const VALID_ROLES: Role[] = ['administrator', 'senior_dev_pm', 'junior_developer', 'client']
// Registration is the only writer of the pending status. An administrator may
// activate or suspend, but may never put an account back into "pending".
const ASSIGNABLE_STATUSES: AccountStatus[] = ['active', 'suspended']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AuditDraft = {
  action: string
  before_value: Record<string, unknown>
  after_value: Record<string, unknown>
}

async function writeAudit(
  db: ReturnType<typeof getSupabaseAdmin>,
  actorUserId: string,
  targetUserId: string,
  draft: AuditDraft
) {
  await db.from('audit_entries').insert({
    actor_user_id: actorUserId,
    action: draft.action,
    entity_type: 'profile',
    entity_id: targetUserId,
    before_value: draft.before_value,
    after_value: draft.after_value,
  })
}

// PATCH /api/admin/users/[id] — the only permitted administrative write.
// Role/status changes are validated and audited server-side; the browser never
// writes profiles or audit records directly. A role assignment on a pending
// account also activates it, so permissions apply on the next request.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolved = await resolveCaller(req)
  if (resolved.response) return resolved.response
  const { caller } = resolved
  if (caller.role !== 'administrator') {
    return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 })
  }

  const db = getSupabaseAdmin()
  const { id } = await params

  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid user identifier.' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const keys = Object.keys(body)
  if (
    !keys.length ||
    keys.some((key) => key !== 'role' && key !== 'is_active' && key !== 'account_status')
  ) {
    return NextResponse.json(
      { error: 'Only role, is_active and account_status may be changed through this endpoint.' },
      { status: 400 }
    )
  }
  if (!('role' in body) && !('is_active' in body) && !('account_status' in body)) {
    return NextResponse.json({ error: 'No changes were provided.' }, { status: 400 })
  }
  if ('role' in body && (!VALID_ROLES.includes(body.role as Role) || typeof body.role !== 'string')) {
    return NextResponse.json({ error: 'Invalid role assignment.' }, { status: 400 })
  }
  if ('is_active' in body && typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active must be a boolean.' }, { status: 400 })
  }
  if (
    'account_status' in body &&
    (typeof body.account_status !== 'string' ||
      !ASSIGNABLE_STATUSES.includes(body.account_status as AccountStatus))
  ) {
    return NextResponse.json({ error: 'Invalid account status.' }, { status: 400 })
  }
  if (
    'is_active' in body &&
    'account_status' in body &&
    body.is_active !== (body.account_status === 'active')
  ) {
    return NextResponse.json({ error: 'Conflicting account status values.' }, { status: 400 })
  }

  // An administrator may never change their own role or status.
  if (id === caller.user.id) {
    await writeAudit(db, caller.user.id, id, {
      action: 'user.admin_action_denied',
      before_value: { attempted: keys },
      after_value: { reason: 'self_modification_denied' },
    }).catch(() => undefined)
    return NextResponse.json(
      { error: 'You cannot change your own role or status.' },
      { status: 403 }
    )
  }

  const { data: target, error: targetError } = await db
    .from('profiles')
    .select('id, full_name, role, is_active, account_status, created_at')
    .eq('id', id)
    .single()

  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  const previousRole = target.role as Role
  const previousActive = Boolean(target.is_active)
  const previousStatus = (target.account_status as AccountStatus) ||
    (previousActive ? 'active' : 'suspended')
  const wasPending = previousStatus === 'pending_role_assignment'

  const nextRole = ('role' in body ? body.role : previousRole) as Role
  let nextStatus: AccountStatus
  if ('account_status' in body) {
    nextStatus = body.account_status as AccountStatus
  } else if ('is_active' in body) {
    nextStatus = body.is_active ? 'active' : 'suspended'
  } else if (wasPending && 'role' in body) {
    // Assigning a role to a pending account is the activation step.
    nextStatus = 'active'
  } else {
    nextStatus = previousStatus
  }
  const nextActive = nextStatus === 'active'

  // A pending account cannot be activated without an explicit role assignment.
  if (wasPending && nextStatus === 'active' && !('role' in body)) {
    return NextResponse.json(
      { error: 'A role must be assigned before activating a pending account.' },
      { status: 400 }
    )
  }

  if (previousRole === nextRole && previousActive === nextActive && previousStatus === nextStatus) {
    return NextResponse.json({ error: 'No changes were provided.' }, { status: 400 })
  }

  // The last active administrator must always remain.
  if (
    previousRole === 'administrator' &&
    previousStatus === 'active' &&
    (nextRole !== 'administrator' || nextStatus !== 'active')
  ) {
    const { count, error: countError } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'administrator')
      .eq('is_active', true)
      .eq('account_status', 'active')

    if (countError) {
      return NextResponse.json({ error: 'Could not verify administrator count.' }, { status: 500 })
    }
    if ((count ?? 0) <= 1) {
      await writeAudit(db, caller.user.id, id, {
        action: 'user.admin_action_denied',
        before_value: { role: previousRole, is_active: previousActive, account_status: previousStatus },
        after_value: { reason: 'last_active_administrator' },
      }).catch(() => undefined)
      return NextResponse.json(
        { error: 'The last active administrator cannot be suspended or demoted.' },
        { status: 403 }
      )
    }
  }

  const { data: updated, error: updateError } = await db
    .from('profiles')
    .update({ role: nextRole, is_active: nextActive, account_status: nextStatus })
    .eq('id', id)
    .select('id, full_name, role, is_active, account_status, created_at')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'Could not update user.' }, { status: 500 })
  }

  const before = {
    role: previousRole,
    is_active: previousActive,
    account_status: previousStatus,
  }
  const after = {
    role: nextRole,
    is_active: nextActive,
    account_status: nextStatus,
  }
  const audits: string[] = []

  if (wasPending && nextStatus === 'active') {
    // Explicit assignment record identifies the administrator who confirmed
    // the role, the previous default role and the new role.
    await writeAudit(db, caller.user.id, id, {
      action: 'user.role_assigned',
      before_value: before,
      after_value: {
        ...after,
        assigned_by: caller.user.id,
        assigned_by_email: caller.user.email || null,
        previous_role: previousRole,
        new_role: nextRole,
      },
    })
    audits.push('user.role_assigned')
    await writeAudit(db, caller.user.id, id, { action: 'user.account_activated', before_value: before, after_value: after })
    audits.push('user.account_activated')
    if (previousRole !== nextRole) {
      await writeAudit(db, caller.user.id, id, { action: 'user.role_changed', before_value: before, after_value: after })
      audits.push('user.role_changed')
    }
  } else {
    if (previousRole !== nextRole) {
      await writeAudit(db, caller.user.id, id, { action: 'user.role_changed', before_value: before, after_value: after })
      audits.push('user.role_changed')
    }
    if (wasPending && nextStatus === 'suspended') {
      await writeAudit(db, caller.user.id, id, { action: 'user.account_suspended', before_value: before, after_value: after })
      audits.push('user.account_suspended')
    } else if (previousActive !== nextActive) {
      const action = nextActive ? 'user.role_reactivated' : 'user.role_suspended'
      await writeAudit(db, caller.user.id, id, { action, before_value: before, after_value: after })
      audits.push(action)
    }
  }

  const { data: authUser } = await db.auth.admin.getUserById(id)
  return NextResponse.json({
    ok: true,
    audits,
    user: {
      id: updated.id as string,
      full_name: (updated.full_name as string) || '',
      email: authUser?.user?.email || null,
      role: updated.role as Role,
      is_active: Boolean(updated.is_active),
      account_status: (updated.account_status as AccountStatus) || 'active',
      created_at: (updated.created_at as string) || null,
    },
  })
}
