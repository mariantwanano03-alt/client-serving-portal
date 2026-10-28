import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const MAX_BODY_BYTES = 64 * 1024
const ACCEPTED_PAYMENT_STATUSES = new Set(['paid', 'confirmed', 'succeeded', 'settled'])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type JsonObject = Record<string, unknown>

function respond(status: number, body: JsonObject) {
  return NextResponse.json(body, { status })
}

function readString(body: JsonObject, keys: string[], maxLength: number): string | null {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, maxLength)
    }
  }
  return null
}

function readAmount(body: JsonObject): number | null {
  const value = body.amount
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false

  const provided = header.trim().replace(/^sha256=/i, '')
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
  const actual = Buffer.from(provided, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'Payment webhook is not configured. Set PAYMENT_WEBHOOK_SECRET, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.'
    )
    return respond(500, { error: 'webhook_not_configured' })
  }

  const rawBody = await request.text()

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return respond(413, { error: 'payload_too_large' })
  }

  const signature =
    request.headers.get('x-payment-signature') ?? request.headers.get('x-webhook-signature')

  if (!verifySignature(rawBody, signature, secret)) {
    return respond(401, { error: 'invalid_signature' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return respond(400, { error: 'invalid_json' })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return respond(400, { error: 'invalid_payload' })
  }

  const body = parsed as JsonObject
  const eventId = readString(body, ['event_id', 'eventId', 'id'], 200)
  const provider = readString(body, ['provider', 'source'], 80)
  const projectId = readString(body, ['project_id', 'projectId'], 64)
  const depositId = readString(body, ['deposit_id', 'depositId'], 64)
  const externalReference = readString(
    body,
    ['external_reference', 'externalReference', 'payment_reference', 'reference'],
    200
  )
  const currency = (readString(body, ['currency'], 3) ?? 'ZAR').toUpperCase()
  const paymentStatus = (readString(body, ['status'], 40) ?? 'paid').toLowerCase()
  const amount = readAmount(body)
  const paymentDate = readString(body, ['payment_date', 'paymentDate'], 10) ?? null

  if (!eventId) return respond(400, { error: 'event_id_required' })
  if (!provider) return respond(400, { error: 'provider_required' })
  if (!projectId || !UUID_PATTERN.test(projectId)) {
    return respond(400, { error: 'invalid_project_id' })
  }
  if (depositId && !UUID_PATTERN.test(depositId)) {
    return respond(400, { error: 'invalid_deposit_id' })
  }
  if (!externalReference) return respond(400, { error: 'external_reference_required' })
  if (amount === null || amount <= 0) return respond(400, { error: 'invalid_amount' })
  if (!/^[A-Z]{3}$/.test(currency)) return respond(400, { error: 'invalid_currency' })
  if (paymentDate && !DATE_PATTERN.test(paymentDate)) {
    return respond(400, { error: 'invalid_payment_date' })
  }

  // Failed / reversed / pending events are acknowledged but not recorded.
  if (!ACCEPTED_PAYMENT_STATUSES.has(paymentStatus)) {
    return respond(202, { status: 'ignored', reason: `payment_status_${paymentStatus}` })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('record_verified_payment', {
    p_provider: provider,
    p_event_id: eventId,
    p_external_reference: externalReference,
    p_project_id: projectId,
    p_deposit_id: depositId ?? null,
    p_amount: amount,
    p_currency: currency,
    p_payment_date: paymentDate,
    p_payload: body,
  })

  if (error) {
    if (error.message.includes('deposit_not_found')) {
      return respond(404, { error: 'deposit_not_found' })
    }
    if (error.message.includes('deposit_project_mismatch')) {
      return respond(409, { error: 'deposit_project_mismatch' })
    }
    if (error.code === '22023') {
      return respond(400, { error: error.message })
    }

    console.error('Payment webhook failed:', error)
    return respond(500, { error: 'payment_recording_failed' })
  }

  return respond(200, data as JsonObject)
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' })
}
