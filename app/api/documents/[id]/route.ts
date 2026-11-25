import { NextResponse } from 'next/server'
import { ALL_ROLES, denyBusinessOperation, requireRole, resolveCaller } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { canAccessProject } from '@/lib/project-access'
import { writeAudit } from '@/lib/audit'

async function loadDocument(admin: ReturnType<typeof getSupabaseAdmin>, id: string) {
  const { data, error } = await admin
    .from('documents')
    .select('id, project_id, title, type, status, current_revision_id, created_at, sent_to_client_at')
    .eq('id', id)
    .maybeSingle()
  return { document: error ? null : data, error }
}

// GET /api/documents/[id] — editable source plus review metadata for the portal
// editor and review screen. Internal roles only; clients never reach this API.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole(
    req,
    ALL_ROLES,
    'You do not have permission to view project documents.'
  )
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const { id } = await params
    const admin = getSupabaseAdmin()
    const { document, error } = await loadDocument(admin, id)
    if (error || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    if (
      resolved.caller.role === 'junior_developer' &&
      !(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, document.project_id))
    ) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const { data: revisions } = await admin
      .from('document_revisions')
      .select('id, revision_no, status, content, created_by, created_at, source, uploaded_file_name, uploaded_mime_type')
      .eq('document_id', id)
      .order('revision_no', { ascending: true })

    const firstRevision = revisions?.[0] || null
    const currentRevision =
      revisions?.find((r) => r.id === document.current_revision_id) ||
      revisions?.[revisions.length - 1] ||
      null

    const { data: approvals } = await admin
      .from('approvals')
      .select('id, decision, comment, approver_id, approval_date')
      .eq('revision_id', currentRevision?.id || '')
      .order('approval_date', { ascending: false })
      .limit(1)
    const latestApproval = approvals?.[0] || null

    const userIds = [
      firstRevision?.created_by,
      currentRevision?.created_by,
      latestApproval?.approver_id,
    ].filter((value): value is string => Boolean(value))
    const { data: profiles } = userIds.length
      ? await admin.from('profiles').select('id, full_name, email').in('id', userIds)
      : { data: [] }
    const nameFor = (userId?: string | null) =>
      profiles?.find((p) => p.id === userId)?.full_name ||
      profiles?.find((p) => p.id === userId)?.email ||
      'Unknown'

    const { data: clientProject } = await admin
      .from('projects')
      .select('id, name, project_reference, client_id, clients(id, name)')
      .eq('id', document.project_id)
      .maybeSingle()

    return NextResponse.json({
      document: {
        ...document,
        content: currentRevision?.content || '',
        revision_id: currentRevision?.id || null,
        revision_no: currentRevision?.revision_no || null,
        revision_status: currentRevision?.status || document.status,
        source: currentRevision?.source || null,
        uploaded_file_name: currentRevision?.uploaded_file_name || null,
        uploaded_mime_type: currentRevision?.uploaded_mime_type || null,
        created_by_name: nameFor(firstRevision?.created_by),
        last_edited_by_name: nameFor(currentRevision?.created_by),
        last_edited_at: currentRevision?.created_at || null,
        approved_by_name: latestApproval?.decision === 'approved' ? nameFor(latestApproval.approver_id) : null,
        approved_at: latestApproval?.decision === 'approved' ? latestApproval.approval_date : null,
        rejection_reason: latestApproval?.decision === 'rejected' ? latestApproval.comment : null,
        review_decision: latestApproval?.decision || null,
        review_comment: latestApproval?.comment || null,
        reviewed_at: latestApproval?.approval_date || null,
        project: clientProject || null,
      },
      can_edit:
        resolved.caller.role === 'senior_dev_pm' ||
        (resolved.caller.role === 'junior_developer' &&
          firstRevision?.created_by === resolved.caller.user.id),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not load document.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH /api/documents/[id] — save in-portal edits as a new editable revision.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const { id } = await params
    const body = await req.json()
    const content = typeof body?.content === 'string' ? body.content : null
    const title = typeof body?.title === 'string' ? body.title.trim() : null
    if (content === null && !title) {
      return NextResponse.json({ error: 'Provide content or a title to save.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { document, error } = await loadDocument(admin, id)
    if (error || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    if (
      !(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, document.project_id))
    ) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    if (document.status === 'approved' || document.status === 'sent_to_client') {
      return NextResponse.json(
        { error: 'Approved documents cannot be edited. Draft a new revision instead.' },
        { status: 409 }
      )
    }

    const { data: revisions } = await admin
      .from('document_revisions')
      .select('id, revision_no, created_by')
      .eq('document_id', id)
      .order('revision_no', { ascending: false })

    const firstRevision = revisions?.[revisions.length - 1] || null
    if (
      resolved.caller.role === 'junior_developer' &&
      firstRevision?.created_by !== resolved.caller.user.id
    ) {
      return NextResponse.json(
        { error: 'Junior developers can only edit documents they created.' },
        { status: 403 }
      )
    }

    const nextRevisionNo = (revisions?.[0]?.revision_no || 0) + 1
    const nextContent = content ?? ''
    const { data: revision, error: revisionError } = await admin
      .from('document_revisions')
      .insert({
        document_id: id,
        revision_no: nextRevisionNo,
        content: nextContent,
        status: 'draft',
        created_by: resolved.caller.user.id,
        ai_generated: false,
        source: 'manual',
      })
      .select('id, revision_no, content, status')
      .single()
    if (revisionError || !revision) {
      return NextResponse.json({ error: revisionError?.message || 'Could not save revision.' }, { status: 500 })
    }

    if (title && title !== document.title) {
      const { error: titleError } = await admin
        .from('documents')
        .update({ title })
        .eq('id', id)
      if (titleError) {
        return NextResponse.json({ error: titleError.message }, { status: 500 })
      }
    }

    const { data: versions } = await admin
      .from('document_versions')
      .select('version_no')
      .eq('document_id', id)
      .order('version_no', { ascending: false })
      .limit(1)

    await admin.from('document_versions').insert({
      document_id: id,
      revision_id: revision.id,
      version_no: (versions?.[0]?.version_no || 0) + 1,
      title: title || document.title,
      content: nextContent || null,
      change_summary: 'Edited inside the portal',
      created_by: resolved.caller.user.id,
    })

    await writeAudit(resolved.caller.db, {
      action: 'document.edited',
      entity_type: 'document',
      entity_id: id,
      after_value: { title: title || document.title, revision_no: nextRevisionNo },
    })

    return NextResponse.json({
      message: 'Document saved.',
      revision: { id: revision.id, revision_no: revision.revision_no, content: revision.content },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not save document.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
