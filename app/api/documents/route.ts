import { NextResponse } from 'next/server'
import { denyBusinessOperation, resolveCaller } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { canAccessProject } from '@/lib/project-access'
import { writeAudit } from '@/lib/audit'

const DRAFT_DOCUMENT_TYPES = [
  'Requirements',
  'Quotation',
  'Proposal',
  'Timeline',
  'SLA',
  'Purchase Order',
  'Invoice',
  'PRD',
  'SRS',
  'Handover',
  'Other',
] as const

// POST /api/documents — create a manually drafted document plus its first
// editable revision. The document starts as a draft and must be submitted for
// senior review before it can be approved.
export async function POST(req: Request) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const body = await req.json()
    const projectId = typeof body?.project_id === 'string' ? body.project_id : ''
    const type = typeof body?.type === 'string' ? body.type.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content : ''

    if (!projectId) {
      return NextResponse.json({ error: 'A project is required.' }, { status: 400 })
    }
    if (!DRAFT_DOCUMENT_TYPES.includes(type as (typeof DRAFT_DOCUMENT_TYPES)[number])) {
      return NextResponse.json({ error: 'Choose a supported document type.' }, { status: 400 })
    }
    if (!title || title.length > 200) {
      return NextResponse.json(
        { error: 'Enter a document title of 200 characters or fewer.' },
        { status: 400 }
      )
    }

    const admin = getSupabaseAdmin()
    if (!(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, projectId))) {
      return NextResponse.json(
        { error: 'You do not have access to this project.' },
        { status: 403 }
      )
    }

    const { data: document, error: documentError } = await admin
      .from('documents')
      .insert({ project_id: projectId, type, title, status: 'draft' })
      .select('id, project_id, type, title, status')
      .single()
    if (documentError || !document) {
      return NextResponse.json({ error: documentError?.message || 'Could not create draft.' }, { status: 500 })
    }

    const { data: revision, error: revisionError } = await admin
      .from('document_revisions')
      .insert({
        document_id: document.id,
        revision_no: 1,
        content,
        status: 'draft',
        created_by: resolved.caller.user.id,
        ai_generated: false,
        source: 'manual',
      })
      .select('id, revision_no, content, status')
      .single()
    if (revisionError || !revision) {
      return NextResponse.json({ error: revisionError?.message || 'Could not create revision.' }, { status: 500 })
    }

    await admin.from('document_versions').insert({
      document_id: document.id,
      revision_id: revision.id,
      version_no: 1,
      title: document.title,
      content: content || null,
      change_summary: 'Draft created in the portal',
      created_by: resolved.caller.user.id,
    })

    await writeAudit(resolved.caller.db, {
      action: 'document.draft_created',
      entity_type: 'document',
      entity_id: document.id,
      after_value: { title: document.title, type: document.type, project_id: projectId },
    })

    return NextResponse.json({
      message: 'Draft created.',
      document: { ...document, current_revision_id: revision.id, content: revision.content },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not create draft.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
