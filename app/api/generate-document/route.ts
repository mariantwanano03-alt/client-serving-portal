import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

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

// ─── POST /api/generate-document ─────────────────────────────────────────
// Generate a placeholder document for a project.
// Supported types: PRD, SRS, Quotation, Proposal, Invoice, md
// No approval step: generates immediately for any authenticated user.
export async function POST(req: NextRequest) {
  try {
    const client = getAuthenticatedClient(req)

    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const body = await req.json()
    const { project_id, type, title } = body

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required.' }, { status: 400 })
    }
    if (!type) {
      return NextResponse.json({ error: 'Document type is required.' }, { status: 400 })
    }

    // Verify project exists and fetch client name for the placeholder content
    const { data: project, error: projError } = await client
      .from('projects')
      .select('id, project_reference, name, client_id')
      .eq('id', project_id)
      .single()

    if (projError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    let clientName = 'Client'
    if (project.client_id) {
      const { data: clientData } = await client
        .from('clients')
        .select('name')
        .eq('id', project.client_id)
        .single()
      if (clientData) {
        clientName = clientData.name
      }
    }

    const docTitle = title || `${type} Document`
    const dateCreated = new Date().toLocaleDateString()
    const content = buildPlaceholderContent(docTitle, project.name, clientName, dateCreated, type)

    const { data: docData, error: docErr } = await client
      .from('documents')
      .insert({
        project_id: project.id,
        title: docTitle,
        type,
        status: 'draft',
      })
      .select('id')
      .single()

    if (docErr || !docData) {
      return NextResponse.json({ error: docErr?.message || 'Failed to create document.' }, { status: 500 })
    }

    // Determine next revision number
    const { data: existingRevs } = await client
      .from('document_revisions')
      .select('revision_no')
      .eq('document_id', docData.id)
      .order('revision_no', { ascending: false })
      .limit(1)
    const nextRev = (existingRevs?.[0]?.revision_no || 0) + 1

    const { data: revData, error: revErr } = await client
      .from('document_revisions')
      .insert({
        document_id: docData.id,
        revision_no: nextRev,
        ai_generated: true,
        created_by: user.id,
        status: 'pending_review',
        content,
      })
      .select('id')
      .single()

    if (revErr || !revData) {
      return NextResponse.json({ error: revErr?.message || 'Failed to create document revision.' }, { status: 500 })
    }

    await client
      .from('documents')
      .update({ current_revision_id: revData.id })
      .eq('id', docData.id)

    await client.from('audit_entries').insert({
      actor_user_id: user.id,
      action: 'document.generated',
      entity_type: 'document',
      entity_id: docData.id,
      after_value: {
        project_id: project.id,
        project_name: project.name,
        title: docTitle,
        type,
        revision_no: nextRev,
      },
    })

    return NextResponse.json({
      document: {
        id: docData.id,
        title: docTitle,
        type,
        status: 'draft',
        project_id: project.id,
        revision_id: revData.id,
        revision_no: nextRev,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Placeholder content - simple, no fancy templates.
function buildPlaceholderContent(
  title: string,
  projectName: string,
  clientName: string,
  dateCreated: string,
  type: string
): string {
  return [
    `Title: ${title}`,
    `Project Name: ${projectName}`,
    `Client Name: ${clientName}`,
    `Date Created: ${dateCreated}`,
    '',
    `Placeholder document - Template to be provided later. This is a placeholder for the ${type} document.`,
  ].join('\n')
}
