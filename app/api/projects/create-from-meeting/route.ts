import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { denyBusinessOperation } from '@/lib/authz'

// Create a client, project and starter documents from reviewed meeting details.
// Uses only tables that exist in the deployed database.
export async function POST(req: Request) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    const admin = getSupabaseAdmin()

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Could not load user profile.' }, { status: 401 })
    }
    if (!['senior_dev_pm', 'junior_developer'].includes(profile.role)) {
      return NextResponse.json({ error: 'Only staff members can create projects.' }, { status: 403 })
    }

    const body = await req.json()
    const details = (body.details || {}) as Record<string, string>
    const transcript = (body.transcript || '').trim()
    const audio = (body.audio || {}) as Record<string, unknown>
    const name = (details.client_name || '').trim()
    const contact = (details.primary_contact || '').trim()

    if (!name || !contact) {
      return NextResponse.json(
        { error: 'Company / client name and primary contact are required.' },
        { status: 400 }
      )
    }

    // Reuse an existing client when email or exact name matches.
    let clientId: string | null = null
    let clientName = name
    const email = (details.contact_email || '').trim()
    if (email) {
      const { data: byEmail } = await supabase.from('clients').select('id, name').eq('email', email).maybeSingle()
      if (byEmail) { clientId = byEmail.id; clientName = byEmail.name }
    }
    if (!clientId) {
      const { data: byName } = await supabase.from('clients').select('id, name').ilike('name', name).maybeSingle()
      if (byName) { clientId = byName.id; clientName = byName.name }
    }

    if (!clientId) {
      const baseCode = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CLIENT'
      let code = baseCode
      let counter = 1
      while (true) {
        const { data: existing } = await supabase.from('clients').select('id').eq('client_code', code).maybeSingle()
        if (!existing) break
        code = `${baseCode}${counter++}`
      }
      // As with projects, RETURNING would evaluate the scoped client SELECT
      // policy before the client has a project. Keep the caller client for the
      // RLS-enforced insert and read the row back through the service role.
      const { error: clientError } = await supabase.from('clients').insert({
        client_code: code,
        name,
        email: email || null,
        phone: (details.contact_phone || '').trim() || null,
        primary_contact: contact,
        billing_details: null,
        created_by: user.id,
      })
      if (clientError) {
        return NextResponse.json({ error: clientError.message }, { status: 500 })
      }
      const { data: created, error: fetchClientError } = await admin
        .from('clients')
        .select('id, name')
        .eq('client_code', code)
        .maybeSingle()
      if (fetchClientError || !created) {
        return NextResponse.json(
          { error: fetchClientError?.message || 'Could not load the created client.' },
          { status: 500 }
        )
      }
      clientId = created.id
      clientName = created.name
    }

    // Create the project.
    const projectReference = `PRJ-${Date.now().toString(36).toUpperCase()}`
    const description = [
      `Client: ${clientName}`,
      `Primary contact: ${contact}`,
      audio?.fileName ? `Meeting audio: ${String(audio.fileName)}` : null,
    ].filter(Boolean).join('\n')

    const { error: projectError } = await supabase.from('projects').insert({
      project_reference: projectReference,
      client_id: clientId,
      name: `${clientName} Project`,
      description,
      stage: 'discovery',
      status: 'active',
      created_by: user.id,
    })
    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 })
    }
    const { data: project, error: fetchProjectError } = await admin
      .from('projects')
      .select('id, project_reference, name')
      .eq('project_reference', projectReference)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fetchProjectError || !project) {
      return NextResponse.json(
        { error: fetchProjectError?.message || 'Could not load the created project.' },
        { status: 500 }
      )
    }

    // Build documents from the reviewed details only — no invented values.
    const labelled: [string, string][] = [
      ['Primary contact', contact],
      ['Contact email', details.contact_email],
      ['Contact phone', details.contact_phone],
      ['Company address', details.company_address],
      ['Company description', details.company_description],
      ['Industry', details.industry],
      ['Business requirements', details.business_requirements],
      ['Client objectives', details.client_objectives],
      ['Problems / challenges', details.problems_challenges],
      ['Required services', details.required_services],
      ['Additional notes', details.additional_notes],
    ].filter(([, value]) => !!value && String(value).trim()) as [string, string][]

    const meetingFacts = labelled.map(([label, value]) => `- **${label}:** ${String(value).trim()}`).join('\n')
    const generatedAt = new Date().toISOString()

    const documentSpecs = [
      {
        type: 'PRD',
        title: `Product Requirements Document — ${clientName}`,
        content: `# Product Requirements Document\n\n## Client\n${clientName}\n\n## Project\n${project.name} (${project.project_reference})\n\n## Meeting facts\n${meetingFacts || '- No structured facts were provided.'}\n\n## Transcript\n${transcript || 'No transcript was supplied.'}\n\n---\nGenerated from the reviewed discovery details on ${generatedAt}.`,
      },
      {
        type: 'SRS',
        title: `Software Requirements Specification — ${clientName}`,
        content: `# Software Requirements Specification\n\n## 1. Overview\nSystem requirements for ${project.name} (${project.project_reference}).\n\n## 2. Stakeholders\n${labelled.filter(([l]) => l === 'Primary contact' || l === 'Contact email').map(([l, v]) => `- ${l}: ${v}`).join('\n') || '- Not provided'}\n\n## 3. Functional requirements\n${details.required_services?.trim() || details.business_requirements?.trim() || 'Not provided'}\n\n## 4. Objectives and constraints\n${details.client_objectives?.trim() || 'Not provided'}\n${details.problems_challenges?.trim() || ''}\n\n---\nGenerated from the reviewed discovery details on ${generatedAt}.`,
      },
      {
        type: 'Handover',
        title: `Discovery Handover — ${clientName}`,
        content: `# Discovery Handover\n\n## Client\n${clientName}\n\n## Project reference\n${project.project_reference}\n\n## Captured details\n${meetingFacts || '- No structured facts were provided.'}\n\n## Meeting transcript\n${transcript || 'No transcript was supplied.'}\n\n---\nGenerated from the reviewed discovery details on ${generatedAt}.`,
      },
      ...(transcript ? [{
        type: 'Transcript',
        title: `Discovery Meeting Transcript — ${clientName}`,
        content: transcript,
      }] : []),
    ]

    const createdDocs: { id: string; type: string }[] = []
    for (const spec of documentSpecs) {
      const { data: doc, error: docError } = await supabase.from('documents').insert({
        project_id: project.id,
        title: spec.title,
        type: spec.type,
        // AI-generated discovery documents are approved on creation; only
        // manually edited documents go through the senior approval step.
        status: 'approved',
      }).select('id').single()
      if (docError || !doc) continue
      const { data: revision, error: revError } = await supabase.from('document_revisions').insert({
        document_id: doc.id,
        revision_no: 1,
        ai_generated: true,
        created_by: user.id,
        status: 'approved',
        content: spec.content,
      }).select('id').single()
      if (!revError && revision) {
        await supabase.from('documents').update({ current_revision_id: revision.id }).eq('id', doc.id)
      }
      createdDocs.push({ id: doc.id, type: spec.type })
    }

    await writeAudit(supabase, {
      action: 'project.created_from_meeting',
      entity_type: 'project',
      entity_id: project.id,
      after_value: { project_reference: project.project_reference, client_id: clientId, documents: createdDocs.length },
    })

    return NextResponse.json({
      project: { id: project.id, project_reference: project.project_reference, name: project.name },
      client: { id: clientId, name: clientName },
      documents: createdDocs,
    }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
