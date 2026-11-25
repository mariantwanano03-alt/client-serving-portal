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

// Extract structured data from transcript text using pattern matching.
// No external AI service required — uses keyword/section-based extraction.
function extractFromTranscript(text: string): Record<string, unknown> {
  const extracted: Record<string, unknown> = {}

  const sections: Record<string, string[]> = {
    company_name: ['company name', 'client name', 'organization'],
    primary_contact: ['primary contact', 'contact person', 'main contact'],
    contact_email: ['email', 'e-mail'],
    contact_phone: ['phone', 'telephone', 'contact number'],
    company_address: ['address', 'location'],
    industry: ['industry', 'sector'],
    company_description: ['description', 'about the company', 'company overview'],
    business_requirements: ['business requirements', 'requirements', 'needs'],
    client_objectives: ['objectives', 'goals', 'aims'],
    problems_challenges: ['problems', 'challenges', 'pain points', 'issues'],
    required_services: ['required services', 'services needed', 'solutions'],
    proposed_solutions: ['proposed solutions', 'proposed solution', 'recommendations'],
    expected_deliverables: ['deliverables', 'expected deliverables'],
    additional_notes: ['additional notes', 'notes', 'other'],
  }

  const lines = text.split(/\r?\n/)

  for (const [field, keywords] of Object.entries(sections)) {
    let found = ''
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase()
      const matchedKeyword = keywords.find((k) => line.includes(k))
      if (matchedKeyword) {
        // Take the rest of the line after the keyword
        const idx = line.indexOf(matchedKeyword)
        found = lines[i].slice(idx + matchedKeyword.length).trim()
        // Also check next few lines for continuation
        const nextLines: string[] = []
        for (let j = 1; j <= 3 && i + j < lines.length; j++) {
          const nl = lines[i + j].trim()
          if (nl && !keywords.some((k) => nl.toLowerCase().includes(k))) {
            nextLines.push(nl)
          } else {
            break
          }
        }
        if (nextLines.length > 0) {
          found = found ? found + ' ' + nextLines.join(' ') : nextLines.join(' ')
        }
        break
      }
    }
    extracted[field] = found || null
  }

  // Identify uncertain/missing fields
  const missing: string[] = []
  for (const [field, value] of Object.entries(extracted)) {
    if (!value) {
      missing.push(field)
    }
  }

  return {
    extracted_data: extracted as Record<string, unknown>,
    missing_fields: missing,
    extraction_method: 'template_based',
    processed_at: new Date().toISOString(),
  }
}

// ─── POST /api/discovery-meetings/[id]/process ───────────────────────────────
// Process the transcript and extract structured client information.
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

    // Staff (never administrators) can process transcripts
    if (!['senior_dev_pm', 'junior_developer'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    // Verify meeting exists and has a transcript
    const { data: meeting, error: meetingError } = await client
      .from('discovery_meetings')
      .select('id, status, transcript_text, extraction_status')
      .eq('id', id)
      .single()

    if (meetingError || !meeting) {
      return NextResponse.json({ error: 'Discovery meeting not found.' }, { status: 404 })
    }

    if (!meeting.transcript_text) {
      return NextResponse.json(
        { error: 'No transcript available to process.' },
        { status: 400 }
      )
    }

    // Mark as processing
    await client
      .from('discovery_meetings')
      .update({ extraction_status: 'processing' })
      .eq('id', id)

    // Extract structured data
    const extraction = extractFromTranscript(meeting.transcript_text)

    // Update the meeting with extracted data
    const { data, error } = await client
      .from('discovery_meetings')
      .update({
        extraction_status: 'completed',
        extracted_data: extraction.extracted_data as Record<string, unknown>,
        transcript_processed: true,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      await client
        .from('discovery_meetings')
        .update({ extraction_status: 'failed' })
        .eq('id', id)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Audit entry
    await writeAudit(client, {
      action: 'discovery_meeting.transcript_processed',
      entity_type: 'discovery_meeting',
      entity_id: id,
      after_value: {
        extracted_fields: Object.keys(extraction.extracted_data as Record<string, unknown>).filter(
          (k) => (extraction.extracted_data as Record<string, unknown>)[k]
        ),
        missing_fields: extraction.missing_fields,
      },
    })

    return NextResponse.json({
      data,
      extraction: {
        missing_fields: extraction.missing_fields,
        method: extraction.extraction_method,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
