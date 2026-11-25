'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export type RecordingMeta = {
  fileName: string
  contentType: string
  durationSeconds: number
  storageRef: string | null
}

type AudioRecorderProps = {
  onTranscriptReady: (transcript: string, audioBlob: Blob | null, meta?: RecordingMeta) => void
  onAudioUploaded?: (storageRef: string, fileName: string, contentType: string, durationSeconds: number) => void
  disabled?: boolean
  className?: string
}

// Browsers differ in which container they can produce. Pick the first one that
// is actually supported instead of failing on a hard-coded "audio/webm".
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/wav',
  '',
]

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of CANDIDATE_MIME_TYPES) {
    if (!type || MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'm4a'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('wav')) return 'wav'
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  if (type.includes('flac')) return 'flac'
  return 'webm'
}

export function AudioRecorder({
  onTranscriptReady,
  onAudioUploaded,
  disabled = false,
  className,
}: AudioRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Live elapsed time for the finished blob. Reading `recordingTime` from the
  // startRecording closure would always report 0 in recorder.onstop.
  const elapsedRef = useRef(0)

  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioMeta, setAudioMeta] = useState<RecordingMeta | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const recorderSupported =
    typeof window !== 'undefined' && (typeof MediaRecorder !== 'undefined' || typeof (window as any).webkitMediaRecorder !== 'undefined') // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop())
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  // Keep the parent in sync whenever the editable transcript changes.
  useEffect(() => {
    if (transcript.trim()) {
      onTranscriptReady(transcript.trim(), audioBlob, audioMeta || undefined)
    }
  }, [transcript, audioBlob, audioMeta, onTranscriptReady])

  const transcribe = useCallback(async (blob: Blob, fileName: string, contentType: string, duration: number) => {
    setError(null)
    setNotice(null)
    setIsTranscribing(true)
    try {
      // /api/transcribe uses the same bearer-token guard as every other
      // protected route. Cookie-only requests are rejected with 401.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('Your session has expired. Sign in again before transcribing.')
      }

      const form = new FormData()
      form.append('audio', blob, fileName)
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error || 'Transcription failed. Please try again.')
      }
      const text = (result?.transcript || '').trim()
      if (!text) {
        setNotice('No speech was detected. You can type the transcript manually below.')
      } else {
        setTranscript(text)
        setNotice(`Transcribed ${fileName} successfully.`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transcription failed.')
    } finally {
      setIsTranscribing(false)
    }
    return duration
  }, [])

  const persistAudio = useCallback(async (blob: Blob, fileName: string, contentType: string, duration: number) => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id || 'anonymous'
      const path = `${userId}/${Date.now()}-${fileName}`
      const { error: uploadError } = await supabase.storage
        .from('meeting-transcripts')
        .upload(path, blob, { contentType: contentType || 'application/octet-stream', cacheControl: '3600', upsert: true })
      if (uploadError) {
        // Keep the transcription result visible if only the storage step fails.
        setNotice((current) =>
          `${current ? `${current} ` : ''}Audio storage unavailable: ${uploadError.message}`
        )
        return null
      }
      onAudioUploaded?.(path, fileName, contentType || 'application/octet-stream', duration)
      return path
    } catch {
      return null
    }
  }, [onAudioUploaded])

  const finishBlob = useCallback(async (blob: Blob, mime: string, duration: number) => {
    setAudioBlob(blob)
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(URL.createObjectURL(blob))
    const fileName = `meeting-${Date.now()}.${extensionFor(mime || blob.type || '')}`
    const contentType = mime || blob.type || 'application/octet-stream'
    await transcribe(blob, fileName, contentType, duration)
    const storageRef = await persistAudio(blob, fileName, contentType, duration)
    setAudioMeta({ fileName, contentType, durationSeconds: duration, storageRef })
  }, [audioUrl, transcribe, persistAudio])

  const startRecording = useCallback(async () => {
    if (disabled) return
    setError(null)
    setNotice(null)
    setTranscript('')
    setAudioBlob(null)
    setAudioMeta(null)
    audioChunksRef.current = []
    elapsedRef.current = 0

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is unavailable in this browser. Upload an audio file instead.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const Recorder = window.MediaRecorder || (window as any).webkitMediaRecorder // eslint-disable-line @typescript-eslint/no-explicit-any
      const recorder = new Recorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        void finishBlob(blob, recorder.mimeType || mimeType, elapsedRef.current)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      recorder.start(1000)
      setIsRecording(true)
      let seconds = 0
      setRecordingTime(0)
      timerRef.current = setInterval(() => {
        seconds += 1
        elapsedRef.current = seconds
        setRecordingTime(seconds)
      }, 1000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not access the microphone.')
    }
  }, [disabled, finishBlob])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setNotice(null)
    setTranscript('')
    const duration = audioMeta?.durationSeconds || 0
    await finishBlob(file, file.type || 'application/octet-stream', duration)
  }, [finishBlob, audioMeta])

  const clearAll = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setAudioBlob(null)
    setAudioMeta(null)
    setTranscript('')
    setError(null)
    setNotice(null)
    setRecordingTime(0)
    elapsedRef.current = 0
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const minutes = Math.floor(recordingTime / 60)
  const seconds = recordingTime % 60

  return (
    <div className={`portal-card ${className || ''}`} style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 24 }}>🎙️</span>
        <div>
          <h4 style={{ margin: 0, fontSize: 16, color: 'var(--heading)' }}>Record Discovery Meeting</h4>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Record audio or upload a file (WebM, WAV, MP3, M4A, OGG, FLAC and more). It is transcribed automatically.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 6, color: 'var(--error-text)', fontSize: 12, marginBottom: 14 }}>
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: 10, background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 6, color: 'var(--success-text)', fontSize: 12, marginBottom: 14 }}>
          ✓ {notice}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {recorderSupported && !isRecording && (
          <button type="button" onClick={startRecording} disabled={disabled} className="portal-btn-primary" style={{ height: 42, padding: '0 20px', fontSize: 13 }}>
            ⏺ Start Recording
          </button>
        )}
        {isRecording && (
          <>
            <button type="button" onClick={stopRecording} className="portal-btn-primary" style={{ height: 42, padding: '0 20px', fontSize: 13, background: 'var(--danger-strong)' }}>
              ⏹ Stop Recording
            </button>
            <span data-testid="recording-timer" style={{ fontSize: 14, fontWeight: 700, color: 'var(--heading)' }}>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </>
        )}
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="portal-btn-secondary" style={{ height: 42, padding: '0 20px', fontSize: 13 }}>
          📁 Upload audio file
        </button>
        <input
          ref={fileInputRef}
          data-testid="audio-file-input"
          type="file"
          accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg,.flac,.aac"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        {isTranscribing && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>⏳ Transcribing audio…</span>}
      </div>

      {!recorderSupported && (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          In-browser recording is unavailable here — use “Upload audio file” instead.
        </p>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
            Transcript (editable)
          </strong>
          <span data-testid="transcript-status" className="portal-badge badge-blue" style={{ fontSize: 10 }}>
            {isTranscribing ? 'transcribing' : transcript.trim() ? 'ready' : 'idle'}
          </span>
        </div>
        <textarea
          data-testid="transcript-input"
          className="form-input"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Your transcript will appear here. You can also type or paste it manually."
          style={{ minHeight: 110, resize: 'vertical' }}
          disabled={disabled}
        />
      </div>

      {audioUrl && (
        <div style={{ marginBottom: 12 }}>
          <audio controls src={audioUrl} style={{ width: '100%', maxWidth: 420 }} />
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {audioMeta?.fileName} · {audioMeta?.contentType}
          </p>
        </div>
      )}

      {(audioBlob || transcript) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={clearAll} className="portal-btn-secondary" style={{ height: 34, fontSize: 12 }}>
            🗑️ Clear recording
          </button>
        </div>
      )}
    </div>
  )
}

export default AudioRecorder
