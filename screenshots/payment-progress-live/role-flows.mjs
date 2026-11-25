import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const PARTIAL_REF = 'PRJ-MWKSFWNK'
const PAID_REF = 'PRJ-MWKP686A'
const NO_PAYMENTS_REF = 'PRJ-MWKS8EOJ'
const PARTIAL_PROJECT_ID = 'b594e3d7-532f-4fe2-b26c-67dee768c691'
const PAID_PROJECT_ID = 'fa16d671-a89c-438c-9aec-1f495fac99f3'
const NO_PAYMENTS_PROJECT_ID = '0562ece7-7990-49f3-b889-42e375cbc003'
const PARTIAL_DEPOSIT_ID = '97648d8c-94c9-46bb-8bdc-84a0f205e7aa'

const JUNIOR = { label: 'JUNIOR', email: 'alex@test.com', password: 'test1234' }
const SENIOR = { label: 'SENIOR', email: 'elena@test.com', password: 'test1234' }
const ADMIN = { label: 'ADMIN', email: 'admin2@test.com', password: 'test1234' }

function loadEnv() {
  const raw = fs.readFileSync('.env.local', 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

const env = loadEnv()
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  slowMo: 500,
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

page.on('console', (message) => {
  if (message.type() === 'error') console.log(`[BROWSER ERROR] ${message.text()}`)
})
page.on('pageerror', (error) => console.log(`[BROWSER PAGEERROR] ${error.message}`))

async function action(text, fn) {
  console.log(`\n▶ ACTION: ${text}`)
  await fn()
  await page.waitForTimeout(400)
}

async function check(text, fn) {
  await fn()
  console.log(`  ✓ CHECK: ${text}`)
}

async function dbAction(text, fn) {
  console.log(`\n◆ DB ACTION: ${text}`)
  const result = await fn()
  if (result?.error) throw new Error(`${text}: ${result.error.message}`)
  return result
}

async function login(user) {
  await action(`${user.label}: open ${BASE}/login`, () => page.goto(`${BASE}/login`))
  await action(`${user.label}: type email ${user.email}`, () =>
    page.locator('#email-input').fill(user.email))
  await action(`${user.label}: type password`, () =>
    page.locator('#password-input').fill(user.password))
  await action(`${user.label}: click Sign in`, () =>
    page.getByRole('button', { name: /sign in/i }).click())
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 })
  await check(`${user.label}: dashboard is visible`, async () => {
    await expect(page.locator('.dashboard-shell')).toBeVisible()
  })
}

async function signOut(user) {
  await action(`${user.label}: click Sign out`, () =>
    page.getByRole('button', { name: 'Sign out' }).click())
  await page.waitForURL(/\/login$/, { timeout: 30_000 })
  await check(`${user.label}: returned to login`, async () => {
    await expect(page.locator('#email-input')).toBeVisible()
  })
}

async function openFinancials(projectRef, projectId, label) {
  await action(`${label}: click the Projects nav link`, () =>
    page.locator('.dashboard-nav a[href="/projects"]').click())
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 })

  const row = page.getByText(projectRef, { exact: true }).first()
  let clickedRow = true
  try {
    await row.click({ timeout: 4000 })
    console.log(`  ✓ CHECK: ${label}: clicked the ${projectRef} project row`)
  } catch {
    clickedRow = false
    await action(`${label}: open ${projectRef} workspace URL`, () =>
      page.goto(`${BASE}/projects/${projectId}?tab=financials`))
  }
  if (clickedRow && !page.url().includes(projectId)) {
    await action(`${label}: open ${projectRef} workspace URL`, () =>
      page.goto(`${BASE}/projects/${projectId}?tab=financials`))
  }
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`), { timeout: 30_000 })
  await action(`${label}: click the Financials tab`, () =>
    page.getByRole('button', { name: 'Financials' }).click())
  await expect(page.getByTestId('financials-tab')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('financials-loading')).toHaveCount(0, { timeout: 30_000 })
}

async function refreshFinancials(label) {
  await action(`${label}: click Refresh`, () =>
    page.getByTestId('financials-refresh').click())
  await expect(page.getByTestId('financials-loading')).toHaveCount(0, { timeout: 30_000 })
}

let failed = false
let testPaymentId = ''
let originalDueDate = ''

try {
  const deposit = await svc.from('deposits').select('due_date').eq('id', PARTIAL_DEPOSIT_ID).single()
  originalDueDate = deposit.data?.due_date || '2026-12-07'

  console.log('\n========================= JUNIOR FLOW =========================')
  await login(JUNIOR)

  await check('junior: Messages nav is present', async () => {
    await expect(page.getByTestId('messages-nav-link')).toBeVisible()
  })
  await check('junior: admin User Management nav is absent', async () => {
    await expect(page.locator('.dashboard-nav a[href="/admin"]')).toHaveCount(0)
  })

  await openFinancials(PARTIAL_REF, PARTIAL_PROJECT_ID, 'junior')
  await check('junior: Financials shows "Payment information unavailable"', async () => {
    await expect(page.getByTestId('financials-empty')).toContainText('Payment information unavailable')
  })

  await action('junior: click the Messages nav link', () =>
    page.getByTestId('messages-nav-link').click())
  await expect(page.getByTestId('messages-loading')).toHaveCount(0, { timeout: 30_000 })
  await check('junior: inbox loaded', async () => {
    await expect(page.locator('.messages-card')).toBeVisible()
  })

  await action('junior: type /admin directly in the address bar', () => page.goto(`${BASE}/admin`))
  await check('junior: redirected away from /admin', async () => {
    await expect(page).not.toHaveURL(/\/admin$/, { timeout: 15_000 })
  })
  await signOut(JUNIOR)

  console.log('\n========================= SENIOR FLOW =========================')
  await login(SENIOR)

  await check('senior: Messages nav is present', async () => {
    await expect(page.getByTestId('messages-nav-link')).toBeVisible()
  })

  await openFinancials(PARTIAL_REF, PARTIAL_PROJECT_ID, 'senior')
  await check('senior: partial payment progress is 29%', async () => {
    await expect(page.getByTestId('financial-percentage')).toHaveText('29%')
    await expect(page.getByTestId('financial-progress')).toHaveAttribute('aria-valuenow', '29')
  })
  await check('senior: payment history has 2 rows', async () => {
    await expect(page.getByTestId('payment-row')).toHaveCount(2)
  })
  await refreshFinancials('senior')

  try {
    const reference = `LIVE-ROLE-FLOW-${Date.now()}`
    const inserted = await dbAction('insert a R2 000 payment for DEP-2026-0002', () =>
      svc.from('pts_payments').insert({
        deposit_id: PARTIAL_DEPOSIT_ID,
        amount_cents: 200000,
        payment_date: '2026-11-23',
        method: 'BANK_EFT',
        reference,
        notes: 'Live role-flow verification',
      }).select('id').single())
    testPaymentId = inserted.data.id
    await refreshFinancials('senior')
    await check('senior: UI moved to 32% after the database insert', async () => {
      await expect(page.getByTestId('financial-percentage')).toHaveText('32%')
      await expect(page.getByTestId('payment-history')).toContainText(reference)
    })

    await dbAction('void that test payment', () =>
      svc.from('pts_payments').update({
        status: 'VOID',
        void_reason: 'Live role-flow verification cleanup',
      }).eq('id', testPaymentId))
    testPaymentId = ''
    await refreshFinancials('senior')
    await check('senior: UI returned to 29% after void', async () => {
      await expect(page.getByTestId('financial-percentage')).toHaveText('29%')
      await expect(page.getByTestId('payment-history')).not.toContainText(reference)
    })
  } finally {
    if (testPaymentId) {
      await svc.from('pts_payments').update({
        status: 'VOID',
        void_reason: 'Live role-flow verification cleanup',
      }).eq('id', testPaymentId)
      testPaymentId = ''
    }
  }

  try {
    await dbAction('set DEP-2026-0002 due date to 2026-11-01', () =>
      svc.from('deposits').update({ due_date: '2026-11-01' }).eq('id', PARTIAL_DEPOSIT_ID))
    await refreshFinancials('senior')
    await check('senior: overdue status and callout are shown', async () => {
      await expect(page.getByTestId('financial-status')).toHaveText('Overdue')
      await expect(page.getByTestId('financial-overdue')).toContainText('Payment Overdue')
    })
  } finally {
    await dbAction('restore DEP-2026-0002 due date', () =>
      svc.from('deposits').update({ due_date: originalDueDate }).eq('id', PARTIAL_DEPOSIT_ID))
    await refreshFinancials('senior')
  }

  await action('senior: click Clients tab', () =>
    page.getByRole('button', { name: 'Clients' }).click())
  await check('senior: clients tab is visible', async () => {
    await expect(page.getByTestId('project-readonly')).toHaveCount(0)
  })
  await action('senior: click Financials tab again', () =>
    page.getByRole('button', { name: 'Financials' }).click())
  await expect(page.getByTestId('financial-overview')).toBeVisible({ timeout: 30_000 })

  await openFinancials(PAID_REF, PAID_PROJECT_ID, 'senior')
  await check('senior: fully paid deposit shows 100% and Payment Complete', async () => {
    await expect(page.getByTestId('financial-percentage')).toHaveText('100%')
    await expect(page.getByTestId('financial-status')).toHaveText('Paid')
    await expect(page.getByTestId('financial-complete')).toContainText('Payment Complete')
  })

  await openFinancials(NO_PAYMENTS_REF, NO_PAYMENTS_PROJECT_ID, 'senior')
  await check('senior: no-payment deposit shows "No payments recorded yet"', async () => {
    await expect(page.getByTestId('payment-history-empty')).toHaveText('No payments recorded yet')
    await expect(page.getByTestId('financial-percentage')).toHaveText('0%')
  })

  await action('senior: click Settings nav', () =>
    page.locator('.dashboard-nav a[href="/settings"]').click())
  await action('senior: click theme-dark', () =>
    page.getByTestId('theme-dark').click())
  await check('senior: html has dark class', async () => {
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
  await openFinancials(PARTIAL_REF, PARTIAL_PROJECT_ID, 'senior (dark)')
  await check('senior: financial card visible in dark mode', async () => {
    await expect(page.getByTestId('financial-overview')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
  await action('senior: click Settings nav', () =>
    page.locator('.dashboard-nav a[href="/settings"]').click())
  await action('senior: click theme-light to restore', () =>
    page.getByTestId('theme-light').click())
  await check('senior: light theme restored', async () => {
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })
  await signOut(SENIOR)

  console.log('\n========================== ADMIN FLOW ==========================')
  await login(ADMIN)

  await check('admin: User Management nav is present', async () => {
    await expect(page.locator('.dashboard-nav a[href="/admin"]')).toBeVisible()
  })
  await check('admin: Audit Trails nav is present', async () => {
    await expect(page.locator('.dashboard-nav a[href="/audit"]')).toBeVisible()
  })
  await check('admin: Messages nav is absent', async () => {
    await expect(page.getByTestId('messages-nav-link')).toHaveCount(0)
  })

  await openFinancials(PARTIAL_REF, PARTIAL_PROJECT_ID, 'admin')
  await check('admin: Financials shows "Payment information unavailable"', async () => {
    await expect(page.getByTestId('financials-empty')).toContainText('Payment information unavailable')
  })
  await check('admin: read-only banner is shown in workspace', async () => {
    await expect(page.getByTestId('project-readonly')).toBeVisible()
  })

  await action('admin: click User Management nav', () =>
    page.locator('.dashboard-nav a[href="/admin"]').click())
  await check('admin: /admin page loaded', async () => {
    await page.waitForURL(/\/admin$/, { timeout: 30_000 })
  })
  await action('admin: click Audit Trails nav', () =>
    page.locator('.dashboard-nav a[href="/audit"]').click())
  await check('admin: /audit page loaded', async () => {
    await page.waitForURL(/\/audit$/, { timeout: 30_000 })
    await expect(page.getByText('Audit Trails').first()).toBeVisible({ timeout: 30_000 })
  })

  await check('admin: no unread-messages badge is rendered anywhere', async () => {
    await expect(page.getByTestId('messages-nav-badge')).toHaveCount(0)
  })
  await signOut(ADMIN)

  console.log('\n✅ ALL THREE ROLE FLOWS COMPLETED')
} catch (error) {
  failed = true
  console.error(`\n❌ FAILED: ${error?.message || error}`)
} finally {
  if (testPaymentId) {
    await svc.from('pts_payments').update({
      status: 'VOID',
      void_reason: 'Live role-flow verification cleanup',
    }).eq('id', testPaymentId)
  }
  await svc.from('deposits').update({ due_date: originalDueDate || '2026-12-07' })
    .eq('id', PARTIAL_DEPOSIT_ID)
  await context.close()
  await browser.close()
}

if (failed) process.exit(1)
