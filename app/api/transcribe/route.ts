import { NextRequest, NextResponse } from 'next/server'
import { denyBusinessOperation } from '@/lib/authz'

// ─── POST /api/transcribe ─────────────────────────────────────────
// Transcribe audio with Groq Whisper. Accepts any audio container Groq supports
// (webm, wav, mp3, m4a/mp4, ogg, flac, aac, …); no client-side format whitelist.
export async function POST(req: NextRequest) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied
  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio')

    if (!(audioFile instanceof File) || audioFile.size === 0) {
      return NextResponse.json({ error: 'Audio file is required.' }, { status: 400 })
    }

    if (audioFile.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: `Audio file too large: ${(audioFile.size / 1024 / 1024).toFixed(1)}MB. Maximum 25MB.` },
        { status: 400 }
      )
    }

    const groqApiKey = process.env.GROQ_API_KEY
    if (!groqApiKey) {
      return NextResponse.json({ error: 'Groq API key not configured.' }, { status: 500 })
    }

    // Normalise the filename extension for formats the browser records without
    // one (e.g. MediaRecorder producing audio/mp4).
    const type = audioFile.type || 'audio/webm'
    const extension = type.includes('mp4') ? 'm4a'
      : type.includes('mpeg') ? 'mp3'
      : type.includes('ogg') ? 'ogg'
      : type.includes('wav') ? 'wav'
      : type.includes('flac') ? 'flac'
      : type.includes('webm') ? 'webm'
      : 'audio'
    const fileName = /\.[a-z0-9]+$/i.test(audioFile.name)
      ? audioFile.name
      : `recording.${extension}`

    const upstream = new FormData()
    upstream.append('file', audioFile, fileName)
    upstream.append('model', 'whisper-large-v3')
    upstream.append('response_format', 'json')

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: upstream,
    })

    if (!groqResponse.ok) {
      const detail = (await groqResponse.text()).slice(0, 500)
      if (groqResponse.status === 401) {
        return NextResponse.json({ error: 'Groq API authentication failed. Check GROQ_API_KEY.' }, { status: 500 })
      }
      return NextResponse.json(
        { error: `Transcription failed (${groqResponse.status}): ${detail}` },
        { status: 502 }
      )
    }

    const payload = await groqResponse.json().catch(() => null)
    const transcript = (payload?.text || '').trim()
    if (!transcript) {
      return NextResponse.json({ error: 'No speech was detected in the audio.' }, { status: 422 })
    }

    return NextResponse.json({ transcript, success: true, fileName, contentType: type })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
