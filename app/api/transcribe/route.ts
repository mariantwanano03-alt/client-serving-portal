import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  let recordId: string | null = null
  try {
    const body = await req.json()
    const { audioUrl } = body
    recordId = body.recordId
    if (!audioUrl || !recordId) {
      return NextResponse.json({ error: 'Missing audioUrl or recordId' }, { status: 400 })
    }
    // 1. Extract file path from the URL (after bucket name)
    const urlParts = audioUrl.split('/meeting-transcripts/')
    const filePath = urlParts.length > 1 ? urlParts[1].split('?')[0] : null
    if (!filePath) throw new Error('Could not parse file path from URL')
    // 2. Download securely via admin client
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('meeting-transcripts')
      .download(filePath)
    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`)
    if (!fileData) throw new Error('No file data returned from storage')
    // 3. Send to Groq Whisper
    const file = new File([fileData], 'audio.webm', { type: 'audio/webm' })
    const formData = new FormData()
    formData.append('file', file)
    formData.append('model', 'whisper-large-v3-turbo')
    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: formData,
    })
    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      throw new Error(`Groq API error (${groqResponse.status}): ${errorText}`)
    }
    const transcription = await groqResponse.json()
    const transcriptText: string = transcription.text || ''
    // 4. Try saving to discovery_sessions (new flow)
    const { data: sessionRow } = await supabaseAdmin
      .from('discovery_sessions')
      .select('id')
      .eq('id', recordId)
      .maybeSingle()
    if (sessionRow) {
      await supabaseAdmin
        .from('discovery_sessions')
        .update({ transcript: transcriptText, updated_at: new Date().toISOString() })
        .eq('id', recordId)
    } else {
      // Legacy: save to discovery_records
      await supabaseAdmin
        .from('discovery_records')
        .update({ transcript: transcriptText, transcription_status: 'completed' })
        .eq('id', recordId)
    }
    return NextResponse.json({ success: true, transcript: transcriptText })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('Transcription error:', msg)
    if (recordId) {
      try {
        await supabaseAdmin
          .from('discovery_records')
          .update({ transcription_status: 'failed' })
          .eq('id', recordId)
      } catch {
        // ignore
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
