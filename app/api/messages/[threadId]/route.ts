import { NextRequest, NextResponse } from 'next/server'
import {
  authorizeMessageCaller,
  one,
  ticketToMessage,
  TICKET_SELECT,
  type TicketRow,
} from '@/lib/message-server'
import type { ConversationResponse, MessageAttachment } from '@/lib/message-types'

// ─── GET /api/messages/:threadId ─────────────────────────────────────────────
// Conversation history. RLS hides tickets from unauthorised projects; when a
// thread is not visible the caller gets 404 (no existence leak).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeMessageCaller(req)
  if (auth.response) return auth.response
  const { db, userId } = auth.caller
  const { threadId } = await params

  try {
    const [ticketsResult, readsResult] = await Promise.all([
      db
        .from('support_tickets')
        .select(TICKET_SELECT)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true }),
      db.from('support_ticket_reads').select('ticket_id').eq('user_id', userId),
    ])

    if (ticketsResult.error) {
      return NextResponse.json({ error: 'Could not load conversation.' }, { status: 500 })
    }

    const tickets = (ticketsResult.data ?? []) as unknown as TicketRow[]
    if (tickets.length === 0) {
      return NextResponse.json(
        { error: 'Conversation not found or you do not have access.' },
        { status: 404 }
      )
    }

    const readIds = new Set((readsResult.data ?? []).map((r) => r.ticket_id))
    const ticketIds = tickets.map((t) => t.id)

    // Attachments reuse the existing store (owner_type = 'support_ticket').
    // Clients have no attachment SELECT grant, so an empty result is expected
    // for them and must not break the conversation view.
    const { data: attachmentRows } = await db
      .from('attachments')
      .select('id, owner_id, file_name, content_type, size')
      .eq('owner_type', 'support_ticket')
      .in('owner_id', ticketIds)

    const attachmentsByTicket = new Map<string, MessageAttachment[]>()
    for (const row of attachmentRows ?? []) {
      const list = attachmentsByTicket.get(row.owner_id) ?? []
      list.push({
        id: row.id,
        file_name: row.file_name,
        content_type: row.content_type,
        size: row.size,
      })
      attachmentsByTicket.set(row.owner_id, list)
    }

    const messages = tickets.map((ticket) =>
      ticketToMessage(ticket, readIds, attachmentsByTicket)
    )

    const client = one(tickets[0].clients)
    const project = one(tickets[0].projects)

    const response: ConversationResponse = {
      thread_id: threadId,
      client: client ? { id: client.id, name: client.name } : null,
      project: project
        ? { id: project.id, name: project.name, project_reference: project.project_reference }
        : null,
      messages,
    }

    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: 'Could not load conversation.' }, { status: 500 })
  }
}
