import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  callerClient,
  login,
  openMenu,
  serviceClient,
  signInWithPassword,
} from './helpers/admin'

/**
 * Client-message access: real UI + backend/RLS boundaries.
 *
 * Senior  -> sees messages on all projects (existing app model)
 * Junior  -> only projects with an ACTIVE assignment
 * Admin   -> no message access at all
 *
 * Test data is created in beforeAll and removed in afterAll.
 */

const JUNIOR_EMAIL = 'alex@test.com'
const JUNIOR_PASSWORD = 'test1234'
const JUNIOR_ID = '8920ec40-b47b-43a3-b45a-546b15c22365'
const ORIGINAL_THREAD = 'f6831e59-bc7a-4391-b302-468385429944'

const CLIENT_EMAIL = 'musainnocent456@gmail.com'
const CLIENT_PASSWORD = 'test1234'
const CLIENT_USER_ID = '489ead68-79e9-40fb-b3cc-8de4e02602d4'
const CLIENT_ROLE_ID = '4343400f-6b60-446c-bbae-1ab44c803aee'

const runId = randomUUID().slice(0, 8)
const SENIOR_EMAIL = `senior-msgs-${runId}@test.com`
const SENIOR_PASSWORD = 'MsgTest!234'
const SENTINEL = `SENTINEL_RESTRICTED_${runId}`
const REPLY_SENTINEL = `REPLY_TEST_${runId}`

let darkThemeTicketId = ''
let clientScopeId = ''
let createdClientPtsUser = false
let seniorUserId = ''
let restrictedProjectId = ''
let restrictedClientId: string | null = null
let restrictedThreadId = ''
let restrictedTicketId = ''

// The local dev webpack server compiles routes on first request and React
// StrictMode double-invokes effects, so API-backed UI needs relaxed timeouts.
test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.slow()
})

test.beforeAll(async () => {
  // Supabase admin calls can be slow; this is a hook timeout, not a test one.
  test.setTimeout(120_000)
  const svc = serviceClient()

  // Keep the oversight account credential valid for the admin check.
  await svc.auth.admin.updateUserById('0f4ea9f1-5385-41e3-b430-24377f4db88b', {
    password: ADMIN_PASSWORD,
  })

  // A temporary senior with a known password for real browser login.
  const created = await svc.auth.admin.createUser({
    email: SENIOR_EMAIL,
    password: SENIOR_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Messages Test Senior' },
  })
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || 'Could not create senior test user')
  }
  seniorUserId = created.data.user.id
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { data } = await svc.from('profiles').select('id').eq('id', seniorUserId).maybeSingle()
    if (data) break
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  // New accounts start pending. This fixture provisions an already-approved
  // senior so the suite can test message access rather than role assignment.
  await svc.from('profiles')
    .update({ role: 'senior_dev_pm', account_status: 'active', is_active: true })
    .eq('id', seniorUserId)

  // Pick a project that junior Alex is NOT assigned to.
  const { data: assignments } = await svc
    .from('assignments')
    .select('project_id')
    .eq('developer_user_id', JUNIOR_ID)
  const assigned = new Set((assignments ?? []).map((a) => a.project_id))
  const { data: projects } = await svc.from('projects').select('id, client_id').order('created_at')
  const target = (projects ?? []).find((project) => !assigned.has(project.id))
  if (!target) throw new Error('No unassigned project available for negative test')
  restrictedProjectId = target.id
  restrictedClientId = target.client_id ?? null

  // A client message on that unassigned project — the junior must never see it.
  const inserted = await svc
    .from('support_tickets')
    .insert({
      project_id: restrictedProjectId,
      client_id: restrictedClientId,
      title: 'Playwright restricted message',
      description: `We need an update on the restricted project. ${SENTINEL}`,
      status: 'open',
      sender_role: 'client',
      sender_user_id: '489ead68-79e9-40fb-b3cc-8de4e02602d4',
      is_internal: false,
    })
    .select('id, thread_id')
    .single()
  if (inserted.error || !inserted.data) {
    throw new Error(inserted.error?.message || 'Could not create restricted message')
  }
  restrictedTicketId = inserted.data.id
  restrictedThreadId = inserted.data.thread_id

  // pts_user_scopes.user_id is an FK to pts_users(user_id), not profiles(id).
  // The client auth account has no pts_users row, so add a temporary one.
  const { data: existingPtsUser } = await svc
    .from('pts_users')
    .select('user_id')
    .eq('user_id', CLIENT_USER_ID)
    .maybeSingle()
  if (!existingPtsUser) {
    const ptsUser = await svc
      .from('pts_users')
      .insert({
        user_id: CLIENT_USER_ID,
        role_id: CLIENT_ROLE_ID,
        full_name: 'Messages Test Client',
        email: CLIENT_EMAIL,
        is_active: true,
      })
      .select('user_id')
      .single()
    if (ptsUser.error || !ptsUser.data) {
      throw new Error(ptsUser.error?.message || 'Could not create client pts_users row')
    }
    createdClientPtsUser = true
  }

  // Temporarily scope the client account to this project so we can verify at
  // runtime that internal notes stay invisible to clients.
  const scope = await svc
    .from('pts_user_scopes')
    .insert({ user_id: CLIENT_USER_ID, project_id: restrictedProjectId })
    .select('id')
    .single()
  if (scope.error || !scope.data) {
    throw new Error(scope.error?.message || 'Could not create client project scope')
  }
  clientScopeId = scope.data.id
})

test.afterAll(async () => {
  test.setTimeout(120_000)
  const svc = serviceClient()
  // Remove every reply created by this run (read receipts cascade).
  await svc.from('support_tickets').delete().ilike('description', `%${REPLY_SENTINEL}%`)
  if (darkThemeTicketId) {
    await svc.from('support_ticket_reads').delete().eq('ticket_id', darkThemeTicketId)
    await svc.from('support_tickets').delete().eq('id', darkThemeTicketId)
  }
  if (restrictedTicketId) {
    await svc.from('support_ticket_reads').delete().eq('ticket_id', restrictedTicketId)
    await svc.from('support_tickets').delete().eq('id', restrictedTicketId)
  }
  if (clientScopeId) await svc.from('pts_user_scopes').delete().eq('id', clientScopeId)
  if (createdClientPtsUser) {
    await svc.from('pts_users').delete().eq('user_id', CLIENT_USER_ID)
  }
  // Remove any read receipts created for the shared junior account.
  await svc.from('support_ticket_reads').delete().eq('user_id', JUNIOR_ID)
  if (seniorUserId) await svc.auth.admin.deleteUser(seniorUserId)
})

async function apiHeaders(email: string, password: string) {
  const { accessToken } = await signInWithPassword(email, password)
  return { Authorization: `Bearer ${accessToken}` }
}

// ─── A. Senior developer UI ──────────────────────────────────────────────────

test('A senior sees client messages, context and unread behaviour', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openMenu(page)

  await expect(page.getByTestId('messages-nav-link')).toBeVisible()
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-page')).toBeVisible()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)

  const rows = page.getByTestId('message-row')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThanOrEqual(2)

  // Context columns on the inbox list.
  await expect(page.getByText('hello can you please share with me the quotation for the project')).toBeVisible()
  await expect(page.getByTestId('message-row-client').first()).toBeVisible()
  await expect(page.getByTestId('message-row-project').first()).toBeVisible()
  await expect(page.getByTestId('message-row-date').first()).toBeVisible()
  await expect(page.getByTestId('message-row-status').first()).toHaveText('Unread')

  // Unread count lives in the transient drawer; verify it there, then close
  // the overlay so the conversation row is clickable again.
  await openMenu(page)
  await expect(page.getByTestId('messages-nav-badge')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-drawer')).toBeHidden()
  await expect(page.getByTestId('messages-unread-count')).not.toHaveText('0')

  // Open a conversation (marks it read only now).
  await page.getByTestId('message-row-link').first().click()
  await expect(page.getByTestId('conversation-page')).toBeVisible()
  await expect(page.getByTestId('conversation-context')).toBeVisible()
  await expect(page.getByTestId('conversation-view-project')).toBeVisible()
  await expect(page.getByTestId('conversation-message').first()).toBeVisible()
  await expect(page.getByTestId('conversation-message-body').first()).toContainText(
    /quotation|SENTINEL_RESTRICTED_/
  )
  await expect(page.getByTestId('conversation-message-read').first()).toHaveText('Read')

  await page.getByTestId('conversation-back').click()
  await expect(page.getByTestId('messages-page')).toBeVisible()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)
  const firstStatus = await page.getByTestId('message-row-status').first().textContent()
  expect(firstStatus === 'Read' || firstStatus === 'Unread').toBeTruthy()
})

// ─── B. Senior search / filters ──────────────────────────────────────────────

test('A senior can search and filter the inbox', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openMenu(page)
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)

  await page.getByTestId('messages-search').fill(SENTINEL)
  await expect(page.getByTestId('message-row')).toHaveCount(1)
  await expect(page.getByTestId('message-row-preview')).toContainText(SENTINEL)

  await page.getByTestId('messages-search').fill('')
  await page.getByTestId('messages-filter-unread').click()
  expect(await page.getByTestId('message-row').count()).toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('messages-filter-unread')).toHaveClass(/active/)
})

// ─── C. Junior UI visibility ─────────────────────────────────────────────────

test('A junior sees assigned-project messages but not unassigned ones', async ({ page }) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await openMenu(page)

  await expect(page.getByTestId('messages-nav-link')).toBeVisible()
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-page')).toBeVisible()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)

  await expect(page.getByTestId('message-row').first()).toBeVisible()
  await expect(
    page.getByTestId('message-row').filter({ hasText: SENTINEL })
  ).toHaveCount(0)
  await expect(page.getByText(SENTINEL)).toHaveCount(0)

  // The count shown to the junior is their own scoped count, not a global one.
  // It counts unread *messages*, so several can belong to one conversation row.
  const juniorUnread = Number(await page.getByTestId('messages-unread-count').textContent())
  const { accessToken } = await signInWithPassword(JUNIOR_EMAIL, JUNIOR_PASSWORD)
  const response = await fetch('http://localhost:3000/api/messages', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = await response.json()
  const scopedUnread = (payload.data as Array<{ unread_count: number }>).reduce(
    (sum, thread) => sum + thread.unread_count,
    0
  )
  expect(scopedUnread).toBeGreaterThan(0)
  expect(juniorUnread).toBe(scopedUnread)
})

// ─── D. Junior direct navigation to a restricted conversation ────────────────

test('A junior cannot open a restricted conversation by URL', async ({ page }) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await page.goto(`/messages/${restrictedThreadId}`)
  await expect(page.getByTestId('conversation-error')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('conversation-thread')).toHaveCount(0)
  await expect(page.getByTestId('conversation-context')).toHaveCount(0)
})

// ─── E. Backend / API / Supabase bypass attempts ─────────────────────────────

test('Backend rejects every junior attempt to reach a restricted message', async ({ request }) => {
  const headers = await apiHeaders(JUNIOR_EMAIL, JUNIOR_PASSWORD)

  const inbox = await request.get('/api/messages', { headers })
  expect(inbox.ok()).toBeTruthy()
  const body = await inbox.json()
  expect(body.data.some((thread: { thread_id: string }) => thread.thread_id === restrictedThreadId)).toBeFalsy()

  const detail = await request.get(`/api/messages/${restrictedThreadId}`, { headers })
  expect(detail.status()).toBe(404)

  const markRead = await request.patch(`/api/messages/${restrictedThreadId}/read`, {
    headers,
    data: { ticket_ids: [restrictedTicketId] },
  })
  expect(markRead.status()).toBe(404)

  // Manipulating query parameters must not widen RLS scope.
  const manipulated = await request.get(`/api/messages?project_id=${restrictedProjectId}&all=true`, {
    headers,
  })
  expect(manipulated.ok()).toBeTruthy()
  const manipulatedBody = await manipulated.json()
  expect(
    manipulatedBody.data.some((thread: { thread_id: string }) => thread.thread_id === restrictedThreadId)
  ).toBeFalsy()

  // Bypass our API entirely and call Supabase with the user's own token.
  const direct = await callerClient(
    (await signInWithPassword(JUNIOR_EMAIL, JUNIOR_PASSWORD)).accessToken
  )
    .from('support_tickets')
    .select('id')
    .eq('id', restrictedTicketId)
  expect(direct.error).toBeNull()
  expect(direct.data ?? []).toHaveLength(0)

  // And a direct INSERT of an unauthorised read receipt must be rejected by RLS.
  const badReceipt = await callerClient(
    (await signInWithPassword(JUNIOR_EMAIL, JUNIOR_PASSWORD)).accessToken
  )
    .from('support_ticket_reads')
    .insert({ user_id: JUNIOR_ID, ticket_id: restrictedTicketId })
  expect(badReceipt.error).not.toBeNull()
})

// ─── F. Administrator has no message access ──────────────────────────────────

test('An administrator has no Messages navigation or API access', async ({ page, request }) => {
  const headers = await apiHeaders(ADMIN_EMAIL, ADMIN_PASSWORD)
  const inbox = await request.get('/api/messages', { headers })
  expect(inbox.status()).toBe(403)

  const direct = await callerClient(
    (await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
  )
    .from('support_tickets')
    .select('id')
  expect(direct.data ?? []).toHaveLength(0)

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await openMenu(page)
  await expect(page.getByTestId('messages-nav-link')).toHaveCount(0)
})

// ─── G. Database verification ────────────────────────────────────────────────

test('A client message is stored with client, project, sender and timestamp', async () => {
  const { data } = await serviceClient()
    .from('support_tickets')
    .select('*')
    .eq('id', restrictedTicketId)
    .single()

  expect(data).not.toBeNull()
  expect(data?.project_id).toBe(restrictedProjectId)
  expect(data?.client_id).toBe(restrictedClientId)
  expect(data?.sender_role).toBe('client')
  expect(data?.sender_user_id).toBe('489ead68-79e9-40fb-b3cc-8de4e02602d4')
  expect(data?.thread_id).toBeTruthy()
  expect(data?.created_at).toBeTruthy()
  expect(data?.description).toContain(SENTINEL)

  // A senior can retrieve it through the API; a junior cannot (proved above).
  const headers = await apiHeaders(SENIOR_EMAIL, SENIOR_PASSWORD)
  const detail = await fetch(`http://localhost:3000/api/messages/${data!.thread_id}`, { headers })
  expect(detail.status).toBe(200)
})

// ─── H. Responsive layout (desktop + mobile browser projects) ────────────────

test('Inbox and conversation have no horizontal overflow', async ({ page }) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await openMenu(page)
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)
  await expect(page.getByTestId('message-row').first()).toBeVisible()
  await expect(page.getByTestId('messages-search')).toBeVisible()

  const inboxOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(inboxOverflow).toBeLessThanOrEqual(1)

  await page.getByTestId('message-row-link').first().click()
  await expect(page.getByTestId('conversation-thread')).toBeVisible()
  await expect(page.getByTestId('conversation-message').first()).toBeVisible()

  const conversationOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(conversationOverflow).toBeLessThanOrEqual(1)
})

// ─── I. Dark theme ───────────────────────────────────────────────────────────

test('Messages render with the portal dark theme', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await page.goto('/settings')
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  // Earlier tests mark messages read, so guarantee an unread row to render the
  // navigation badge whose styling this test checks.
  const { data: threadRow } = await serviceClient()
    .from('support_tickets')
    .select('project_id, client_id')
    .eq('thread_id', ORIGINAL_THREAD)
    .single()
  const darkTicket = await serviceClient()
    .from('support_tickets')
    .insert({
      project_id: threadRow?.project_id,
      client_id: threadRow?.client_id,
      title: 'Dark theme badge fixture',
      description: `Dark theme fixture ${runId}`,
      status: 'open',
      sender_role: 'client',
      is_internal: false,
    })
    .select('id')
    .single()
  if (darkTicket.error || !darkTicket.data) {
    throw new Error(darkTicket.error?.message || 'Could not create dark theme fixture')
  }
  darkThemeTicketId = darkTicket.data.id

  await openMenu(page)
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)
  await expect(page.getByTestId('message-row').first()).toBeVisible()
  // The shell refreshes its unread count asynchronously after navigation.
  // The badge lives in the transient drawer, so reopen it before asserting.
  await openMenu(page)
  await expect(page.getByTestId('messages-nav-badge')).toBeVisible()

  const surfaces = await page.evaluate(() => {
    const card = document.querySelector('.messages-card')
    const badge = document.querySelector('.dashboard-nav-badge')
    return {
      card: card ? getComputedStyle(card).backgroundColor : '',
      body: getComputedStyle(document.body).backgroundColor,
      badge: badge ? getComputedStyle(badge).backgroundImage : '',
    }
  })
  expect(surfaces.card).toBe('rgba(30, 41, 59, 0.5)')
  expect(surfaces.body).toBe('rgb(15, 23, 42)')
  expect(surfaces.badge).toContain('linear-gradient')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-drawer')).toBeHidden()

  await page.goto(`/messages/${ORIGINAL_THREAD}`)
  await expect(page.getByTestId('conversation-thread')).toBeVisible()
  const bubbleColor = await page
    .getByTestId('conversation-message')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(bubbleColor).toBe('rgb(30, 41, 59)')

  // Leave shared state as we found it.
  await page.goto('/settings')
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

// ─── J. Developer reply — UI ─────────────────────────────────────────────────

test('A senior can reply to a client message and the reply persists', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await page.goto(`/messages/${ORIGINAL_THREAD}`)

  await expect(page.getByTestId('reply-composer')).toBeVisible()
  await expect(page.getByTestId('reply-mode-client')).toHaveClass(/active/)
  await expect(page.getByTestId('reply-submit')).toBeDisabled()

  await page
    .getByTestId('reply-input')
    .fill(`Thanks for reaching out — the quotation is on its way. ${REPLY_SENTINEL}`)
  await expect(page.getByTestId('reply-submit')).toBeEnabled()
  await page.getByTestId('reply-submit').click()

  await expect(page.getByTestId('reply-sent')).toBeVisible()
  await expect(page.getByTestId('reply-input')).toHaveValue('')

  const reply = page.getByTestId('conversation-message').filter({ hasText: REPLY_SENTINEL })
  await expect(reply).toHaveCount(1)
  await expect(reply).toHaveAttribute('data-sender-role', 'senior_dev_pm')

  // A reload proves the reply was persisted through the API/RLS, not just state.
  await page.reload()
  await expect(page.getByTestId('conversation-thread')).toBeVisible()
  await expect(
    page.getByTestId('conversation-message').filter({ hasText: REPLY_SENTINEL })
  ).toHaveCount(1)
})

// ─── K. Internal notes stay private ──────────────────────────────────────────

test('Internal notes are visible to developers but hidden from the client', async ({ request }) => {
  const headers = await apiHeaders(SENIOR_EMAIL, SENIOR_PASSWORD)
  const response = await request.post(`/api/messages/${restrictedThreadId}/reply`, {
    headers,
    data: { body: `Team-only discussion about the quotation. ${REPLY_SENTINEL}`, is_internal: true },
  })
  expect(response.status()).toBe(201)
  const created = await response.json()
  expect(created.data.is_internal).toBe(true)
  expect(created.data.sender_role).toBe('senior_dev_pm')

  // The senior sees the note through the conversation API.
  const seniorThread = await request.get(`/api/messages/${restrictedThreadId}`, { headers })
  const seniorBody = await seniorThread.json()
  expect(seniorBody.messages.some((m: { id: string }) => m.id === created.data.id)).toBeTruthy()

  // The client has a valid scope for this project, yet RLS still hides internals.
  const clientDb = callerClient((await signInWithPassword(CLIENT_EMAIL, CLIENT_PASSWORD)).accessToken)
  const hidden = await clientDb.from('support_tickets').select('id').eq('id', created.data.id)
  expect(hidden.error).toBeNull()
  expect(hidden.data ?? []).toHaveLength(0)

  // The original client-visible message in the same thread is still readable.
  const visible = await clientDb.from('support_tickets').select('id').eq('id', restrictedTicketId)
  expect(visible.data ?? []).toHaveLength(1)
})

// ─── L. Junior reply permissions ─────────────────────────────────────────────

test('A junior can reply on assigned projects but not unassigned ones', async ({ request }) => {
  const headers = await apiHeaders(JUNIOR_EMAIL, JUNIOR_PASSWORD)

  const allowed = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers,
    data: { body: `Quotation has been shared. ${REPLY_SENTINEL}`, is_internal: false },
  })
  expect(allowed.status()).toBe(201)
  const body = await allowed.json()
  expect(body.data.sender_role).toBe('junior_developer')
  expect(body.data.is_internal).toBe(false)

  const denied = await request.post(`/api/messages/${restrictedThreadId}/reply`, {
    headers,
    data: { body: `Should never be stored. ${REPLY_SENTINEL}` },
  })
  expect(denied.status()).toBe(404)

  // Bypassing our API with the junior's own Supabase token also fails RLS.
  const db = callerClient((await signInWithPassword(JUNIOR_EMAIL, JUNIOR_PASSWORD)).accessToken)
  const direct = await db.from('support_tickets').insert({
    thread_id: restrictedThreadId,
    project_id: restrictedProjectId,
    client_id: restrictedClientId,
    title: 'Bypass attempt',
    description: `Direct insert bypass ${REPLY_SENTINEL}`,
    sender_user_id: JUNIOR_ID,
    sender_role: 'junior_developer',
    is_internal: false,
  })
  expect(direct.error).not.toBeNull()
})

// ─── M. Reply API hardening ──────────────────────────────────────────────────

test('Reply API ignores forged identifiers and rejects invalid input and callers', async ({
  request,
}) => {
  const headers = await apiHeaders(SENIOR_EMAIL, SENIOR_PASSWORD)

  // Every scoping field in the body is deliberately bogus.
  const forged = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers,
    data: {
      body: `Forged identifiers must be ignored. ${REPLY_SENTINEL}`,
      project_id: restrictedProjectId,
      client_id: restrictedClientId,
      thread_id: restrictedThreadId,
      sender_user_id: JUNIOR_ID,
      sender_role: 'administrator',
      is_internal: false,
    },
  })
  expect(forged.status()).toBe(201)
  const created = await forged.json()
  expect(created.data.thread_id).toBe(ORIGINAL_THREAD)

  const { data } = await serviceClient()
    .from('support_tickets')
    .select('project_id, client_id, thread_id, sender_user_id, sender_role')
    .eq('id', created.data.id)
    .single()
  expect(data?.thread_id).toBe(ORIGINAL_THREAD)
  expect(data?.project_id).not.toBe(restrictedProjectId)
  expect(data?.sender_user_id).not.toBe(JUNIOR_ID)
  expect(data?.sender_role).toBe('senior_dev_pm')

  // Validation.
  const empty = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers,
    data: { body: '   ' },
  })
  expect(empty.status()).toBe(400)
  const oversized = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers,
    data: { body: 'x'.repeat(10001) },
  })
  expect(oversized.status()).toBe(400)

  // Clients are read-only; administrators have no message access.
  const clientHeaders = await apiHeaders(CLIENT_EMAIL, CLIENT_PASSWORD)
  const clientAttempt = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers: clientHeaders,
    data: { body: REPLY_SENTINEL },
  })
  expect(clientAttempt.status()).toBe(403)
  const adminHeaders = await apiHeaders(ADMIN_EMAIL, ADMIN_PASSWORD)
  const adminAttempt = await request.post(`/api/messages/${ORIGINAL_THREAD}/reply`, {
    headers: adminHeaders,
    data: { body: REPLY_SENTINEL },
  })
  expect(adminAttempt.status()).toBe(403)
})

// ─── N. Composer visibility ──────────────────────────────────────────────────

test('The reply composer is shown to developers but not to clients', async ({ page, browser }) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await page.goto(`/messages/${ORIGINAL_THREAD}`)
  await expect(page.getByTestId('reply-composer')).toBeVisible()

  const clientContext = await browser.newContext()
  const clientPage = await clientContext.newPage()
  try {
    await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
    await clientPage.goto(`/messages/${restrictedThreadId}`)
    await expect(clientPage.getByTestId('conversation-thread')).toBeVisible()
    await expect(clientPage.getByTestId('reply-composer')).toHaveCount(0)
  } finally {
    await clientContext.close()
  }
})
