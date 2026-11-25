import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { denyBusinessOperation } from '@/lib/authz'

// ─── POST /api/discovery/start ───────────────────────────────────────────
// Start a new discovery meeting (pre-client record).
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

    // 3. Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Could not load user profile.' }, { status: 401 })
    }

    // Staff (never administrators) can start discovery meetings
    if (!['senior_dev_pm', 'junior_developer'].includes(profile.role) || profile.is_active === false) {
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

    const { data, error: dbError } = await supabase
      .from('discovery_meetings')
      .insert(meetingData)
      .select()
      .single()

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}