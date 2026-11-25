import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { denyBusinessOperation } from '@/lib/authz'

// ─── POST /api/discovery/approve ─────────────────────────────────────────
// Approve a discovery meeting → auto-create client + project + documents.
// Approval creates clients, projects and documents, so it is senior-only.
export async function POST(req: Request) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    // 1. Get token from Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')

    // 2. Create a standard Supabase client with the user's token
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    const admin = getSupabaseAdmin()

    // 3. Verify the user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (approverProfile?.role !== 'senior_dev_pm') {
      return NextResponse.json(
        { error: 'Only Senior Developers / PMs can approve discovery meetings.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { id: meetingId } = body

    if (!meetingId) {
      return NextResponse.json({ error: 'Meeting id is required.' }, { status: 400 })
    }

    const { data: meeting, error: meetingError } = await supabase
      .from('discovery_meetings')
      .select('*')
      .eq('id', meetingId)
      .single()

    if (meetingError || !meeting) {
      return NextResponse.json({ error: 'Discovery meeting not found.' }, { status: 404 })
    }

    if (meeting.status === 'approved' && meeting.client_id) {
      // Idempotent: already approved. Return existing client/project.
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id, project_reference, client_id')
        .eq('client_id', meeting.client_id)
        .maybeSingle()
      return NextResponse.json({
        message: 'Meeting already approved.',
        client: { id: meeting.client_id },
        project: existingProject ? { id: existingProject.id, project_reference: existingProject.project_reference } : null,
        discoveryMeeting: { id: meetingId, status: 'approved', client_id: meeting.client_id },
      })
    }

    // ── Validate required client info ──
    const missing: string[] = []
    if (!meeting.client_name?.trim()) missing.push('Client/company name')
    if (!meeting.primary_contact?.trim()) missing.push('Primary contact person')
    // contact_email is optional for approval; if missing, we'll create client by name
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Cannot approve: required client information is missing.', missing },
        { status: 400 }
      )
    }

    // ── Link to existing client if email/name matches ──
    let clientId: string | null = null
    let clientCode: string | null = null
    let clientName: string | null = null

    if (meeting.contact_email) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name, client_code')
        .eq('email', meeting.contact_email)
        .maybeSingle()
      if (existing) {
        clientId = existing.id
        clientCode = existing.client_code
        clientName = existing.name
      }
    }
    if (!clientId) {
      const { data: existingByName } = await supabase
        .from('clients')
        .select('id, name, client_code, email')
        .ilike('name', meeting.client_name.trim())
        .maybeSingle()
      if (existingByName) {
        clientId = existingByName.id
        clientCode = existingByName.client_code
        clientName = existingByName.name
      }
    }

    // ── Create new client if needed ──
    if (!clientId) {
      const baseCode = meeting.client_name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CLIENT'
      let finalCode = baseCode
      let counter = 1
      while (true) {
        const { data: codeCheck } = await supabase.from('clients').select('id').eq('client_code', finalCode).maybeSingle()
        if (!codeCheck) break
        finalCode = `${baseCode}${counter}`
        counter++
      }

      const { error: clientError } = await supabase
        .from('clients')
        .insert({
          client_code: finalCode,
          name: meeting.client_name.trim(),
          email: meeting.contact_email || null,
          phone: meeting.contact_phone || null,
          primary_contact: meeting.primary_contact.trim(),
          billing_details: null,
          created_by: user.id,
        })

      if (clientError) {
        return NextResponse.json({ error: 'Could not create client: ' + clientError.message }, { status: 500 })
      }

      // RETURNING would apply the scoped SELECT policy before the new client
      // belongs to a project, so read the committed row with the service role.
      const { data: newClient, error: fetchClientError } = await admin
        .from('clients')
        .select('id, client_code, name')
        .eq('client_code', finalCode)
        .maybeSingle()
      if (fetchClientError || !newClient) {
        return NextResponse.json(
          { error: fetchClientError?.message || 'Could not load the created client.' },
          { status: 500 }
        )
      }

      clientId = newClient.id
      clientCode = newClient.client_code
      clientName = newClient.name
    }

    // ── Update meeting ──
    const { error: updateError } = await supabase
      .from('discovery_meetings')
      .update({ status: 'approved', client_id: clientId, updated_at: new Date().toISOString() })
      .eq('id', meetingId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await writeAudit(supabase, {
      action: 'discovery_meeting.approved',
      entity_type: 'discovery_meeting',
      entity_id: meetingId,
      after_value: { status: 'approved', client_id: clientId, client_name: clientName },
    })

    // ── Create project ──
    const projectRef = `PRJ-${Date.now().toString(36).toUpperCase()}`
    const { error: projError } = await supabase
      .from('projects')
      .insert({
        project_reference: projectRef,
        client_id: clientId,
        name: `${clientName} Project`,
        description: `Project created from Discovery Meeting ${meetingId.slice(0, 8)}.`,
        stage: 'create_project',
        status: 'draft',
        created_by: user.id,
      })

    if (projError) {
      // Non-fatal: client created, project failed
      await writeAudit(supabase, {
        action: 'discovery_meeting.approved_client_created',
        entity_type: 'discovery_meeting',
        entity_id: meetingId,
        before_value: { status: meeting.status, client_id: null },
        after_value: { status: 'approved', client_id: clientId, client_name: clientName, client_code: clientCode, project_creation_error: projError.message },
      })
      return NextResponse.json({
        message: 'Discovery meeting approved. Client created. Project association failed.',
        client: { id: clientId, client_code: clientCode, name: clientName },
        project: null,
        discoveryMeeting: { id: meetingId, status: 'approved', client_id: clientId },
        projectError: projError.message,
      }, { status: 207 })
    }

    const { data: newProject, error: fetchProjectError } = await admin
      .from('projects')
      .select('id, project_reference, client_id')
      .eq('project_reference', projectRef)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fetchProjectError || !newProject) {
      return NextResponse.json(
        { error: fetchProjectError?.message || 'Could not load the created project.' },
        { status: 500 }
      )
    }

    // ── Automatic document generation (PRD, SRS, Handover) ──
    const docGenerationResults: Record<string, { success: boolean; error?: string }> = {}

    const generateDocument = async (docType: string, title: string, content: string) => {
      try {
        const { data: docData, error: docErr } = await supabase
          .from('documents')
          .insert({
            project_id: newProject.id,
            title,
            type: docType,
            status: 'draft',
          })
          .select('id')
          .single()
        if (docErr || !docData) throw new Error(docErr?.message || 'Failed to create document')

        const { data: revData, error: revErr } = await supabase
          .from('document_revisions')
          .insert({
            document_id: docData.id,
            revision_no: 1,
            ai_generated: true,
            created_by: user.id,
            status: 'pending_review',
            content,
          })
          .select('id')
          .single()
        if (revErr || !revData) throw new Error(revErr?.message || 'Failed to create revision')

        await supabase.from('documents').update({ current_revision_id: revData.id }).eq('id', docData.id)

        await supabase.from('document_versions').insert({
          document_id: docData.id,
          revision_id: revData.id,
          version_no: 1,
          title,
          content,
          change_summary: 'Auto-generated from discovery meeting',
          created_by: user.id,
        })

        docGenerationResults[docType] = { success: true }
      } catch (err: unknown) {
        docGenerationResults[docType] = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    const generatePRD = (m: any, c: any) => `
# Product Requirements Document (PRD)

## Project Title
${c.name}

## Client Information
- **Company:** ${m.client_name || '—'}
- **Primary Contact:** ${m.primary_contact || '—'}
- **Email:** ${m.contact_email || '—'}
- **Phone:** ${m.contact_phone || '—'}
- **Address:** ${m.company_address || '—'}
- **Industry:** ${m.industry || '—'}

## Project Overview
This PRD defines the requirements for a client portal project for ${c.name}, derived from the approved Discovery Meeting.

## Background
The client requires a digital solution to manage their client relationships and project delivery more effectively.

## Problem Statement
${m.problems_challenges || 'Current processes are manual and inefficient.'}

## Business Objectives
${m.client_objectives || 'Improve operational efficiency and client satisfaction.'}

## Functional Requirements
${m.required_services || '—'}
- User authentication and role-based access control
- Client and project dashboards
- Document storage and sharing
- Communication and collaboration tools

## Non-Functional Requirements
- System must be accessible via web browser
- Data must be stored securely with appropriate access controls

## Stakeholders
- Primary Contact: ${m.primary_contact || '—'}
- Client: ${m.client_name || '—'}

## Expected Deliverables
${m.required_services || 'Functional client portal application'}

---
*Auto-generated from Discovery Meeting on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

    const generateSRS = (m: any, c: any) => `
# Software Requirements Specification (SRS)

## 1. Introduction

### 1.1 Purpose
This SRS specifies the software requirements for the ${c.name} client portal project.

### 1.2 System Overview
A web-based client serving portal that enables ${m.client_name || 'the client'} to manage their client relationships, track projects, and store documents.

## 2. System Functionality

### 2.1 Client Management
- Create, read, update, and delete client records
- Store client contact information and company details

### 2.2 Project Management
- Create and track projects associated with clients
- Assign project stages and statuses

## 3. Functional Requirements

### 3.1 Discovery Workflow
- Capture discovery meeting transcripts
- Automatic client creation upon discovery meeting approval
- Automatic document generation (PRD, SRS, Handover)

${m.business_requirements || '—'}

## 4. Non-Functional Requirements

### 4.1 Performance
- Page load time under 3 seconds for standard operations

### 4.2 Security
- All access requires authentication
- Role-based authorization enforced server-side

## 5. User Roles
- Administrator: Full system access
- Senior Developer / PM: Create clients, projects
- Junior Developer: View and assist

## 6. Data Requirements
- Client records: name, code, contact, address, industry
- Project records: reference, name, stage, status, client association
- Document records: title, type, content, version, approval status

---
*Auto-generated from Discovery Meeting on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

    const generateHandover = (m: any, c: any) => `# Developer Handover Document

# Project: ${c.name}

## Client Information
- **Company:** ${m.client_name || '—'}
- **Primary Contact:** ${m.primary_contact || '—'}
- **Email:** ${m.contact_email || '—'}
- **Phone:** ${m.contact_phone || '—'}
- **Address:** ${m.company_address || '—'}
- **Industry:** ${m.industry || '—'}

## Project Overview
This project involves delivering a client serving portal for ${c.name}.

## Approved Requirements
### Business Requirements
${m.business_requirements || '—'}

### Client Objectives
${m.client_objectives || '—'}

### Required Services
${m.required_services || '—'}

## Functional Specifications
- Client portal with authentication
- Client and project management dashboard
- Document upload and retrieval
- Activity audit trail

## Project Scope
**In Scope:**
- Client information management
- Project creation and tracking
- Document storage and versioning
- User role management

**Out of Scope:**
- Mobile native application
- Third-party integrations beyond authentication
- Payment processing

## Technical Requirements
- Next.js frontend with Supabase backend
- Role-based access control
- PostgreSQL database with RLS

## Outstanding Questions
${m.additional_notes || '—'}

## Acceptance Criteria
- Client can access the portal and view their information
- Project manager can create and track projects
- Documents can be uploaded, versioned, and approved
- All user actions are auditable

---
*Auto-generated Developer Handover on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

    await generateDocument('Specification (SOW)', `${clientName} - Product Requirements Document (PRD)`, generatePRD(meeting, { name: clientName }))
    await generateDocument('Technical Architecture', `${clientName} - Software Requirements Specification (SRS)`, generateSRS(meeting, { name: clientName }))
    await generateDocument('Handover Dossier', `${clientName} - Developer Handover Document`, generateHandover(meeting, { name: clientName }))

    await supabase.from('readiness_checks').upsert({
      project_id: newProject.id,
      run_by: user.id,
      result: 'pending',
    }, { onConflict: 'project_id' })

    await writeAudit(supabase, {
      action: 'discovery_meeting.documents_generated',
      entity_type: 'discovery_meeting',
      entity_id: meetingId,
      after_value: {
        project_id: newProject.id,
        project_reference: newProject.project_reference,
        documents: docGenerationResults,
      },
    })

    return NextResponse.json({
      message: 'Discovery meeting approved. Client and project created. Documents generated automatically.',
      client: { id: clientId, client_code: clientCode, name: clientName },
      project: { id: newProject.id, project_reference: newProject.project_reference },
      discoveryMeeting: { id: meetingId, status: 'approved', client_id: clientId },
      documents: docGenerationResults,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}