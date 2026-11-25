// Client-side helpers shared by the Messages pages.

import { supabase } from '@/lib/supabase'

/** Fetch a message API route with the signed-in user's access token. */
export async function messageFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(init?.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, { ...init, headers, cache: 'no-store' })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // A non-JSON error still needs a friendly message.
  }

  if (!response.ok) {
    const error = (payload as { error?: string } | null)?.error
    throw new Error(error || 'We couldn’t load your messages. Please try again.')
  }
  return payload as T
}

/** Human-friendly date/time for conversation lists and message bubbles. */
export function formatMessageDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (date.toDateString() === now.toDateString()) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  const includeYear = date.getFullYear() !== now.getFullYear()
  const day = date.toLocaleDateString(
    [],
    includeYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' }
  )
  return `${day}, ${time}`
}

/** Initials used for the small client/project avatars in the inbox. */
export function initialsOf(name: string | null | undefined): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
