'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PortalShell, { usePortal } from '@/components/PortalShell'
import { formatMessageDate, messageFetch } from '@/lib/message-ui'
import { MAX_REPLY_LENGTH, type ConversationResponse, type MessageItem } from '@/lib/message-types'

type ReplyMode = 'client' | 'internal'

export default function ConversationView({ threadId }: { threadId: string }) {
  return (
    <PortalShell title="Conversation" breadcrumb="WORKSPACE / MESSAGES / CONVERSATION">
      <ConversationContent threadId={threadId} />
    </PortalShell>
  )
}

function ConversationContent({ threadId }: { threadId: string }) {
  const { role } = usePortal()
  const canReply = role === 'senior_dev_pm' || role === 'junior_developer'

  const [conversation, setConversation] = useState<ConversationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const markedRef = useRef<string | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)

  const [replyMode, setReplyMode] = useState<ReplyMode>('client')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [replySent, setReplySent] = useState(false)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')

    async function loadConversation() {
      try {
        const result = await messageFetch<ConversationResponse>(`/api/messages/${threadId}`)
        if (ignore) return
        setConversation(result)

        // Mark as read only after the conversation is actually opened.
        // The ref guard prevents duplicate writes under React StrictMode.
        if (markedRef.current !== threadId) {
          markedRef.current = threadId
          try {
            await messageFetch(`/api/messages/${threadId}/read`, { method: 'PATCH' })
            if (!ignore) {
              setConversation((current) =>
                current
                  ? {
                      ...current,
                      messages: current.messages.map((message) => ({ ...message, is_read: true })),
                    }
                  : current
              )
            }
          } catch {
            // A failed read receipt must not hide the conversation.
          }
          if (!ignore) {
            window.dispatchEvent(new CustomEvent('client-messages:changed'))
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : 'We couldn’t load your messages. Please try again.'
          )
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadConversation()
    return () => {
      ignore = true
    }
  }, [threadId])

  // Keep the newest message in view when the thread loads or a reply is added.
  useEffect(() => {
    const element = messagesRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversation?.messages.length, loading])

  async function sendReply() {
    const text = replyText.trim()
    if (!text || sending) return

    setSending(true)
    setReplyError('')
    setReplySent(false)
    try {
      const result = await messageFetch<{ data: MessageItem }>(
        `/api/messages/${threadId}/reply`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: text,
            is_internal: replyMode === 'internal',
          }),
        }
      )
      setConversation((current) =>
        current
          ? { ...current, messages: [...current.messages, result.data] }
          : current
      )
      setReplyText('')
      setReplySent(true)
      window.dispatchEvent(new CustomEvent('client-messages:changed'))
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : 'We couldn’t send your reply. Please try again.'
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="conversation-page" data-testid="conversation-page">
      <Link href="/messages" className="portal-back-btn" data-testid="conversation-back">
        <span aria-hidden="true">←</span> Back to messages
      </Link>

      {loading ? (
        <div className="portal-card conversation-loading" data-testid="conversation-loading">
          <div className="messages-skeleton-row">
            <span className="skeleton-block skeleton-line skeleton-line-long" />
          </div>
          <div className="messages-skeleton-row">
            <span className="skeleton-block skeleton-line" />
          </div>
        </div>
      ) : error || !conversation ? (
        <div className="portal-card">
          <div className="portal-empty-state" role="alert" data-testid="conversation-error">
            <div className="portal-empty-icon" aria-hidden="true">⚠</div>
            <p className="portal-empty-title">We couldn’t open this conversation</p>
            <p className="portal-empty-desc">
              {error || 'This conversation is unavailable or you do not have access to it.'}
            </p>
            <Link href="/messages" className="portal-btn-primary">
              Back to messages
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="portal-card conversation-context" data-testid="conversation-context">
            <div className="conversation-context-header">
              <div>
                <p className="conversation-eyebrow">CLIENT CONVERSATION</p>
                <h2 data-testid="conversation-client">{conversation.client?.name || 'Unknown client'}</h2>
              </div>
              {conversation.project && (
                <Link
                  href={`/projects/${conversation.project.id}`}
                  className="portal-btn-secondary"
                  data-testid="conversation-view-project"
                >
                  View Project <span aria-hidden="true">↗</span>
                </Link>
              )}
            </div>
            <div className="conversation-meta">
              <div className="conversation-meta-item">
                <label>Client</label>
                <span data-testid="conversation-context-client">
                  {conversation.client?.name || 'Unknown client'}
                </span>
              </div>
              <div className="conversation-meta-item">
                <label>Project</label>
                <span data-testid="conversation-context-project">
                  {conversation.project?.name || 'Unknown project'}
                  {conversation.project?.project_reference
                    ? ` · ${conversation.project.project_reference}`
                    : ''}
                </span>
              </div>
              <div className="conversation-meta-item">
                <label>Messages</label>
                <span>{conversation.messages.length}</span>
              </div>
            </div>
          </section>

          <section className="portal-card conversation-thread" data-testid="conversation-thread">
            <div className="portal-card-header">
              <h2>Message history</h2>
              <span className="portal-badge badge-purple">Client &amp; internal</span>
            </div>

            {conversation.messages.length === 0 ? (
              <div className="portal-empty-state" data-testid="conversation-empty">
                <p className="portal-empty-title">No messages in this conversation</p>
              </div>
            ) : (
              <div className="conversation-messages" ref={messagesRef}>
                {conversation.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            )}
          </section>

          {canReply && (
            <section className="portal-card reply-composer" data-testid="reply-composer">
              <div className="portal-card-header">
                <h2>Reply</h2>
                <span className="portal-badge badge-gray">Added to conversation history</span>
              </div>

              <div className="reply-mode-switch" role="group" aria-label="Reply type">
                <button
                  type="button"
                  className={`reply-mode-btn ${replyMode === 'client' ? 'active' : ''}`}
                  data-testid="reply-mode-client"
                  aria-pressed={replyMode === 'client'}
                  onClick={() => {
                    setReplyMode('client')
                    setReplyError('')
                    setReplySent(false)
                  }}
                >
                  Reply to client
                </button>
                <button
                  type="button"
                  className={`reply-mode-btn ${replyMode === 'internal' ? 'active' : ''}`}
                  data-testid="reply-mode-internal"
                  aria-pressed={replyMode === 'internal'}
                  onClick={() => {
                    setReplyMode('internal')
                    setReplyError('')
                    setReplySent(false)
                  }}
                >
                  Internal note
                </button>
              </div>

              <p className="reply-mode-hint" data-testid="reply-mode-hint">
                {replyMode === 'client'
                  ? 'The client will see this reply in the conversation.'
                  : 'Only your team can see internal notes — clients never see them.'}
              </p>

              <textarea
                className="reply-input"
                data-testid="reply-input"
                aria-label={replyMode === 'client' ? 'Reply to client' : 'Internal note'}
                placeholder={
                  replyMode === 'client'
                    ? 'Type your reply to the client…'
                    : 'Add an internal note for your team…'
                }
                value={replyText}
                maxLength={MAX_REPLY_LENGTH}
                rows={4}
                disabled={sending}
                onChange={(event) => {
                  setReplyText(event.target.value)
                  setReplyError('')
                  setReplySent(false)
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void sendReply()
                  }
                }}
              />

              <div className="reply-footer">
                <span className="reply-char-count" data-testid="reply-char-count">
                  {replyText.length.toLocaleString()} / {MAX_REPLY_LENGTH.toLocaleString()}
                </span>
                <button
                  type="button"
                  className="portal-btn-primary"
                  data-testid="reply-submit"
                  disabled={!replyText.trim() || sending}
                  onClick={() => void sendReply()}
                >
                  {sending
                    ? 'Sending…'
                    : replyMode === 'client'
                      ? 'Send reply'
                      : 'Add internal note'}
                </button>
              </div>

              {replyError && (
                <p className="reply-error" role="alert" data-testid="reply-error">
                  ⚠ {replyError}
                </p>
              )}
              {replySent && !replyError && (
                <p className="reply-success" data-testid="reply-sent">
                  ✓ Message added to the conversation
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: MessageItem }) {
  const isInternal = message.is_internal
  const isClient = !isInternal && message.sender_role === 'client'
  const alignment = isInternal ? 'internal' : 'client'

  const senderLabel = isInternal
    ? 'Internal note'
    : isClient
      ? 'Client message'
      : message.sender_role === 'senior_dev_pm'
        ? 'Senior Dev / PM'
        : message.sender_role === 'junior_developer'
          ? 'Developer'
          : 'Message'

  return (
    <article
      className={`conversation-message ${alignment}`}
      data-testid="conversation-message"
      data-sender-role={message.sender_role}
    >
      <div className="conversation-message-head">
        <span className={`portal-badge ${isInternal ? 'badge-purple' : 'badge-blue'}`}>
          {senderLabel}
        </span>
        <span className="conversation-message-time" data-testid="conversation-message-date">
          {formatMessageDate(message.created_at)}
        </span>
      </div>
      <div className="conversation-message-body" data-testid="conversation-message-body">
        {message.body}
      </div>
      <div className="conversation-message-foot">
        <span className="conversation-sender">{message.sender_name || senderLabel}</span>
        <span className="conversation-read-state" data-testid="conversation-message-read">
          {message.is_read ? 'Read' : 'Unread'}
        </span>
      </div>
      {message.attachments.length > 0 && (
        <div className="conversation-attachments">
          {message.attachments.map((attachment) => (
            <span className="conversation-attachment" key={attachment.id}>
              <span aria-hidden="true">📎</span> {attachment.file_name}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
