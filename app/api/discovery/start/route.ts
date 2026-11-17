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

// ─── POST /api/discovery/start ───────────────────────────────────────────
// Start a new discovery meeting (pre-client record).
export async function POST(req: NextRequest) {
  try {
    const client = getAuthenticatedClient(req)

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

    // Staff can start discovery meetings
    if (!['senior_dev_pm', 'junior_developer', 'administrator'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Only staff members can start discovery meetings.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { meeting_date, client_name, primary_contact } = body

    if (!meeting_date || !client_name || !primary_contact) {
      return NextResponse.json(
        { error: 'meeting_date, client_name and primary_contact are required.' },
        { status: 400 }
      )
    }

    const meetingData = {
      meeting_date,
      status: 'scheduled',
      client_name: client_name.trim(),
      primary_contact: primary_contact.trim(),
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
      created_by: user.id,
    }

    const { data, error } = await client
      .from('discovery_meetings')
      .insert(meetingData)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: any) {
    console.error('Discovery start failed:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
