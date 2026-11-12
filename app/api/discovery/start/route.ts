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
// Start a new discovery session (top-level entity, no client or project yet).
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

    const meetingTitle = body.meetingTitle || body.meeting_title || body.client_name || 'Untitled Meeting'
    const meetingDate = body.meetingDate || body.meeting_date || new Date().toISOString().split('T')[0]

    if (!meetingTitle || !meetingTitle.trim()) {
      return NextResponse.json(
        { error: 'Meeting title is required.' },
        { status: 400 }
      )
    }

    const sessionData = {
      meeting_title: meetingTitle.trim(),
      meeting_date: meetingDate,
      generation_status: 'pending',
      created_by: user.id,
    }

    const { data, error } = await client
      .from('discovery_sessions')
      .insert(sessionData)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ sessionId: data.id }, { status: 201 })
  } catch (err: any) {
    console.error('Discovery start failed:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
