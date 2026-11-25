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

// ─── POST /api/discovery-meetings/[id]/transcript ────────────────────────────
// Store a meeting transcript (text or uploaded file) linked to the discovery meeting.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    const { id } = await params
    const client = getAuthenticatedClient(req)

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

    if (!['senior_dev_pm', 'junior_developer'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    const { data: meeting, error: meetingError } = await client
      .from('discovery_meetings')
      .select('id, status, transcript_processed')
      .eq('id', id)
      .single()

    if (meetingError || !meeting) {
      return NextResponse.json({ error: 'Discovery meeting not found.' }, { status: 404 })
    }

    const body = await req.json()
    const { transcript_text, transcript_file_name, transcript_content_type } = body

    if (!transcript_text && !transcript_file_name) {
      return NextResponse.json({ error: 'Transcript text or file name is required.' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (transcript_text !== undefined) {
      updates.transcript_text = transcript_text
    }
    if (transcript_file_name !== undefined) {
      updates.transcript_file_name = transcript_file_name
    }
    if (transcript_content_type !== undefined) {
      updates.transcript_content_type = transcript_content_type
    }

    const { data, error } = await client
      .from('discovery_meetings')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeAudit(client, {
      action: 'discovery_meeting.transcript_recorded',
      entity_type: 'discovery_meeting',
      entity_id: id,
      after_value: {
        has_transcript_text: !!transcript_text,
        transcript_file_name,
      },
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
