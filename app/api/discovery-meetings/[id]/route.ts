import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// Helper: get an authenticated supabase client from the request
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

// ─── GET /api/discovery-meetings/[id] ──────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const client = getAuthenticatedClient(_req)

    const { data, error } = await client.from('discovery_meetings').select('*').eq('id', id).single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Discovery meeting not found.' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH /api/discovery-meetings/[id] ────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const client = getAuthenticatedClient(req)
    const body = await req.json()

    const { data: { user }, error: userError } = await client.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const { data: meeting, error: meetingError } = await client
      .from('discovery_meetings')
      .select('*')
      .eq('id', id)
      .single()

    if (meetingError || !meeting) {
      return NextResponse.json({ error: 'Discovery meeting not found.' }, { status: 404 })
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Could not load user profile.' }, { status: 401 })
    }

    const isSeniorOrAdmin = ['senior_dev_pm', 'administrator'].includes(profile.role)

    // ── Handle status change to 'approved' → auto-create client ──
    if (body.status === 'approved' && meeting.status !== 'approved') {
      if (!isSeniorOrAdmin) {
        return NextResponse.json(
          { error: 'Only Senior Developers / PMs and Administrators can approve discovery meetings.' },
          { status: 403 }
        )
      }

      if (meeting.client_id) {
        return NextResponse.json(
          { error: 'This discovery meeting has already been approved and linked to a client.' },
          { status: 409 }
        )
      }

      const missing: string[] = []
      if (!meeting.client_name?.trim()) missing.push('Client/company name')
      if (!meeting.primary_contact?.trim()) missing.push('Primary contact person')
      if (!meeting.contact_email?.trim()) missing.push('Contact email')

      if (missing.length > 0) {
        return NextResponse.json(
          { error: 'Cannot approve: required client information is missing.', missing },
          { status: 400 }
        )
      }

      if (meeting.contact_email) {
        const { data: existing } = await client
          .from('clients')
          .select('id, name, client_code')
          .eq('email', meeting.contact_email)
          .maybeSingle()

        if (existing) {
          const { error: linkError } = await client
            .from('discovery_meetings')
            .update({ status: 'approved', client_id: existing.id, updated_at: new Date().toISOString() })
            .eq('id', id)

          if (linkError) {
            return NextResponse.json({ error: linkError.message }, { status: 500 })
          }

          await client.from('audit_entries').insert({
            actor_user_id: user.id,
            action: 'discovery_meeting.approved_existing_client',
            entity_type: 'discovery_meeting',
            entity_id: id,
            after_value: { client_id: existing.id, client_name: existing.name, linked_existing: true },
          })

          return NextResponse.json({ message: 'Discovery meeting approved and linked to existing client.', client: existing })
        }
      }

      const { data: existingByName } = await client
        .from('clients')
        .select('id, name, client_code, email')
        .ilike('name', meeting.client_name.trim())
        .maybeSingle()

      if (existingByName) {
        const { error: linkError } = await client
          .from('discovery_meetings')
          .update({ status: 'approved', client_id: existingByName.id, updated_at: new Date().toISOString() })
          .eq('id', id)

        if (linkError) {
          return NextResponse.json({ error: linkError.message }, { status: 500 })
        }

        await client.from('audit_entries').insert({
          actor_user_id: user.id,
          action: 'discovery_meeting.approved_existing_client',
          entity_type: 'discovery_meeting',
          entity_id: id,
          after_value: { client_id: existingByName.id, client_name: existingByName.name, linked_existing: true },
        })

        return NextResponse.json({ message: 'Discovery meeting approved and linked to existing client.', client: existingByName })
      }

      const clientCode = meeting.client_name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CLIENT'
      let finalCode = clientCode
      let counter = 1
      while (true) {
        const { data: codeCheck } = await client.from('clients').select('id').eq('client_code', finalCode).maybeSingle()
        if (!codeCheck) break
        finalCode = `${clientCode}${counter}`
        counter++
      }

      const { data: newClient, error: clientError } = await client
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
        .select()
        .single()

      if (clientError) {
        return NextResponse.json({ error: 'Could not create client: ' + clientError.message }, { status: 500 })
      }

      const { error: updateError } = await client
        .from('discovery_meetings')
        .update({ status: 'approved', client_id: newClient.id, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (updateError) {
        await client.from('clients').delete().eq('id', newClient.id)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // ── Create provisional project associated with the new client ──
      const projectRef = `PRJ-${Date.now().toString(36).toUpperCase()}`
      const { data: newProject, error: projError } = await client
        .from('projects')
        .insert({
          project_reference: projectRef,
          client_id: newClient.id,
          name: `${meeting.client_name.trim()} Project`,
          description: `Project created from Discovery Meeting ${meeting.id.slice(0, 8)}.`,
          stage: 'create_project',
          status: 'draft',
          is_provisional: false,
          client_creation_status: 'created',
          discovery_meeting_id: id,
          created_by: user.id,
        })
        .select()
        .single()

      if (projError) {
        // Non-fatal: client was created, project association failed
        await client.from('audit_entries').insert({
          actor_user_id: user.id,
          action: 'discovery_meeting.approved_client_created',
          entity_type: 'discovery_meeting',
          entity_id: id,
          before_value: { status: meeting.status, client_id: null },
          after_value: {
            status: 'approved',
            client_id: newClient.id,
            client_name: newClient.name,
            client_code: newClient.client_code,
            project_creation_error: projError.message,
          },
        })
        return NextResponse.json({
          message: 'Discovery meeting approved. Client created. Project association failed.',
          client: newClient,
          discoveryMeeting: { id, status: 'approved', client_id: newClient.id },
          projectError: projError.message,
        }, { status: 207 })
      }

      // Link project to discovery meeting
      await client
        .from('discovery_meetings')
        .update({ client_id: newClient.id })
        .eq('id', id)

      // ── Automatic document generation ──
      const docGenerationResults: Record<string, { success: boolean; error?: string }> = {}

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generateDocument = async (docType: string, title: string, contentGenerator: (m: any, c: any) => string) => {
        try {
          const { data: docData, error: docErr } = await client
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

          const content = contentGenerator(meeting, newClient)

          const { data: revData, error: revErr } = await client
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

          await client
            .from('documents')
            .update({ current_revision_id: revData.id })
            .eq('id', docData.id)

          // Document version snapshot
          await client.from('document_versions').insert({
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

      // Template-based document generators (no external AI service)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generatePRD = (m: any, client: any) => `
# Product Requirements Document (PRD)

## Project Title
${client.name}

## Client Information
- **Company:** ${m.client_name || '—'}
- **Primary Contact:** ${m.primary_contact || '—'}
- **Email:** ${m.contact_email || '—'}
- **Phone:** ${m.contact_phone || '—'}
- **Address:** ${m.company_address || '—'}
- **Industry:** ${m.industry || '—'}

## Project Overview
This PRD defines the requirements for a client portal project for ${client.name}, derived from the approved Discovery Meeting.

## Background
The client requires a digital solution to manage their client relationships and project delivery more effectively.

## Problem Statement
${m.problems_challenges || 'Current processes are manual and inefficient. No centralized system for managing client information.'}

## Business Objectives
${m.client_objectives || 'Improve operational efficiency and client satisfaction.'}

## Project Scope
The project includes the development of a client serving portal with the following capabilities:
- Client information management
- Project tracking and status updates
- Document storage and sharing
- Communication and collaboration tools

## Functional Requirements
${m.required_services || '—'}
- User authentication and role-based access control
- Client and project dashboards
- Document upload and download
- Activity audit logging

## Non-Functional Requirements
- System must be accessible via web browser
- Data must be stored securely with appropriate access controls
- System must support multiple concurrent users

## Stakeholders
- Primary Contact: ${m.primary_contact || '—'}
- Client: ${m.client_name || '—'}
- Project Team: Internal development team

## Expected Deliverables
${m.expected_deliverables || m.required_services || 'Functional client portal application'}

## Assumptions
- Client will provide timely feedback during development
- Client has internet access for portal usage

## Constraints
- Must integrate with existing authentication system
- Must comply with data protection requirements

## Acceptance Criteria
- Client can log in and view their information
- Projects can be created and tracked
- Documents can be uploaded and downloaded
- All user actions are audited

---
*Auto-generated from Discovery Meeting on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generateSRS = (m: any, client: any) => `
# Software Requirements Specification (SRS)

## 1. Introduction

### 1.1 Purpose
This SRS specifies the software requirements for the ${client.name} client portal project.

### 1.2 System Overview
A web-based client serving portal that enables ${m.client_name || 'the client'} to manage their client relationships, track projects, and store documents.

## 2. System Functionality

### 2.1 Client Management
- Create, read, update, and delete client records
- Store client contact information and company details
- Track client association with projects

### 2.2 Project Management
- Create and track projects associated with clients
- Assign project stages and statuses
- Record project milestones and deliverables

### 2.3 Document Management
- Upload and download project documents
- Version control for documents
- Document approval workflow

### 2.4 User Management
- Role-based access control (Administrator, Senior Dev/PM, Junior Developer)
- User authentication and session management
- Audit logging of user actions

## 3. Functional Requirements

### 3.1 Discovery Workflow
- Capture discovery meeting transcripts
- AI-assisted extraction of client information
- Automatic client creation upon transcript approval
- Automatic document generation (PRD, SRS, Handover)

${m.business_requirements || '—'}

## 4. Non-Functional Requirements

### 4.1 Performance
- Page load time under 3 seconds for standard operations

### 4.2 Security
- All access requires authentication
- Role-based authorization enforced server-side
- Data transmitted over HTTPS

### 4.3 Reliability
- Automated backup of critical data
- Error handling and retry mechanisms

## 5. User Roles
- Administrator: Full system access including user management
- Senior Developer / PM: Create clients, projects, approve documents
- Junior Developer: View and assist with requirements and handover

## 6. Data Requirements
- Client records: name, code, contact, address, industry
- Project records: reference, name, stage, status, client association
- Document records: title, type, content, version, approval status

## 7. External Interfaces
- Web browser interface (desktop and mobile)
- Supabase authentication and database
- Email notifications (where configured)

## 8. System Constraints
- Must use existing Supabase database schema
- Must preserve existing audit logging
- Must not introduce paid external services

## 9. Acceptance Criteria
- All critical user stories can be completed
- Role-based access is enforced
- Documents are versioned and approvable

### Known Uncertainties / Items for Review
${m.problems_challenges ? '—' : 'Technical architecture decisions pending client review.'}
${m.required_services ? 'Specific technology stack to be confirmed.' : '—'}

---
*Auto-generated from Discovery Meeting on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generateHandover = (m: any, client: any) => `# Developer Handover Document

# Project: ${client.name}

## Client Information
- **Company:** ${m.client_name || '—'}
- **Primary Contact:** ${m.primary_contact || '—'}
- **Email:** ${m.contact_email || '—'}
- **Phone:** ${m.contact_phone || '—'}
- **Address:** ${m.company_address || '—'}
- **Industry:** ${m.industry || '—'}

## Project Overview
This project involves delivering a client serving portal for ${client.name}. The following information has been extracted from the approved Discovery Meeting and should be used by the development team to begin implementation.

## Business Problem
${m.problems_challenges || 'The client currently manages their operations through manual, paper-based processes that are inefficient and lack centralization.'}

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

## Non-Functional Requirements
- Web-based access
- Secure data storage
- Multi-user support

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
- Document storage and PDF generation

## Outstanding Questions
${m.additional_notes || '—'}
- Confirm preferred technology stack with client
- Confirm hosting and deployment requirements

## Acceptance Criteria
- Client can access the portal and view their information
- Project manager can create and track projects
- Documents can be uploaded, versioned, and approved
- All user actions are auditable

## Important Implementation Notes
- This document was auto-generated from the Discovery Meeting transcript
- Review all extracted information before beginning development
- Confirm any unclear requirements with the client or project manager
- Follow existing coding standards and patterns in the codebase

---
*Auto-generated Developer Handover on ${new Date().toISOString()}*
*Document status: Pending Review*
`.trim()

      await generateDocument('Specification (SOW)', `${newClient.name} - Product Requirements Document (PRD)`, generatePRD)
      await generateDocument('Technical Architecture', `${newClient.name} - Software Requirements Specification (SRS)`, generateSRS)
      await generateDocument('Handover Dossier', `${newClient.name} - Developer Handover Document`, generateHandover)

      // Update readiness checklist to reflect document status
      await client
        .from('readiness_checks')
        .upsert({
          project_id: newProject.id,
          run_by: user.id,
          result: 'pending',
        }, { onConflict: 'project_id' })

      // Record audit entry for document generation
      await client.from('audit_entries').insert({
        actor_user_id: user.id,
        action: 'discovery_meeting.documents_generated',
        entity_type: 'discovery_meeting',
        entity_id: id,
        after_value: {
          project_id: newProject.id,
          project_reference: newProject.project_reference,
          documents: docGenerationResults,
        },
      })

      return NextResponse.json({
        message: 'Discovery meeting approved. Client and project created. Documents generated automatically.',
        client: newClient,
        project: newProject,
        discoveryMeeting: { id, status: 'approved', client_id: newClient.id },
        documents: docGenerationResults,
      })
    }

    // ── Handle status change to 'rejected' ───────────────────────────────
    if (body.status === 'rejected' && meeting.status !== 'rejected') {
      if (!isSeniorOrAdmin) {
        return NextResponse.json(
          { error: 'Only Senior Developers / PMs and Administrators can reject discovery meetings.' },
          { status: 403 }
        )
      }

      const { error: updateError } = await client
        .from('discovery_meetings')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      await client.from('audit_entries').insert({
        actor_user_id: user.id,
        action: 'discovery_meeting.rejected',
        entity_type: 'discovery_meeting',
        entity_id: id,
        after_value: { status: 'rejected' },
      })

      return NextResponse.json({ message: 'Discovery meeting rejected. No client was created.' })
    }

    // ── Handle generic field updates ─────────────────────────────────────
    const updatableFields = [
      'meeting_date', 'client_name', 'primary_contact', 'contact_email', 'contact_phone',
      'company_address', 'company_description', 'industry', 'business_requirements',
      'client_objectives', 'problems_challenges', 'required_services', 'additional_notes',
      'discovery_document_content',
    ]

    const updates: Record<string, unknown> = {}
    for (const field of updatableFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field] === '' ? null : body[field]
      }
    }
    updates.updated_at = new Date().toISOString()

    if (body.status !== undefined && !isSeniorOrAdmin) {
      delete updates.status
    }

    const { data: updated, error: updateError } = await client
      .from('discovery_meetings')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ data: updated })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
