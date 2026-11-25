import { NextRequest, NextResponse } from 'next/server'
import { authorizeMessageCaller } from '@/lib/message-server'

// ─── PATCH /api/messages/:threadId/read ──────────────────────────────────────
// Mark messages in a conversation as read. Called when the developer actually
// opens the conversation — never when the inbox list is loaded.
//
// Only tickets visible to the caller (via support_tickets SELECT RLS) are
// selected, and support_ticket_reads RLS rejects receipts for messages the
// caller cannot see, so a junior cannot mark an unassigned project's messages.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeMessageCaller(req)
  if (auth.response) return auth.response
  const { db, userId } = auth.caller
  const { threadId } = await params

  try {
    let requestedIds: string[] | null = null
    try {
      const body = await req.json()
      if (Array.isArray(body?.ticket_ids)) {
        requestedIds = body.ticket_ids.filter((id: unknown) => typeof id === 'string')
      }
    } catch {
      // Empty body means "mark every message in this thread".
    }

    let query = db.from('support_tickets').select('id').eq('thread_id', threadId)
    if (requestedIds) {
      if (requestedIds.length === 0) {
        return NextResponse.json({ marked: 0 })
      }
      query = query.in('id', requestedIds)
    }

    const { data: tickets, error: selectError } = await query
    if (selectError) {
      return NextResponse.json({ error: 'Could not update read status.' }, { status: 500 })
    }
    if (!tickets || tickets.length === 0) {
      return NextResponse.json(
        { error: 'Conversation not found or you do not have access.' },
        { status: 404 }
      )
    }

    const now = new Date().toISOString()
    const rows = tickets.map((ticket) => ({
      user_id: userId,
      ticket_id: ticket.id,
      read_at: now,
    }))

    const { error: upsertError } = await db
      .from('support_ticket_reads')
      .upsert(rows, { onConflict: 'user_id,ticket_id' })

    if (upsertError) {
      return NextResponse.json({ error: 'Could not update read status.' }, { status: 500 })
    }

    return NextResponse.json({ marked: rows.length })
  } catch {
    return NextResponse.json({ error: 'Could not update read status.' }, { status: 500 })
  }
}
