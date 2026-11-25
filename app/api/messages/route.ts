import { NextRequest, NextResponse } from 'next/server'
import { authorizeMessageCaller, one, TICKET_SELECT, type TicketRow } from '@/lib/message-server'
import type { ConversationSummary } from '@/lib/message-types'

// ─── GET /api/messages ───────────────────────────────────────────────────────
// Inbox: one row per conversation thread with unread counts.
// RLS on support_tickets limits rows to the caller's authorised projects.
export async function GET(req: NextRequest) {
  const auth = await authorizeMessageCaller(req)
  if (auth.response) return auth.response
  const { db, userId } = auth.caller

  try {
    const [ticketsResult, readsResult] = await Promise.all([
      db
        .from('support_tickets')
        .select(TICKET_SELECT)
        .order('created_at', { ascending: false }),
      db.from('support_ticket_reads').select('ticket_id, read_at').eq('user_id', userId),
    ])

    if (ticketsResult.error) {
      return NextResponse.json({ error: 'Could not load messages.' }, { status: 500 })
    }

    const tickets = (ticketsResult.data ?? []) as unknown as TicketRow[]
    const readIds = new Set((readsResult.data ?? []).map((r) => r.ticket_id))

    const threads = new Map<string, ConversationSummary>()
    for (const ticket of tickets) {
      const client = one(ticket.clients)
      const project = one(ticket.projects)
      const isRead = readIds.has(ticket.id)
      const threadId = ticket.thread_id || ticket.id
      const existing = threads.get(threadId)

      if (!existing) {
        threads.set(threadId, {
          thread_id: threadId,
          client: client ? { id: client.id, name: client.name } : null,
          project: project
            ? {
                id: project.id,
                name: project.name,
                project_reference: project.project_reference,
              }
            : null,
          latest_message: ticket.description || ticket.title || '',
          latest_at: ticket.created_at,
          message_count: 1,
          unread_count: isRead ? 0 : 1,
          is_unread: !isRead,
          status: ticket.status,
          last_sender_role: ticket.sender_role,
        })
      } else {
        existing.message_count += 1
        if (!isRead) {
          existing.unread_count += 1
          existing.is_unread = true
        }
      }
    }

    const data = Array.from(threads.values())
    const totalUnread = data.reduce((sum, thread) => sum + thread.unread_count, 0)

    return NextResponse.json({
      data,
      total_unread: totalUnread,
      total_conversations: data.length,
    })
  } catch {
    return NextResponse.json({ error: 'Could not load messages.' }, { status: 500 })
  }
}

// ─── POST /api/messages ──────────────────────────────────────────────────────
// Minimal message intake on the existing support_tickets store. There is no
// reply composer in the UI: this endpoint exists so client messages can be
// recorded/verified through the same RLS boundary the developers read through.
export async function POST(req: NextRequest) {
  const auth = await authorizeMessageCaller(req)
  if (auth.response) return auth.response
  const { db, userId, role } = auth.caller

  try {
    const body = await req.json()
    const projectId = typeof body.project_id === 'string' ? body.project_id : ''
    const text = typeof (body.body ?? body.description) === 'string' ? (body.body ?? body.description).trim() : ''

    if (!projectId) {
      return NextResponse.json({ error: 'A project is required.' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Message content is required.' }, { status: 400 })
    }

    const insertPayload: Record<string, unknown> = {
      project_id: projectId,
      client_id: typeof body.client_id === 'string' ? body.client_id : null,
      title: (typeof body.title === 'string' && body.title.trim()) || 'Client message',
      description: text,
      status: 'open',
      sender_user_id: userId,
      sender_role: role,
      is_internal: body.is_internal === true,
    }
    if (typeof body.thread_id === 'string' && body.thread_id) {
      insertPayload.thread_id = body.thread_id
    }

    // RLS INSERT policies reject messages for projects the caller cannot access.
    const { data, error } = await db
      .from('support_tickets')
      .insert(insertPayload)
      .select('id, thread_id, project_id, client_id, created_at')
      .single()

    if (error) {
      return NextResponse.json(
        { error: 'You cannot send a message for this project.' },
        { status: 403 }
      )
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Could not send message.' }, { status: 400 })
  }
}
