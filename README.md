This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## External payment verification

Deposits are confirmed only by the signed payment webhook at
`POST /api/webhooks/payment`. The manual “Confirm Payment” button has been
removed; browser sessions cannot insert or update `payment_confirmations`.

Set these server-side environment variables (never expose the service role key
to the browser):

```bash
SUPABASE_SERVICE_ROLE_KEY=...
PAYMENT_WEBHOOK_SECRET=...
```

The sender signs the exact raw request body with HMAC-SHA256 and sends the
hex digest as `X-Payment-Signature: sha256=<digest>`. A minimal payload:

```json
{
  "event_id": "evt_20261028_001",
  "provider": "accounting_system",
  "project_id": "40c6ced7-bb34-43d5-a190-89ab46fc6fc4",
  "deposit_id": "…",
  "external_reference": "PAY-2026-00123",
  "amount": 12500,
  "currency": "ZAR",
  "payment_date": "2026-10-28",
  "status": "paid"
}
```

`deposit_id` is optional when the milestone already stores the same
`external_reference`. The webhook records the confirmation with system actor
metadata, marks the deposit `paid`, and writes a `payment.externally_verified`
audit entry. Replayed event IDs or references return `200` with
`"status": "duplicate"` and do not double-record the payment.

Local smoke test:

```bash
BODY='{"event_id":"evt_local_1","provider":"local_test","project_id":"<project-uuid>","deposit_id":"<deposit-uuid>","external_reference":"PAY-LOCAL-1","amount":100,"currency":"ZAR","status":"paid"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST http://localhost:3001/api/webhooks/payment \
  -H 'Content-Type: application/json' \
  -H "X-Payment-Signature: sha256=$SIG" \
  --data "$BODY"
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
