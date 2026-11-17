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

// ─── GET /api/discovery-meetings ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const client = getAuthenticatedClient(req)
    const { data, error } = await client.from('discovery_meetings').select('*').order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST /api/discovery-meetings ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const client = getAuthenticatedClient(req)
    const body = await req.json()

    const required = ['client_name', 'primary_contact', 'meeting_date']
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json({ error: `${field} is required.` }, { status: 400 })
      }
    }

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

    const allowedRoles = ['senior_dev_pm', 'junior_developer', 'administrator']
    if (!allowedRoles.includes(profile.role)) {
      return NextResponse.json(
        { error: 'Only staff members can create discovery meetings.' },
        { status: 403 }
      )
    }

    const meetingData = {
      meeting_date: body.meeting_date,
      status: body.status || 'scheduled',
      client_name: body.client_name.trim(),
      primary_contact: body.primary_contact.trim(),
      contact_email: body.contact_email?.trim() || null,
      contact_phone: body.contact_phone?.trim() || null,
      company_address: body.company_address?.trim() || null,
      company_description: body.company_description?.trim() || null,
      industry: body.industry?.trim() || null,
      business_requirements: body.business_requirements?.trim() || null,
      client_objectives: body.client_objectives?.trim() || null,
      problems_challenges: body.problems_challenges?.trim() || null,
      required_services: body.required_services?.trim() || null,
      additional_notes: body.additional_notes?.trim() || null,
      transcript_text: body.transcript_text || null,
      audio_storage_ref: body.audio_storage_ref || null,
      audio_file_name: body.audio_file_name || null,
      audio_content_type: body.audio_content_type || null,
      audio_duration_seconds: body.audio_duration_seconds || null,
      created_by: user.id,
    }

    const { data, error } = await client.from('discovery_meetings').insert(meetingData).select().single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await client.from('audit_entries').insert({
      actor_user_id: user.id,
      action: 'discovery_meeting.created',
      entity_type: 'discovery_meeting',
      entity_id: data.id,
      after_value: { client_name: data.client_name, status: data.status },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
