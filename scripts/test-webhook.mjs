import { createHmac, randomUUID } from 'node:crypto'

const [projectId, depositId, amount, eventId] = process.argv.slice(2)
const secret = process.env.PAYMENT_WEBHOOK_SECRET

if (!secret || !projectId || !amount) {
  console.log('Usage: node --env-file=.env.local scripts/test-webhook.mjs PROJECT_ID DEPOSIT_ID AMOUNT [EVENT_ID]')
  process.exit(1)
}

const body = JSON.stringify({
  event_id: eventId || 'test-' + randomUUID(),
  provider: 'test-sister-system',
  project_id: projectId,
  deposit_id: depositId === 'none' ? undefined : depositId,
  external_reference: 'TEST-' + Date.now(),
  amount: Number(amount),
  currency: 'ZAR',
  status: 'paid',
})

const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')

const res = await fetch('http://localhost:3000/api/webhooks/payment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-payment-signature': signature },
  body,
})

console.log(res.status, await res.text())
