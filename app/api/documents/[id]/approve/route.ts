import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { denyBusinessOperation } from '@/lib/authz'

function getAuthenticatedClient(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
  }
  return supabase
}

// ─── POST /api/documents/[id]/approve ────────────────────────────────────────
// Approve or reject a document version. Only senior_dev_pm (admins are read-only).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    const { id } = await params
    const client = getAuthenticatedClient(req)
    const body = await req.json()

    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Could not load user profile.' }, { status: 401 })
    }

    if (profile.role !== 'senior_dev_pm') {
      return NextResponse.json(
        { error: 'Only Senior Developers / PMs can approve documents.' },
        { status: 403 }
      )
    }

    const { decision, comment, revision_id } = body

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'Decision must be "approved" or "rejected".' }, { status: 400 })
    }

    // Verify document exists
    const { data: document, error: docError } = await client
      .from('documents')
      .select('id, project_id, title, status, current_revision_id')
      .eq('id', id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    // Senior role alone is not enough: the assignment matrix must grant this
    // senior approval authority on the specific project.
    // can_approve_document reads auth.uid(), so it must run with the caller's
    // JWT rather than the service-role key.
    const { data: mayApprove, error: authorityError } = await client
      .rpc('can_approve_document', { p_document_id: id })
    if (authorityError) {
      return NextResponse.json({ error: authorityError.message }, { status: 500 })
    }
    if (!mayApprove) {
      return NextResponse.json(
        { error: 'You are not authorised to approve documents on this project.' },
        { status: 403 }
      )
    }

    const revId = revision_id || document.current_revision_id
    if (!revId) {
      return NextResponse.json({ error: 'Document has no revision to approve.' }, { status: 400 })
    }

    // Idempotency: check if already approved/rejected
    const { data: existingApproval } = await client
      .from('approvals')
      .select('id, decision')
      .eq('revision_id', revId)
      .order('approval_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingApproval && existingApproval.decision === decision) {
      return NextResponse.json({
        message: `Document already ${decision}.`,
        document_id: id,
        revision_id: revId,
      })
    }

    // Insert approval record
    const { error: approvalError } = await client.from('approvals').insert({
      revision_id: revId,
      approver_id: user.id,
      decision,
      comment: comment || null,
    })

    if (approvalError) {
      return NextResponse.json({ error: approvalError.message }, { status: 500 })
    }

    // Update revision status. The existing sync trigger mirrors this onto the
    // document, and the approval triggers reject any status write that did not
    // go through an approval record.
    const { error: revisionUpdateError } = await client
      .from('document_revisions')
      .update({ status: decision })
      .eq('id', revId)
    if (revisionUpdateError) {
      return NextResponse.json({ error: revisionUpdateError.message }, { status: 500 })
    }

    const newDocStatus = decision === 'approved' ? 'approved' : 'rejected'
    const { error: documentUpdateError } = await client
      .from('documents')
      .update({ status: newDocStatus })
      .eq('id', id)
    if (documentUpdateError) {
      return NextResponse.json({ error: documentUpdateError.message }, { status: 500 })
    }

    // Record document version snapshot
    const { data: revData } = await client
      .from('document_revisions')
      .select('revision_no, content, ai_generated')
      .eq('id', revId)
      .single()

    if (revData) {
      // Get next version number
      const { data: versions } = await client
        .from('document_versions')
        .select('version_no')
        .eq('document_id', id)
        .order('version_no', { ascending: false })
        .limit(1)

      const nextVersion = (versions?.[0]?.version_no || 0) + 1

      await client.from('document_versions').insert({
        document_id: id,
        revision_id: revId,
        version_no: nextVersion,
        title: document.title,
        content: revData.content || null,
        change_summary: `${decision}: ${comment || 'No comment'}`,
        created_by: user.id,
      })
    }

    // Audit entry
    await writeAudit(client, {
      action: `document.${decision}`,
      entity_type: 'document',
      entity_id: id,
      after_value: {
        decision,
        revision_id: revId,
        comment,
        project_id: document.project_id,
      },
    })

    return NextResponse.json({
      message: `Document ${decision}.`,
      document_id: id,
      revision_id: revId,
      decision,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
