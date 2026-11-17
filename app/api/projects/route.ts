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

// ─── GET /api/projects ───────────────────────────────────────────────────────
// List projects with client info. Supports filtering by client.
export async function GET(req: NextRequest) {
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
        is_provisional,
        client_creation_status,
        discovery_meeting_id,
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
// Create a new project. Two modes:
//   - existing client: provide client_id
//   - new client: omit client_id, creates a provisional project for discovery workflow
export async function POST(req: NextRequest) {
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

    // Only senior_dev_pm and administrator can create projects
    if (!['senior_dev_pm', 'administrator'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Only Senior Developers / PMs and Administrators can create projects.' },
        { status: 403 }
      )
    }

    const { client_id, name, description, discovery_meeting_id } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Project name is required.' }, { status: 400 })
    }

    // Generate a unique project reference
    const projectRef = `PRJ-${Date.now().toString(36).toUpperCase()}`

    const isProvisional = !client_id
    const clientCreationStatus = isProvisional ? 'pending' : 'not_required'

    const { data, error } = await client
      .from('projects')
      .insert({
        project_reference: projectRef,
        client_id: client_id || null,
        name: name.trim(),
        description: description?.trim() || null,
        stage: 'create_project',
        status: 'draft',
        is_provisional: isProvisional,
        client_creation_status: clientCreationStatus,
        discovery_meeting_id: discovery_meeting_id || null,
        created_by: user.id,
      })
      .select(`
        *,
        clients(client_code, name, email, primary_contact)
      `)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Audit entry
    await client.from('audit_entries').insert({
      actor_user_id: user.id,
      action: isProvisional ? 'project.created_provisional' : 'project.created',
      entity_type: 'project',
      entity_id: data.id,
      after_value: {
        project_reference: data.project_reference,
        name: data.name,
        client_id: data.client_id,
        is_provisional: data.is_provisional,
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
