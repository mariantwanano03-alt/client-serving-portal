import { NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { denyBusinessOperation, resolveCaller } from '@/lib/authz'
import { canAccessProject } from '@/lib/project-access'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// ─── POST /api/generate-document ─────────────────────────────────────────
// Generate a document from the REAL details already stored for the project:
// project record, client record, reviewed discovery facts and transcript.
// No placeholder/lorem text is ever written. AI-generated documents do not
// require the senior approval step (only manually edited documents do).
export async function POST(req: Request) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (resolved.response || !resolved.caller) return resolved.response
  const caller = resolved.caller
  const user = caller.user

  try {
    const body = await req.json()
    const { project_id, type, title, persist } = body as {
      project_id?: string
      type?: string
      title?: string
      persist?: boolean
    }

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required.' }, { status: 400 })
    }
    if (!type) {
      return NextResponse.json({ error: 'Document type is required.' }, { status: 400 })
    }

    // 1. Real project + client data
    // Caller-scoped reads keep project/document visibility enforced by RLS.
    const { data: project, error: projError } = await caller.db
      .from('projects')
      .select('id, project_reference, name, description, stage, status, client_id, clients(name, primary_contact, email, phone)')
      .eq('id', project_id)
      .single()

    if (projError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }
    const client = Array.isArray(project.clients) ? project.clients[0] : project.clients
    const clientName = client?.name || 'Not recorded'

    // 2. Real reviewed facts + transcript from documents already in the project
    const { data: existingDocs } = await caller.db
      .from('documents')
      .select('id, type, current_revision_id')
      .eq('project_id', project_id)

    const revisionIds = (existingDocs || [])
      .map((d) => d.current_revision_id)
      .filter((id): id is string => !!id)

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
    for (const rev of revisions) {
      const content = rev.content || ''
      // Meeting facts were stored as "- **Label:** value" by project creation.
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*[-*]\s*\*\*(.+?):\*\*\s*(.+)$/)
        if (match) facts[match[1].trim()] = match[2].trim()
      }
      const docType = (existingDocs || []).find((d) => d.id === rev.document_id)?.type
      if (docType === 'Transcript' || /^## (?:Meeting transcript|Transcript)\s*$/im.test(content)) {
        const section = content.replace(/^[\s\S]*?## (?:Meeting transcript|Transcript)\s*\n/i, '').split(/\n---/)[0].trim()
        if (section && section.length > transcript.length) transcript = section
      }
    }

    const docTitle = (title || `${type} Document`).trim()
    const content = buildContent({
      type,
      title: docTitle,
      project: {
        name: project.name,
        reference: project.project_reference,
        description: project.description || '',
        stage: project.stage,
        status: project.status,
      },
      client: {
        name: clientName,
        primaryContact: client?.primary_contact || '',
        email: client?.email || '',
        phone: client?.phone || '',
      },
      facts,
      transcript,
      generatedBy: user.email || user.id,
    })

    // Download-only mode: return the content without creating another document.
    if (persist === false) {
      return NextResponse.json({ content, title: docTitle })
    }

    // The caller-scoped project read above already enforces project access.
    // Make that boundary explicit before using the trusted writer: generated
    // documents are system-approved, but only authorised staff may request
    // them. Manual uploads continue to enter pending_review through their own
    // API and can never reach this path.
    const admin = getSupabaseAdmin()
    if (!(await canAccessProject(admin, user.id, caller.role, project.id))) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const { data: docData, error: docErr } = await admin
      .from('documents')
      .insert({
        project_id: project.id,
        title: docTitle,
        type,
        status: 'approved',
      })
      .select('id')
      .single()

    if (docErr || !docData) {
      return NextResponse.json({ error: docErr?.message || 'Failed to create document.' }, { status: 500 })
    }

    const { data: revData, error: revErr } = await admin
      .from('document_revisions')
      .insert({
        document_id: docData.id,
        revision_no: 1,
        ai_generated: true,
        created_by: user.id,
        status: 'approved',
        source: 'ai',
        content,
      })
      .select('id')
      .single()

    if (revErr || !revData) {
      return NextResponse.json({ error: revErr?.message || 'Failed to create document revision.' }, { status: 500 })
    }

    await admin.from('document_versions').insert({
      document_id: docData.id,
      revision_id: revData.id,
      version_no: 1,
      title: docTitle,
      content,
      change_summary: 'Generated from stored project and discovery data',
      created_by: user.id,
    })

    await admin
      .from('documents')
      .update({ current_revision_id: revData.id })
      .eq('id', docData.id)

    await writeAudit(caller.db, {
      action: 'document.generated',
      entity_type: 'document',
      entity_id: docData.id,
      after_value: {
        project_id: project.id,
        project_name: project.name,
        title: docTitle,
        type,
        revision_no: 1,
      },
    })

    return NextResponse.json({
      document: {
        id: docData.id,
        title: docTitle,
        type,
        status: 'approved',
        project_id: project.id,
        revision_id: revData.id,
        revision_no: 1,
        content,
      },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

type ContentInput = {
  type: string
  title: string
  project: { name: string; reference: string; description: string; stage: string; status: string }
  client: { name: string; primaryContact: string; email: string; phone: string }
  facts: Record<string, string>
  transcript: string
  generatedBy: string
}

function fact(input: ContentInput, label: string): string {
  return input.facts[label] || ''
}

function factsBlock(input: ContentInput, labels: string[]): string {
  const rows = labels
    .map((label) => ({ label, value: fact(input, label) }))
    .filter((row) => !!row.value)
    .map((row) => `- **${row.label}:** ${row.value}`)
  return rows.length ? rows.join('\n') : '- No details were captured for this section during discovery.'
}

function buildContent(input: ContentInput): string {
  const header = [
    `# ${input.title}`,
    '',
    `**Project:** ${input.project.name} (${input.project.reference})`,
    `**Client:** ${input.client.name}`,
    `**Project stage:** ${input.project.stage} · **Status:** ${input.project.status}`,
    `**Generated:** ${new Date().toISOString()} by ${input.generatedBy}`,
    '',
  ].join('\n')

  let body = ''
  switch (input.type) {
    case 'PRD':
      body = [
        '## Product Requirements',
        factsBlock(input, ['Business requirements', 'Client objectives', 'Required services', 'Problems / challenges', 'Industry', 'Company description']),
        '',
        '## Stakeholders',
        factsBlock(input, ['Primary contact', 'Contact email', 'Contact phone']),
      ].join('\n')
      break
    case 'SRS':
      body = [
        '## Functional Requirements',
        factsBlock(input, ['Required services', 'Business requirements']),
        '',
        '## Objectives and Constraints',
        factsBlock(input, ['Client objectives', 'Problems / challenges', 'Company description', 'Industry']),
      ].join('\n')
      break
    case 'Proposal':
      body = [
        '## Understanding of the Client',
        factsBlock(input, ['Company description', 'Industry', 'Problems / challenges']),
        '',
        '## Proposed Scope',
        factsBlock(input, ['Required services', 'Business requirements', 'Client objectives']),
      ].join('\n')
      break
    case 'Handover':
      body = [
        '## Captured Discovery Details',
        factsBlock(input, ['Primary contact', 'Contact email', 'Contact phone', 'Company address', 'Company description', 'Industry', 'Business requirements', 'Client objectives', 'Problems / challenges', 'Required services', 'Additional notes']),
      ].join('\n')
      break
    case 'Quotation':
    case 'Invoice':
      body = [
        `**Billed party:** ${input.client.name}`,
        `**Attention:** ${input.client.primaryContact || 'Not recorded'}`,
        '',
        '## Scope (from discovery)',
        factsBlock(input, ['Required services', 'Business requirements']),
        '',
        '> Pricing was not captured during discovery and must be completed by an authorised staff member before this document is issued.',
      ].join('\n')
      break
    case 'Transcript':
      body = [
        '## Discovery Meeting Transcript',
        input.transcript || 'No meeting transcript has been recorded for this project.',
      ].join('\n')
      break
    default:
      body = [
        '## Project Details',
        input.project.description || 'No additional project description was recorded.',
        '',
        '## Captured Discovery Details',
        factsBlock(input, ['Primary contact', 'Contact email', 'Contact phone', 'Company address', 'Company description', 'Industry', 'Business requirements', 'Client objectives', 'Problems / challenges', 'Required services', 'Additional notes']),
      ].join('\n')
  }

  const transcriptSection = input.type === 'Transcript' ? '' : `\n\n## Source Transcript\n${input.transcript || 'No meeting transcript was recorded for this project.'}`

  return `${header}${body}${transcriptSection}\n`
}
