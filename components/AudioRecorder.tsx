'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'

type AudioRecorderProps = {
  onTranscriptReady: (transcript: string, audioBlob: Blob | null) => void
  onAudioUploaded?: (storageRef: string, fileName: string, contentType: string, durationSeconds: number) => void
  disabled?: boolean
  className?: string
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
  const recognitionRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'transcribing' | 'done' | 'error'>('idle')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check browser support
  const isSupported =
    typeof window !== 'undefined' &&
    !!(window.MediaRecorder || (window as any).webkitMediaRecorder) && // eslint-disable-line @typescript-eslint/no-explicit-any
    !!(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === 'undefined') return
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' '
        } else {
          interimTranscript += transcript
        }
      }

      setTranscript((prev) => prev + finalTranscript)
      setInterimTranscript(interimTranscript)
    }

    recognition.onerror = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error('Speech recognition error:', event.error)
      setTranscriptStatus('error')
    }

    recognition.onend = () => {
      setTranscriptStatus('done')
    }

    recognitionRef.current = recognition
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (disabled) return
    setError(null)
    setTranscript('')
    setInterimTranscript('')
    setTranscriptStatus('idle')
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const MediaRecorder = window.MediaRecorder || (window as any).webkitMediaRecorder // eslint-disable-line @typescript-eslint/no-explicit-any
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }

        // Auto-transcribe if we have transcript text
        if (transcript.trim()) {
          setTranscriptStatus('transcribing')
          // The transcript will be processed by the parent via onTranscriptReady
          onTranscriptReady(transcript.trim(), blob)
        }
      }

      recorder.start(1000) // collect data every second
      setIsRecording(true)
      setIsPaused(false)

      // Start speech recognition
      if (recognitionRef.current) {
        recognitionRef.current.start()
        setTranscriptStatus('transcribing')
      }

      // Timer
      let seconds = 0
      setRecordingTime(0)
      timerRef.current = setInterval(() => {
        seconds++
        setRecordingTime(seconds)
      }, 1000)
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error('Microphone access error:', err)
      setError('Could not access microphone. Please ensure microphone permissions are granted.')
    }
  }, [disabled, onTranscriptReady, transcript])

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current || !isRecording) return
    mediaRecorderRef.current.stop()
    setIsRecording(false)
    setIsPaused(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [isRecording])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleUpload = async () => {
    if (!audioUrl) return
    try {
      const response = await fetch(audioUrl)
      const blob = await response.blob()
      const fileName = `meeting-${Date.now()}.webm`

      // Upload to Supabase storage
      const { supabase } = await import('@/lib/supabase')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        return
      }

      const filePath = `${user.id}/${fileName}`
      const { error: uploadError } = await supabase.storage
        .from('meeting-transcripts')
        .upload(filePath, blob, {
          contentType: 'audio/webm',
          cacheControl: '3600',
        })

      if (uploadError) {
        setError(uploadError.message)
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('meeting-transcripts')
        .getPublicUrl(filePath)

      const durationSeconds = Math.round(recordingTime)

      onAudioUploaded?.(publicUrl, fileName, 'audio/webm', durationSeconds)
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Upload failed')
    }
  }

  if (!isSupported) {
    return (
      <div className={`portal-card ${className || ''}`} style={{ padding: 20 }}>
        <div style={{ color: '#b91c1c', fontSize: 13 }}>
          ⚠️ Audio recording is not supported in this browser. Please use Chrome, Edge, or Safari.
        </div>
      </div>
    )
  }

  const recordingMinutes = Math.floor(recordingTime / 60)
  const recordingSeconds = recordingTime % 60

  return (
    <div className={`portal-card ${className || ''}`} style={{ padding: 24, maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🎙️</span>
        <div>
          <h4 style={{ margin: 0, fontSize: 16, color: '#14213d' }}>Record Discovery Meeting</h4>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Record the meeting audio. It will be transcribed automatically and used to fill in the client details.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            background: '#fef2f2',
            border: '1px solid #fee2e2',
            borderRadius: 6,
            color: '#b91c1c',
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Recording Controls */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
        {!isRecording && (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="portal-btn-primary"
            style={{ height: 44, padding: '0 24px', fontSize: 14, background: '#dc2626' }}
          >
            ⏺ Start Recording
          </button>
        )}
        {isRecording && (
          <>
            <button
              type="button"
              onClick={stopRecording}
              className="portal-btn-primary"
              style={{ height: 44, padding: '0 24px', fontSize: 14, background: '#dc2626' }}
            >
            ⏹ Stop Recording
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#14213d' }}>
              {recordingMinutes.toString().padStart(2, '0')}:{recordingSeconds.toString().padStart(2, '0')}
            </span>
          </>
        )}
      </div>

      {/* Transcript Display */}
      {transcript || interimTranscript ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                Live Transcript
              </strong>
              <span
                className={`portal-badge ${transcriptStatus === 'transcribing' ? 'badge-blue' : transcriptStatus === 'done' ? 'badge-green' : 'badge-gray'}`}
                style={{ fontSize: 10 }}
              >
                {transcriptStatus}
              </span>
            </div>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.6,
                color: '#1e293b',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {transcript}{interimTranscript && <span style={{ color: '#64748b', fontStyle: 'italic' }}>{interimTranscript}</span>}
            </div>
          </div>
        </>
      ) : null}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!isRecording && transcript && audioUrl && (
          <button
            type="button"
            onClick={handleUpload}
            disabled={disabled}
            className="portal-btn-primary"
            style={{ height: 36, padding: '0 16px', fontSize: 13 }}
          >
            📤 Save Recording & Use Transcript
          </button>
        )}
        {!isRecording && audioUrl && (
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(audioUrl)
              setAudioUrl(null)
              setTranscript('')
              setInterimTranscript('')
              setTranscriptStatus('idle')
              setError(null)
            }}
            className="portal-btn-secondary"
            style={{ height: 36, padding: '0 16px', fontSize: 13 }}
          >
            🗑️ Discard
          </button>
        )}
      </div>
    </div>
  )
}
