import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { login, openMenu, serviceClient } from './helpers/admin'

/**
 * VISUAL WALKTHROUGH — run headed so the whole exchange is visible on screen:
 *
 *   npx playwright test tests/messages-reply-walkthrough.spec.ts \
 *     --project=Chromium --headed --reporter=list
 *
 * Real clicks only: junior replies, senior reads and answers, junior sees the
 * answer. Slow motion plus deliberate pauses make each step easy to follow.
 */

const JUNIOR_EMAIL = 'alex@test.com'
const JUNIOR_PASSWORD = 'test1234'
const JUNIOR_ID = '8920ec40-b47b-43a3-b45a-546b15c22365'
const SENIOR_EMAIL = 'elena@test.com'
const SENIOR_PASSWORD = 'test1234'
const INITIAL_PREVIEW = 'hello can you please share with me the quotation for the project'

const run = randomUUID().slice(0, 8)
const TOKEN = `WALKTHROUGH_${run}`
const JUNIOR_TEXT = `Junior update: please find the draft quotation attached. [${TOKEN}]`
const SENIOR_TEXT = `Senior acknowledgement: draft approved, sending today. [${TOKEN}]`

test.describe.configure({ mode: 'serial' })
test.use({ launchOptions: { slowMo: 600 } })

function pause(page: import('@playwright/test').Page, ms: number) {
  return page.waitForTimeout(ms)
}

async function openInbox(page: import('@playwright/test').Page) {
  await openMenu(page)
  await page.getByTestId('messages-nav-link').click()
  await expect(page.getByTestId('messages-loading')).toHaveCount(0)
  await expect(page.getByTestId('message-row').first()).toBeVisible()
}

async function openThreadByPreview(
  page: import('@playwright/test').Page,
  preview: string
) {
  const row = page.getByTestId('message-row').filter({ hasText: preview }).first()
  await expect(row).toBeVisible()
  await row.getByTestId('message-row-link').click()
  await expect(page.getByTestId('conversation-thread')).toBeVisible()
  await expect(page.getByTestId('reply-composer')).toBeVisible()
}

async function signOut(page: import('@playwright/test').Page) {
  await openMenu(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login$/, { timeout: 30000 })
}

async function sendReply(
  page: import('@playwright/test').Page,
  text: string,
  expectedSenderRole: string
) {
  await page.getByTestId('reply-input').fill(text)
  await expect(page.getByTestId('reply-submit')).toBeEnabled()
  await pause(page, 900) // let the text be visible before the click
  await page.getByTestId('reply-submit').click()
  await expect(page.getByTestId('reply-sent')).toBeVisible()

  const bubble = page.getByTestId('conversation-message').filter({ hasText: text })
  await expect(bubble).toHaveCount(1)
  await expect(bubble).toHaveAttribute('data-sender-role', expectedSenderRole)
  await pause(page, 1600)
}

test.afterAll(async () => {
  test.setTimeout(120_000)
  const svc = serviceClient()
  const { data: created } = await svc
    .from('support_tickets')
    .select('id')
    .ilike('description', `%${TOKEN}%`)
  for (const row of created ?? []) {
    await svc.from('support_ticket_reads').delete().eq('ticket_id', row.id)
    await svc.from('support_tickets').delete().eq('id', row.id)
  }

  // Opening the shared quotation thread marks it read for both demo accounts.
  // Clear those receipts so the unread assertions in messages-access.spec.ts
  // are repeatable regardless of which spec file happens to run last.
  const { data: seniorProfile } = await svc
    .from('profiles')
    .select('id')
    .eq('email', SENIOR_EMAIL)
    .maybeSingle()
  const userIds = [JUNIOR_ID, seniorProfile?.id].filter(Boolean) as string[]
  for (const userId of userIds) {
    await svc.from('support_ticket_reads').delete().eq('user_id', userId)
  }
})

test('Junior → Senior reply walkthrough (headed)', async ({ page }) => {
  test.slow()

  // ── 1. Junior opens the client conversation and replies ───────────────────
  console.log(`▶ JUNIOR (${JUNIOR_EMAIL}) signs in and opens Messages`)
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await openInbox(page)
  await pause(page, 1200)

  console.log(`▶ JUNIOR opens the quotation conversation and sends a reply`)
  await openThreadByPreview(page, INITIAL_PREVIEW)
  await pause(page, 1500)
  await sendReply(page, JUNIOR_TEXT, 'junior_developer')

  // ── 2. Senior signs in, reads the junior's reply, and answers ────────────
  console.log(`▶ Signing out junior; SENIOR (${SENIOR_EMAIL}) signs in`)
  await signOut(page)
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openInbox(page)
  await pause(page, 1200)

  console.log(`▶ SENIOR opens the same thread via the junior's reply in the inbox`)
  await openThreadByPreview(page, JUNIOR_TEXT)
  const juniorBubble = page.getByTestId('conversation-message').filter({ hasText: JUNIOR_TEXT })
  await expect(juniorBubble).toHaveCount(1)
  await expect(juniorBubble).toHaveAttribute('data-sender-role', 'junior_developer')
  await pause(page, 2500) // hold on the junior's message

  console.log(`▶ SENIOR sends an answer`)
  await sendReply(page, SENIOR_TEXT, 'senior_dev_pm')

  // ── 3. Junior signs back in and sees the senior's answer ─────────────────
  console.log(`▶ Signing out senior; JUNIOR signs back in to read the answer`)
  await signOut(page)
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await openInbox(page)
  await pause(page, 1200)

  console.log(`▶ JUNIOR opens the thread from the senior's reply in the inbox`)
  await openThreadByPreview(page, SENIOR_TEXT)
  const seniorBubble = page.getByTestId('conversation-message').filter({ hasText: SENIOR_TEXT })
  await expect(seniorBubble).toHaveCount(1)
  await expect(seniorBubble).toHaveAttribute('data-sender-role', 'senior_dev_pm')

  // Leave the finished conversation on screen so it can be inspected.
  console.log('▶ Walkthrough complete — holding the final conversation on screen')
  await pause(page, 15000)
})
