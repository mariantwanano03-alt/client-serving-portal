import { NextRequest, NextResponse } from 'next/server'
import {
  authorizeStaffMessageCaller,
  ticketToMessage,
  TICKET_SELECT,
  type TicketRow,
} from '@/lib/message-server'
import { MAX_REPLY_LENGTH, type MessageItem } from '@/lib/message-types'

// ─── POST /api/messages/:threadId/reply ──────────────────────────────────────
// Append a developer reply (or internal note) to an existing conversation.
//
// Security design:
//   * Only active senior/junior developers may call this. Clients stay
//     read-only and administrators have no message access.
//   * project_id/client_id are read back from a thread row that the caller is
//     allowed to see under SELECT RLS. They are NEVER taken from the request
//     body, so a developer cannot redirect a reply to another project.
//   * The INSERT itself is re-checked by PostgreSQL RLS:
//     "Staff can send project messages" requires can_access_message_project()
//     and sender_user_id = auth.uid().
//   * support_tickets is append-only — replies are new rows, never edits.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeStaffMessageCaller(req)
  if (auth.response) return auth.response
  const { db, userId, role } = auth.caller
  const { threadId } = await params

  try {
    // 1. Resolve the thread's context from rows the caller can already see.
    //    A junior calling this for an unassigned project gets zero rows (404).
    const { data: contextRows, error: contextError } = await db
      .from('support_tickets')
      .select('project_id, client_id, status, thread_id')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (contextError) {
      return NextResponse.json({ error: 'Could not load conversation.' }, { status: 500 })
    }

    const context = contextRows?.[0]
    if (!context) {
      return NextResponse.json(
        { error: 'Conversation not found or you do not have access.' },
        { status: 404 }
      )
    }
    if (!context.project_id) {
      return NextResponse.json(
        { error: 'This conversation is not linked to a project.' },
        { status: 400 }
      )
    }

    // 2. Validate the caller-supplied content only. Ignore any project/client
    //    identifiers in the body — those are deliberately not read.
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const payload = (body ?? {}) as Record<string, unknown>
    const text = typeof payload.body === 'string' ? payload.body.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Write a reply before sending.' }, { status: 400 })
    }
    if (text.length > MAX_REPLY_LENGTH) {
      return NextResponse.json(
        { error: `Reply must be ${MAX_REPLY_LENGTH.toLocaleString()} characters or fewer.` },
        { status: 400 }
      )
    }

    const isInternal = payload.is_internal === true

    // 3. Append the message. Every scoping value comes from the verified thread
    //    or the resolved caller — none come from the request body.
    const { data: inserted, error: insertError } = await db
      .from('support_tickets')
      .insert({
        thread_id: threadId,
        project_id: context.project_id,
        client_id: context.client_id,
        status: context.status || 'open',
        title: isInternal ? 'Internal note' : 'Reply to client',
        description: text,
        sender_user_id: userId,
        sender_role: role,
        is_internal: isInternal,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: 'You cannot reply to this conversation.' },
        { status: 403 }
      )
    }

    // 4. Return the new row in the same shape as conversation history so the
    //    UI can append it without a second full conversation fetch.
    const { data: row } = await db
      .from('support_tickets')
      .select(TICKET_SELECT)
      .eq('id', inserted.id)
      .maybeSingle()

    const message: MessageItem = row
      ? ticketToMessage(row as unknown as TicketRow, new Set([inserted.id]))
      : {
          id: inserted.id,
          thread_id: threadId,
          title: isInternal ? 'Internal note' : 'Reply to client',
          body: text,
          sender_role: role,
          sender_name: null,
          is_internal: isInternal,
          status: context.status || 'open',
          created_at: new Date().toISOString(),
          is_read: true,
          attachments: [],
        }

    return NextResponse.json({ data: message }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Could not send reply.' }, { status: 500 })
  }
}
