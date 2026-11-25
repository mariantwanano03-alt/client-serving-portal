import { NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { denyBusinessOperation, resolveCaller } from '@/lib/authz'
import {
  buildGeneratedContent,
  GENERATION_CONFIG,
  labelForGenerationType,
  normalizeGenerationType,
  validateGenerationFields,
  type FinancialContext,
  type GenerationFields,
  type GenerationType,
} from '@/lib/document-generation'
import { canAccessProject } from '@/lib/project-access'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// ─── POST /api/generate-document ─────────────────────────────────────────
// Generate a document from the REAL details already stored for the project:
// project/client records, reviewed discovery facts and the recorded financial
// overview. The document is always saved as an editable draft and must pass
// the existing senior review workflow before it can be approved.
export async function POST(req: Request) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (resolved.response || !resolved.caller) return resolved.response
  const caller = resolved.caller
  const user = caller.user

  try {
    const body = await req.json()
    const projectId = typeof body?.project_id === 'string' ? body.project_id.trim() : ''
    const requestedType = body?.type
    const fields = body?.fields
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const persist = body?.persist !== false

    if (!projectId) {
      return NextResponse.json({ error: 'A project is required.' }, { status: 400 })
    }

    const type = normalizeGenerationType(requestedType)
    if (!type) {
      return NextResponse.json({ error: 'Choose a supported document type.' }, { status: 400 })
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return NextResponse.json({ error: 'Document fields are required.' }, { status: 400 })
    }

    const validationError = validateGenerationFields(type, fields as GenerationFields)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    // Caller-scoped reads keep project, document and financial visibility
    // enforced by RLS before any trusted writer is used.
    const { data: project, error: projError } = await caller.db
      .from('projects')
      .select('id, project_reference, name, description, stage, status, client_id, clients(name, primary_contact, email, phone)')
      .eq('id', projectId)
      .maybeSingle()

    if (projError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }
    const client = Array.isArray(project.clients) ? project.clients[0] : project.clients

    const admin = getSupabaseAdmin()
    if (!(await canAccessProject(admin, user.id, caller.role, project.id))) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const { data: financialRow } = await caller.db
      .from('pts_deposit_overview')
      .select('currency, reference, due_date, required_cents, paid_cents, outstanding_cents, status, requirement_status')
      .eq('project_id', project.id)
      .order('reference', { ascending: true })
      .limit(1)
      .maybeSingle()

    const financial: FinancialContext | null = financialRow
      ? {
          currency: (financialRow.currency as string | null) ?? null,
          reference: (financialRow.reference as string | null) ?? null,
          dueDate: (financialRow.due_date as string | null) ?? null,
          requiredCents: Number(financialRow.required_cents) || 0,
          paidCents: Number(financialRow.paid_cents) || 0,
          outstandingCents: Number(financialRow.outstanding_cents) || 0,
          status: (financialRow.status as string | null) ?? null,
          requirementStatus: (financialRow.requirement_status as string | null) ?? null,
        }
      : null

    const { data: existingDocs } = await caller.db
      .from('documents')
      .select('id, type, current_revision_id')
      .eq('project_id', project.id)

    const revisionIds = (existingDocs || [])
      .map((doc) => doc.current_revision_id)
      .filter((id): id is string => Boolean(id))

    let revisions: { document_id: string; content: string | null }[] = []
    if (revisionIds.length) {
      const { data } = await caller.db
        .from('document_revisions')
        .select('document_id, content')
        .in('id', revisionIds)
      revisions = (data || []) as typeof revisions
    }

    const facts: Record<string, string> = {}
    let transcript = ''
    for (const revision of revisions) {
      const content = revision.content || ''
      // Discovery facts were stored as "- **Label:** value" by project creation.
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*[-*]\s*\*\*(.+?):\*\*\s*(.+)$/)
        if (match) facts[match[1].trim()] = match[2].trim()
      }
      const documentType = (existingDocs || []).find((doc) => doc.id === revision.document_id)?.type
      if (documentType === 'Transcript' || /^## (?:Meeting transcript|Transcript)\s*$/im.test(content)) {
        const section = content.replace(/^[\s\S]*?## (?:Meeting transcript|Transcript)\s*\n/i, '').split(/\n---/)[0].trim()
        if (section && section.length > transcript.length) transcript = section
      }
    }

    const docTitle = (title || `${labelForGenerationType(type)} — ${project.name}`).slice(0, 200)
    const content = buildGeneratedContent({
      type,
      title: docTitle,
      project: {
        name: project.name,
        reference: project.project_reference,
        description: project.description || '',
        stage: project.stage || '',
        status: project.status || '',
      },
      client: {
        name: client?.name || 'Not recorded',
        primaryContact: client?.primary_contact || '',
        email: client?.email || '',
        phone: client?.phone || '',
      },
      facts,
      transcript,
      fields: fields as GenerationFields,
      financial,
    })

    if (!persist) {
      return NextResponse.json({ content, title: docTitle, type, status: 'draft' })
    }

    const { data: document, error: documentError } = await admin
      .from('documents')
      .insert({
        project_id: project.id,
        title: docTitle,
        type,
        status: 'draft',
      })
      .select('id, project_id, title, type, status')
      .single()

    if (documentError || !document) {
      return NextResponse.json({ error: documentError?.message || 'Failed to create document.' }, { status: 500 })
    }

    const { data: revision, error: revisionError } = await admin
      .from('document_revisions')
      .insert({
        document_id: document.id,
        revision_no: 1,
        ai_generated: true,
        created_by: user.id,
        status: 'draft',
        source: 'ai',
        content,
      })
      .select('id, revision_no, content, status')
      .single()

    if (revisionError || !revision) {
      return NextResponse.json({ error: revisionError?.message || 'Failed to create document revision.' }, { status: 500 })
    }

    await admin.from('document_versions').insert({
      document_id: document.id,
      revision_id: revision.id,
      version_no: 1,
      title: document.title,
      content,
      change_summary: `Generated ${GENERATION_CONFIG[type as GenerationType].label} from stored project and discovery data`,
      created_by: user.id,
    })

    await admin
      .from('documents')
      .update({ current_revision_id: revision.id })
      .eq('id', document.id)

    await writeAudit(caller.db, {
      action: 'document.generated',
      entity_type: 'document',
      entity_id: document.id,
      after_value: {
        status: 'draft',
        project_id: project.id,
        project_name: project.name,
        title: document.title,
        type,
        revision_no: 1,
      },
    })

    return NextResponse.json({
      message: `${labelForGenerationType(type)} created as a draft. Review it, then submit it for senior review.`,
      document: {
        ...document,
        current_revision_id: revision.id,
        revision_no: revision.revision_no,
        content,
        status: 'draft',
      },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
