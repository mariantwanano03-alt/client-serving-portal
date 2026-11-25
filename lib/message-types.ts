// Shared types and constants for the client-message inbox. Safe to import from
// both server routes and client components (no server-only dependencies).

/** Maximum length of a reply or internal note, enforced on both client and server. */
export const MAX_REPLY_LENGTH = 10000

export type MessageParty = {
  id: string
  name: string
}

export type MessageProject = {
  id: string
  name: string
  project_reference: string | null
}

export type MessageAttachment = {
  id: string
  file_name: string
  content_type: string | null
  size: number | null
}

/** One message in a conversation (backed by a support_tickets row). */
export type MessageItem = {
  id: string
  thread_id: string
  title: string | null
  body: string
  sender_role: string
  sender_name: string | null
  is_internal: boolean
  status: string | null
  created_at: string
  is_read: boolean
  attachments: MessageAttachment[]
}

/** A conversation row shown in the inbox (one per thread_id). */
export type ConversationSummary = {
  thread_id: string
  client: MessageParty | null
  project: MessageProject | null
  latest_message: string
  latest_at: string
  message_count: number
  unread_count: number
  is_unread: boolean
  status: string | null
  last_sender_role: string
}

export type InboxResponse = {
  data: ConversationSummary[]
  total_unread: number
  total_conversations: number
}

export type ConversationResponse = {
  thread_id: string
  client: MessageParty | null
  project: MessageProject | null
  messages: MessageItem[]
}
