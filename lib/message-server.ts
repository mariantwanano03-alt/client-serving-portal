// SERVER-ONLY helpers for the client-message API. Caller identity is always
// resolved from the request token; every query uses a caller-scoped Supabase
// client so PostgreSQL RLS is the enforcement boundary.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MESSAGE_ROLES, resolveCaller, type Role } from '@/lib/authz'
import type { MessageAttachment, MessageItem } from '@/lib/message-types'

/** Developers (not clients or administrators) may append replies. */
export const STAFF_MESSAGE_ROLES: Role[] = ['senior_dev_pm', 'junior_developer']

export const TICKET_SELECT = `
  id, thread_id, title, description, status, created_at,
  sender_role, sender_user_id, is_internal, project_id, client_id,
  clients(id, name),
  projects(id, name, project_reference),
  profiles!support_tickets_sender_user_id_fkey(full_name, email)
`

export type MessageCaller = {
  db: SupabaseClient
  userId: string
  role: Role
}

type AuthResult =
  | { caller: MessageCaller; response?: never }
  | { caller?: never; response: NextResponse }

/**
 * Resolve and gate a message API caller. Administrators are deliberately
 * excluded: they are an oversight-only role with no client-message access.
 */
export async function authorizeMessageCaller(req: Request): Promise<AuthResult> {
  const result = await resolveCaller(req)
  if (result.response) return { response: result.response }
  if (!MESSAGE_ROLES.includes(result.caller.role)) {
    return {
      response: NextResponse.json(
        { error: 'You do not have permission to view client messages.' },
        { status: 403 }
      ),
    }
  }
  return {
    caller: {
      db: result.caller.db,
      userId: result.caller.user.id,
      role: result.caller.role,
    },
  }
}

/**
 * Same caller gating as authorizeMessageCaller, but restricted to developers.
 * Clients keep read-only access and administrators keep no access at all.
 */
export async function authorizeStaffMessageCaller(req: Request): Promise<AuthResult> {
  const result = await authorizeMessageCaller(req)
  if (result.response) return { response: result.response }
  if (!STAFF_MESSAGE_ROLES.includes(result.caller.role)) {
    return {
      response: NextResponse.json(
        { error: 'Only developers can reply to client messages.' },
        { status: 403 }
      ),
    }
  }
  return { caller: result.caller }
}

/** PostgREST returns a single relation as an object, but be defensive. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export type TicketRow = {
  id: string
  thread_id: string
  title: string | null
  description: string | null
  status: string | null
  created_at: string
  sender_role: string
  sender_user_id: string | null
  is_internal: boolean
  project_id: string | null
  client_id: string | null
  clients: { id: string; name: string } | { id: string; name: string }[] | null
  projects:
    | { id: string; name: string; project_reference: string | null }
    | { id: string; name: string; project_reference: string | null }[]
    | null
  profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
}

/** Map a ticket row into the wire format used by the conversation view. */
export function ticketToMessage(
  ticket: TicketRow,
  readIds: Set<string> = new Set(),
  attachmentsByTicket: Map<string, MessageAttachment[]> = new Map()
): MessageItem {
  const sender = one(ticket.profiles)
  return {
    id: ticket.id,
    thread_id: ticket.thread_id,
    title: ticket.title,
    body: ticket.description || '',
    sender_role: ticket.sender_role,
    sender_name: sender?.full_name || sender?.email || null,
    is_internal: ticket.is_internal,
    status: ticket.status,
    created_at: ticket.created_at,
    is_read: readIds.has(ticket.id),
    attachments: attachmentsByTicket.get(ticket.id) ?? [],
  }
}
