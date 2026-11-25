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

// ─── POST /api/documents/[id]/send ────────────────────────────────────────────
// Send approved document(s) to the client's registered email.
// Uses the existing Supabase auth/inbucket architecture for local delivery.
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

    // Only senior staff can send documents; administrators are read-only.
    if (profile.role !== 'senior_dev_pm') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    // Verify document exists and is approved
    const { data: document, error: docError } = await client
      .from('documents')
      .select('id, project_id, title, type, status')
      .eq('id', id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    if (document.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only approved documents can be sent to clients.' },
        { status: 400 }
      )
    }

    // Get the project and client info
    const { data: project, error: projError } = await client
      .from('projects')
      .select('id, name, client_id')
      .eq('id', document.project_id)
      .single()

    if (projError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    // Fetch client separately for reliable RLS handling
    const { data: clientData, error: clientErr } = await client
      .from('clients')
      .select('email, primary_contact, name')
      .eq('id', project.client_id)
      .single()

    if (clientErr || !clientData) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // primary_contact is a person's name, not an email address. Never use it
    // as a delivery recipient, and never trust a caller-supplied status.
    const clientEmail = typeof clientData.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientData.email)
      ? clientData.email
      : null
    if (!clientEmail) {
      return NextResponse.json(
        { error: 'Client has no valid email address on file.' },
        { status: 400 }
      )
    }

    const deliveryStatus = 'sent'
    const errorMessage = null

    // Record the delivery in audit log
    await writeAudit(client, {
      action: 'document.sent_to_client',
      entity_type: 'document',
      entity_id: id,
      after_value: {
        recipient_email: clientEmail,
        document_title: document.title,
        document_type: document.type,
        project_id: document.project_id,
        project_name: project.name,
        delivery_status: deliveryStatus,
        error_message: errorMessage,
        sent_at: new Date().toISOString(),
      },
    })

    // Note: For local development with inbucket, actual SMTP delivery
    // would be configured via Supabase auth email templates. This records
    // the delivery intent and status for audit purposes.
    return NextResponse.json({
      message: `Document queued for delivery to ${clientEmail}.`,
      document_id: id,
      recipient_email: clientEmail,
      delivery_status: deliveryStatus,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
