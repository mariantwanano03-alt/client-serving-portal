import { NextResponse } from 'next/server'
import { denyBusinessOperation, resolveCaller } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { canAccessProject } from '@/lib/project-access'
import { writeAudit } from '@/lib/audit'

// POST /api/documents/[id]/submit — move the current draft into review.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const { id } = await params
    const admin = getSupabaseAdmin()

    const { data: document, error: documentError } = await admin
      .from('documents')
      .select('id, project_id, title, status, current_revision_id, type')
      .eq('id', id)
      .maybeSingle()
    if (documentError || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    if (
      !(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, document.project_id))
    ) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    if (document.status === 'approved' || document.status === 'sent_to_client') {
      return NextResponse.json(
        { error: 'This document has already completed approval.' },
        { status: 409 }
      )
    }
    if (!document.current_revision_id) {
      return NextResponse.json({ error: 'This document has no revision to submit.' }, { status: 400 })
    }

    if (resolved.caller.role === 'junior_developer') {
      const { data: revisions } = await admin
        .from('document_revisions')
        .select('created_by')
        .eq('document_id', id)
        .order('revision_no', { ascending: true })
      if (revisions?.[0]?.created_by !== resolved.caller.user.id) {
        return NextResponse.json(
          { error: 'Junior developers can only submit documents they created.' },
          { status: 403 }
        )
      }
    }

    const { error: revisionError } = await admin
      .from('document_revisions')
      .update({ status: 'pending_review' })
      .eq('id', document.current_revision_id)
    if (revisionError) {
      return NextResponse.json({ error: revisionError.message }, { status: 500 })
    }

    // The existing sync trigger mirrors the revision status onto the document.
    const { data: updated, error: documentUpdateError } = await admin
      .from('documents')
      .select('status')
      .eq('id', id)
      .single()
    if (documentUpdateError) {
      return NextResponse.json({ error: documentUpdateError.message }, { status: 500 })
    }

    await writeAudit(resolved.caller.db, {
      action: 'document.submitted_for_review',
      entity_type: 'document',
      entity_id: id,
      after_value: { title: document.title, type: document.type },
    })

    return NextResponse.json({
      message: 'Document submitted for review.',
      status: updated?.status || 'pending_review',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not submit document.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
