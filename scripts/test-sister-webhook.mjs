import { createHmac, randomUUID } from 'node:crypto'

const eventType = process.argv[2]
const documentId = process.argv[3]
const secret = process.env.SISTER_WEBHOOK_SECRET

if (!secret) {
  console.log('Usage: node --env-file=.env.local scripts/test-sister-webhook.mjs <payment_confirmed|document_signed> [document_id]')
  process.exit(1)
}

let body

if (eventType === 'payment_confirmed') {
  body = JSON.stringify({
    event_type: 'payment_confirmed',
    event_id: 'test-' + randomUUID(),
    provider: 'test-sister-system',
    project_id: process.argv[3] || '123e4567-e89b-12d3-a456-426614174000',
    deposit_id: process.argv[4] || 'none',
    external_reference: 'TEST-' + Date.now(),
    amount: Number(process.argv[5] || 1000),
    currency: 'ZAR',
    status: 'paid',
  })
} else if (eventType === 'document_signed') {
  if (!documentId) {
    console.log('Usage: node --env-file=.env.local scripts/test-sister-webhook.mjs document_signed <DOCUMENT_UUID>')
    process.exit(1)
  }
  body = JSON.stringify({
    event_type: eventType,
    document_id: documentId,
    revision_id: documentId,
    signed_at: new Date().toISOString(),
  })
} else {
  console.log('Unknown event type. Use payment_confirmed or document_signed.')
  process.exit(1)
}

const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')

const res = await fetch('http://localhost:3000/api/webhooks/sister-system', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sister-signature': signature },
  body,
})

console.log(res.status, await res.text())
