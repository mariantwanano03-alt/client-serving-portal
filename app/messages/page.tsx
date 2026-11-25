'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PortalShell from '@/components/PortalShell'
import { formatMessageDate, initialsOf, messageFetch } from '@/lib/message-ui'
import type { ConversationSummary, InboxResponse } from '@/lib/message-types'

type StatusFilter = 'all' | 'unread' | 'read'

export default function MessagesPage() {
  return (
    <PortalShell title="Client Messages" breadcrumb="WORKSPACE / MESSAGES">
      <MessagesContent />
    </PortalShell>
  )
}

function MessagesContent() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await messageFetch<InboxResponse>('/api/messages')
      setConversations(result.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t load your messages. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return conversations.filter((conversation) => {
      if (filter === 'unread' && !conversation.is_unread) return false
      if (filter === 'read' && conversation.is_unread) return false
      if (!term) return true
      const haystack = [
        conversation.client?.name,
        conversation.project?.name,
        conversation.project?.project_reference,
        conversation.latest_message,
        conversation.last_sender_role,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [conversations, filter, search])

  return (
    <div className="messages-page" data-testid="messages-page">
      <div className="messages-stats-row">
        <div className="portal-stat-card">
          <div className="portal-stat-icon messages-stat-icon" aria-hidden="true">✉</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Conversations</span>
            <strong className="portal-stat-value" data-testid="messages-total-count">
              {loading ? '—' : conversations.length}
            </strong>
          </div>
        </div>
        <div className="portal-stat-card">
          <div className="portal-stat-icon messages-stat-unread-icon" aria-hidden="true">●</div>
          <div className="portal-stat-details">
            <span className="portal-stat-label">Unread messages</span>
            <strong className="portal-stat-value" data-testid="messages-unread-count">
              {loading ? '—' : totalUnread}
            </strong>
          </div>
        </div>
      </div>

      <section className="portal-card messages-card">
        <div className="portal-card-header">
          <h2>Inbox</h2>
          {!loading && !error && (
            <span className="portal-badge badge-blue" data-testid="messages-conversation-count">
              {visible.length} conversation{visible.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {!loading && !error && conversations.length > 0 && (
          <div className="portal-toolbar messages-toolbar">
            <div className="portal-search-wrap">
              <span className="portal-search-icon" aria-hidden="true">⌕</span>
              <input
                className="portal-search-input"
                type="search"
                placeholder="Search client, project or message"
                aria-label="Search messages"
                data-testid="messages-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="messages-filters" role="group" aria-label="Filter messages">
              <button
                type="button"
                className={`messages-filter-btn ${filter === 'all' ? 'active' : ''}`}
                data-testid="messages-filter-all"
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`messages-filter-btn ${filter === 'unread' ? 'active' : ''}`}
                data-testid="messages-filter-unread"
                onClick={() => setFilter('unread')}
              >
                Unread{totalUnread > 0 ? ` (${totalUnread})` : ''}
              </button>
              <button
                type="button"
                className={`messages-filter-btn ${filter === 'read' ? 'active' : ''}`}
                data-testid="messages-filter-read"
                onClick={() => setFilter('read')}
              >
                Read
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="messages-skeleton" data-testid="messages-loading" aria-label="Loading messages">
            {[0, 1, 2].map((index) => (
              <div className="messages-skeleton-row" key={index}>
                <span className="skeleton-block skeleton-avatar" />
                <span className="skeleton-block skeleton-line skeleton-line-long" />
                <span className="skeleton-block skeleton-line skeleton-line-short" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="portal-empty-state" role="alert" data-testid="messages-error">
            <div className="portal-empty-icon" aria-hidden="true">⚠</div>
            <p className="portal-empty-title">We couldn’t load your messages</p>
            <p className="portal-empty-desc">{error}</p>
            <button
              type="button"
              className="portal-btn-primary"
              onClick={load}
              data-testid="messages-retry"
            >
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="portal-empty-state" data-testid="messages-empty">
            <div className="portal-empty-icon" aria-hidden="true">✉</div>
            <p className="portal-empty-title">You don’t have any client messages yet</p>
            <p className="portal-empty-desc">
              Messages sent by clients about your projects will appear here.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="portal-empty-state" data-testid="messages-no-results">
            <div className="portal-empty-icon" aria-hidden="true">⌕</div>
            <p className="portal-empty-title">No matching messages</p>
            <p className="portal-empty-desc">Try a different search term or filter.</p>
          </div>
        ) : (
          <div className="portal-table-container messages-table-container">
            <table className="portal-table messages-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Latest message</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((conversation) => (
                  <tr
                    key={conversation.thread_id}
                    className={conversation.is_unread ? 'message-row unread' : 'message-row'}
                    data-testid="message-row"
                  >
                    <td>
                      <Link
                        href={`/messages/${conversation.thread_id}`}
                        className="message-client-link"
                        data-testid="message-row-link"
                      >
                        <span className="message-avatar" aria-hidden="true">
                          {initialsOf(conversation.client?.name)}
                        </span>
                        <span className="message-client-name" data-testid="message-row-client">
                          {conversation.client?.name || 'Unknown client'}
                          {conversation.is_unread && (
                            <span className="message-unread-dot" data-testid="message-row-unread" aria-label="Unread" />
                          )}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="message-project" data-testid="message-row-project">
                        {conversation.project?.name || 'Unknown project'}
                      </span>
                      {conversation.project?.project_reference && (
                        <span className="message-project-ref">{conversation.project.project_reference}</span>
                      )}
                    </td>
                    <td>
                      <span className="message-preview" data-testid="message-row-preview">
                        {conversation.latest_message || '(no content)'}
                      </span>
                      {conversation.message_count > 1 && (
                        <span className="message-count">{conversation.message_count} messages</span>
                      )}
                    </td>
                    <td>
                      <span className="message-date" data-testid="message-row-date">
                        {formatMessageDate(conversation.latest_at)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`portal-badge ${conversation.is_unread ? 'badge-blue' : 'badge-gray'}`}
                        data-testid="message-row-status"
                      >
                        {conversation.is_unread ? 'Unread' : 'Read'}
                      </span>
                      {conversation.unread_count > 1 && (
                        <span className="message-unread-count" data-testid="message-row-unread-count">
                          {conversation.unread_count} new
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
