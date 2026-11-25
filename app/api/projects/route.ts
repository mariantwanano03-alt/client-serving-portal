import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/audit'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { ALL_ROLES, denyBusinessOperation, requireRole } from '@/lib/authz'

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

// ─── GET /api/projects ───────────────────────────────────────────────────────
// List projects with client info. Supports filtering by client.
export async function GET(req: NextRequest) {
  const denied = await requireRole(
    req,
    ALL_ROLES,
    'You do not have permission to view projects.'
  )
  if (denied) return denied
  try {
    const client = getAuthenticatedClient(req)
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')

    let query = client
      .from('projects')
      .select(`
        id,
        project_reference,
        name,
        description,
        stage,
        status,
        created_at,
        clients(client_code, name, email, primary_contact)
      `)
      .order('created_at', { ascending: false })

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST /api/projects ──────────────────────────────────────────────────────
// Create a new project for an existing client. Discovery-led creation goes
// through /api/discovery/approve, which creates the client first.
export async function POST(req: NextRequest) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    const client = getAuthenticatedClient(req)
    const body = await req.json()

    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Could not load user profile.' }, { status: 401 })
    }

    // Administrators are explicitly excluded — oversight role only.
    if (!['senior_dev_pm', 'junior_developer'].includes(profile.role) || profile.is_active === false) {
      return NextResponse.json(
        { error: 'Only active Senior Developers / PMs and Developers can create projects.' },
        { status: 403 }
      )
    }

    const { client_id, name, description } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Project name is required.' }, { status: 400 })
    }
    if (!client_id) {
      return NextResponse.json({ error: 'An existing client is required.' }, { status: 400 })
    }

    // Generate a unique project reference
    const projectRef = `PRJ-${Date.now().toString(36).toUpperCase()}`

    // INSERT ... RETURNING evaluates the scoped SELECT policy before the
    // creator's AFTER INSERT assignment can be read back. Insert with the
    // caller's client so RLS still enforces who may create, then read the
    // committed row through the service-role client for the response.
    const { error: insertError } = await client.from('projects').insert({
      project_reference: projectRef,
      client_id,
      name: name.trim(),
      description: description?.trim() || null,
      stage: 'create_project',
      status: 'draft',
      created_by: user.id,
    })
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('projects')
      .select(`
        *,
        clients(client_code, name, email, primary_contact)
      `)
      .eq('project_reference', projectRef)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || 'Could not load the created project.' },
        { status: 500 }
      )
    }

    // Audit entry
    await writeAudit(client, {
      action: 'project.created',
      entity_type: 'project',
      entity_id: data.id,
      after_value: {
        project_reference: data.project_reference,
        name: data.name,
        client_id: data.client_id,
        source: 'existing_client',
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
