import { test, expect } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  callerClient,
  firstAssignedProjectFor,
  login,
  openMenu,
  serviceClient,
  shot,
  shotDir,
  signInWithPassword,
} from './helpers/admin'

/**
 * Payment Progress / Financial Overview.
 *
 * The UI must be a read-only view of the existing `pts_deposit_overview` view
 * and `pts_payments` table. These tests exercise the real browser UI, the
 * caller-scoped API and the database rows behind them.
 *
 * Test data is temporary: payment amounts and due dates are restored, and the
 * client `pts_users` row / scope created for the permission test are removed.
 */

const SENIOR_EMAIL = 'elena@test.com'
const SENIOR_PASSWORD = 'test1234'
const JUNIOR_EMAIL = 'alex@test.com'
const JUNIOR_PASSWORD = 'test1234'
const CLIENT_EMAIL = 'musainnocent456@gmail.com'
const CLIENT_PASSWORD = 'test1234'
const CLIENT_USER_ID = '489ead68-79e9-40fb-b3cc-8de4e02602d4'
const CLIENT_ROLE_ID = '4343400f-6b60-446c-bbae-1ab44c803aee'

const PAID_PROJECT_ID = 'fa16d671-a89c-438c-9aec-1f495fac99f3'
const PAID_DEPOSIT_ID = 'f987ae97-42a7-412d-b053-02e41b6c0bdd'
const PARTIAL_PROJECT_ID = 'b594e3d7-532f-4fe2-b26c-67dee768c691'
const PARTIAL_DEPOSIT_ID = '97648d8c-94c9-46bb-8bdc-84a0f205e7aa'
const NO_PAYMENTS_PROJECT_ID = '0562ece7-7990-49f3-b889-42e375cbc003'
const CLIENT_PROJECT_ID = '6463c187-6b62-4f6d-849b-17019d9fbe54'

const SHOT_DIR = shotDir('payment-progress')

let originalPartialDueDate = '2026-12-07'
let originalPaidDueDate = '2026-11-25'
let testPaymentId = ''
let testPaymentVoided = false
let clientScopeId = ''
let createdClientPtsUser = false

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.slow()
})

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const svc = serviceClient()

  for (const [id, setter] of [
    [PARTIAL_DEPOSIT_ID, (v: string) => { originalPartialDueDate = v }],
    [PAID_DEPOSIT_ID, (v: string) => { originalPaidDueDate = v }],
  ] as const) {
    const { data } = await svc.from('deposits').select('due_date').eq('id', id).single()
    if (data?.due_date) setter(data.due_date)
  }

  // Keep the shared oversight credential valid for permission checks.
  await svc.auth.admin.updateUserById('0f4ea9f1-5385-41e3-b430-24377f4db88b', {
    password: ADMIN_PASSWORD,
  })

  // The client account has no PTS identity or scope by default. Add the
  // minimum temporary rows so the existing client_can_access_message() scope
  // helper can grant access to exactly one project.
  const { data: existing } = await svc
    .from('pts_users')
    .select('user_id')
    .eq('user_id', CLIENT_USER_ID)
    .maybeSingle()
  if (!existing) {
    const created = await svc.from('pts_users').insert({
      user_id: CLIENT_USER_ID,
      role_id: CLIENT_ROLE_ID,
      full_name: 'Payment Test Client',
      email: CLIENT_EMAIL,
      is_active: true,
    })
    if (!created.error) createdClientPtsUser = true
  }
  const scope = await svc
    .from('pts_user_scopes')
    .insert({ user_id: CLIENT_USER_ID, project_id: CLIENT_PROJECT_ID })
    .select('id')
    .single()
  if (scope.data) clientScopeId = scope.data.id
})

test.afterAll(async () => {
  test.setTimeout(180_000)
  const svc = serviceClient()
  if (testPaymentId && !testPaymentVoided) {
    await svc.from('pts_payments').update({
      status: 'VOID',
      void_reason: 'Playwright payment-progress test cleanup',
    }).eq('id', testPaymentId)
  }
  await svc.from('deposits').update({ due_date: originalPartialDueDate }).eq('id', PARTIAL_DEPOSIT_ID)
  await svc.from('deposits').update({ due_date: originalPaidDueDate }).eq('id', PAID_DEPOSIT_ID)
  if (clientScopeId) await svc.from('pts_user_scopes').delete().eq('id', clientScopeId)
  if (createdClientPtsUser) await svc.from('pts_users').delete().eq('user_id', CLIENT_USER_ID)
})

/** `Intl` uses non-breaking spaces as ZAR group separators; normalise them. */
function cleanMoney(text: string | null) {
  return (text || '').replace(/[\u00a0\s]/g, '')
}

/** The UI must agree with the live source row, not with stale hardcoded amounts. */
function moneyFromCents(cents: number, currency: string) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: currency || 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format((Number(cents) || 0) / 100)
}

function formatLongDate(value: string | null | undefined) {
  if (!value) return 'Not specified'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

type OverviewAmounts = {
  required_cents: number
  paid_cents: number
  outstanding_cents: number
  currency: string | null
}

/** Mirror the display math in lib/financial-format.ts and the financial UI. */
function expectedAmounts(source: OverviewAmounts) {
  const required = Number(source.required_cents) || 0
  const paid = Number(source.paid_cents) || 0
  const outstanding = Math.max(Number(source.outstanding_cents) || 0, 0)
  const currency = source.currency || 'ZAR'
  return {
    required: moneyFromCents(required, currency),
    paid: moneyFromCents(paid, currency),
    remaining: moneyFromCents(outstanding, currency),
    percent: required > 0
      ? Math.min(100, Math.max(0, Math.round((paid / required) * 100)))
      : 0,
  }
}

async function liveAmounts(depositId: string) {
  const { data, error } = await serviceClient()
    .from('pts_deposit_overview')
    .select('deposit_id, required_cents, paid_cents, outstanding_cents, currency')
    .eq('deposit_id', depositId)
    .single()
  expect(error, error?.message).toBeNull()
  expect(data).toBeTruthy()
  return expectedAmounts(data as OverviewAmounts)
}

/** Fixture deposits drift as real payments are confirmed; find a live one. */
async function findPartialDeposit() {
  const { data, error } = await serviceClient()
    .from('pts_deposit_overview')
    .select('deposit_id, project_id, due_date')
    .gt('paid_cents', 0)
    .gt('outstanding_cents', 0)
    .limit(1)
    .maybeSingle()
  expect(error, error?.message).toBeNull()
  expect(data?.deposit_id, 'no partially paid deposit is available').toBeTruthy()
  return data as { deposit_id: string; project_id: string; due_date: string | null }
}

async function activePaymentCount(depositId: string) {
  const { data, error } = await serviceClient()
    .from('pts_payments')
    .select('id')
    .eq('deposit_id', depositId)
    .neq('status', 'VOID')
  expect(error, error?.message).toBeNull()
  return data?.length ?? 0
}

async function openFinancials(page: import('@playwright/test').Page, projectId: string) {
  await page.goto(`/projects/${projectId}?tab=financials`)
  await expect(page.getByTestId('financials-tab')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('financials-loading')).toHaveCount(0, { timeout: 30_000 })
}

async function apiFinancials(accessToken: string, projectId: string) {
  const response = await fetch(`http://localhost:3000/api/financials?projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  return { status: response.status, body: await response.json() }
}

// ─── 1. Payment progress ─────────────────────────────────────────────────────

test('PAYMENT PROGRESS: financial section shows real amounts, due date and percentage', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openFinancials(page, PARTIAL_PROJECT_ID)

  const card = page.getByTestId('financial-overview')
  await expect(card).toBeVisible()
  await expect(card).toHaveCount(1)

  const { data: source, error: sourceError } = await serviceClient()
    .from('pts_deposit_overview')
    .select('required_cents, paid_cents, outstanding_cents, currency, due_date')
    .eq('deposit_id', PARTIAL_DEPOSIT_ID)
    .single()
  expect(sourceError).toBeNull()
  expect(source).toBeTruthy()

  const required = Number(source!.required_cents) || 0
  const paid = Number(source!.paid_cents) || 0
  const outstanding = Math.max(Number(source!.outstanding_cents) || 0, 0)
  const currency = source!.currency || 'ZAR'
  const percent = required > 0
    ? Math.min(100, Math.max(0, Math.round((paid / required) * 100)))
    : 0

  await expect(card.getByTestId('stat-required')).toHaveText(/R/)
  expect(cleanMoney(await card.getByTestId('stat-required').textContent()))
    .toBe(cleanMoney(moneyFromCents(required, currency)))
  expect(cleanMoney(await card.getByTestId('stat-paid').textContent()))
    .toBe(cleanMoney(moneyFromCents(paid, currency)))
  expect(cleanMoney(await card.getByTestId('stat-remaining').textContent()))
    .toBe(cleanMoney(moneyFromCents(outstanding, currency)))
  await expect(card.getByTestId('financial-due-date')).toHaveText(formatLongDate(source!.due_date))

  const bar = card.getByTestId('financial-progress')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('role', 'progressbar')
  await expect(bar).toHaveAttribute('aria-valuenow', String(percent))
  await expect(card.getByTestId('financial-percentage')).toHaveText(`${percent}%`)
  const fillWidth = await card.locator('.financial-progress-fill')
    .evaluate((el) => (el as HTMLElement).style.width)
  expect(fillWidth).toBe(`${percent}%`)

  await shot(page, SHOT_DIR, '01-payment-progress-light.png')
})

// ─── 2. Payment history ──────────────────────────────────────────────────────

test('PAYMENT HISTORY: only payments belonging to the current project are shown', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openFinancials(page, PARTIAL_PROJECT_ID)

  const history = page.getByTestId('payment-history')
  await expect(history).toBeVisible()
  // Other workflows may add confirmed payments to this shared deposit; the
  // history must show exactly the current non-VOID rows, not a fixed count.
  await expect(history.getByTestId('payment-row'))
    .toHaveCount(await activePaymentCount(PARTIAL_DEPOSIT_ID))

  await expect(history).toContainText('pay-002')
  await expect(history).toContainText('pay-002-2')
  await expect(history).toContainText('23 November 2026')
  expect(cleanMoney(await history.textContent())).toContain('R5000')
  expect(cleanMoney(await history.textContent())).toContain('R13000')

  // Another project's references must never leak into this history.
  await expect(history).not.toContainText('pay-001-5k')
  await shot(page, SHOT_DIR, '02-payment-history.png')
})

// ─── 3. Database update → refresh ───────────────────────────────────────────

test('DATABASE UPDATE: a newly recorded payment is reflected after refresh', async ({ page }) => {
  const svc = serviceClient()
  const reference = `PAY-PWTEST-${Date.now()}`
  // Live data can change: pick a deposit that still has room for this test
  // payment instead of assuming the fixture deposit is still outstanding.
  const { data: target, error: targetError } = await svc
    .from('pts_deposit_overview')
    .select('deposit_id, project_id')
    .gte('outstanding_cents', 200000)
    .limit(1)
    .maybeSingle()
  expect(targetError, targetError?.message).toBeNull()
  expect(target?.deposit_id, 'no deposit has room for the test payment').toBeTruthy()
  const updateDepositId = target!.deposit_id
  const updateProjectId = target!.project_id
  try {
    // The normal workflow records a new payment; recorded amounts are
    // immutable, and voiding is the supported way to reverse one.
    const inserted = await svc.from('pts_payments').insert({
      deposit_id: updateDepositId,
      amount_cents: 200000,
      payment_date: '2026-11-23',
      method: 'BANK_EFT',
      reference,
      notes: 'Playwright payment-progress test',
    }).select('id').single()
    expect(inserted.error, inserted.error?.message).toBeNull()
    testPaymentId = inserted.data?.id || ''

    await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
    await openFinancials(page, updateProjectId)

    const card = page.getByTestId('financial-overview')
    const afterInsert = await liveAmounts(updateDepositId)
    expect(cleanMoney(await card.getByTestId('stat-paid').textContent()))
      .toBe(cleanMoney(afterInsert.paid))
    expect(cleanMoney(await card.getByTestId('stat-remaining').textContent()))
      .toBe(cleanMoney(afterInsert.remaining))
    await expect(card.getByTestId('financial-percentage')).toHaveText(`${afterInsert.percent}%`)
    await expect(card.getByTestId('payment-history')).toContainText(reference)

    // In-page refresh reads the latest database values again.
    await card.getByTestId('financial-progress').scrollIntoViewIfNeeded()
    await page.getByTestId('financials-refresh').click()
    await expect(page.getByTestId('financials-loading')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('financial-overview').getByTestId('financial-percentage'))
      .toHaveText(`${afterInsert.percent}%`)

    // A full application reload must show the same updated state.
    await page.reload()
    await expect(page.getByTestId('financial-overview')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('financial-overview').getByTestId('financial-percentage'))
      .toHaveText(`${afterInsert.percent}%`)
    expect(cleanMoney(await page.getByTestId('payment-history').textContent()))
      .toContain(cleanMoney(moneyFromCents(200000, 'ZAR')))
    await shot(page, SHOT_DIR, '03-database-update-refresh.png')

    // Reverse the payment and confirm the UI returns to the original balance.
    const voided = await svc.from('pts_payments').update({
      status: 'VOID',
      void_reason: 'Playwright payment-progress test cleanup',
    }).eq('id', testPaymentId)
    expect(voided.error, voided.error?.message).toBeNull()
    testPaymentVoided = true

    const afterVoid = await liveAmounts(updateDepositId)
    await page.reload()
    await expect(page.getByTestId('financial-overview')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('financial-overview').getByTestId('financial-percentage'))
      .toHaveText(`${afterVoid.percent}%`)
    expect(cleanMoney(await page.getByTestId('stat-paid').textContent()))
      .toBe(cleanMoney(afterVoid.paid))
    // When the test payment was the deposit's only active payment, voiding it
    // removes the whole history section rather than leaving an empty list.
    const historyAfterVoid = page.getByTestId('payment-history')
    if (await historyAfterVoid.count()) {
      await expect(historyAfterVoid).not.toContainText(reference)
    }
  } finally {
    if (testPaymentId && !testPaymentVoided) {
      await svc.from('pts_payments').update({
        status: 'VOID',
        void_reason: 'Playwright payment-progress test cleanup',
      }).eq('id', testPaymentId)
      testPaymentVoided = true
    }
  }
})

// ─── 4. Fully paid ───────────────────────────────────────────────────────────

test('FULLY PAID: a settled deposit shows 100% and Payment Complete', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openFinancials(page, PAID_PROJECT_ID)

  const card = page.getByTestId('financial-overview')
  await expect(card.getByTestId('financial-status')).toHaveText('Paid')
  await expect(card.getByTestId('financial-percentage')).toHaveText('100%')
  await expect(card.getByTestId('financial-progress')).toHaveAttribute('aria-valuenow', '100')
  expect(cleanMoney(await card.getByTestId('stat-remaining').textContent())).toBe('R0')
  await expect(card.getByTestId('financial-complete')).toHaveText(/Payment Complete/)
  await expect(card.getByTestId('financial-overdue')).toHaveCount(0)
  await shot(page, SHOT_DIR, '04-fully-paid.png')
})

// ─── 5. Partial payment ──────────────────────────────────────────────────────

test('PARTIAL PAYMENT: outstanding balance is shown prominently', async ({ page }) => {
  const target = await findPartialDeposit()
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openFinancials(page, target.project_id)

  const card = page.getByTestId('financial-overview')
  const expected = await liveAmounts(target.deposit_id)
  await expect(card.getByTestId('financial-status')).toHaveText('Partially Paid')
  await expect(card.getByTestId('financial-remaining')).toContainText('remaining')
  expect(cleanMoney(await card.getByTestId('financial-remaining').textContent()))
    .toBe(`${cleanMoney(expected.remaining)}remaining`)
  await expect(card.getByTestId('financial-complete')).toHaveCount(0)
})

// ─── 6. Overdue ──────────────────────────────────────────────────────────────

test('OVERDUE: past-due outstanding deposit is flagged, paid deposit is not', async ({ page }) => {
  const svc = serviceClient()
  const target = await findPartialDeposit()
  try {
    await svc.from('deposits').update({ due_date: '2026-11-01' }).eq('id', target.deposit_id)
    await svc.from('deposits').update({ due_date: '2026-11-01' }).eq('id', PAID_DEPOSIT_ID)

    await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
    await openFinancials(page, target.project_id)
    const partial = page.getByTestId('financial-overview')
    await expect(partial.getByTestId('financial-status')).toHaveText('Overdue')
    await expect(partial.getByTestId('financial-overdue')).toHaveText(/Payment Overdue/)
    await expect(partial.getByTestId('financial-due-date')).toHaveText('1 November 2026')
    await shot(page, SHOT_DIR, '05-overdue.png')

    await openFinancials(page, PAID_PROJECT_ID)
    const paid = page.getByTestId('financial-overview')
    await expect(paid.getByTestId('financial-status')).toHaveText('Paid')
    await expect(paid.getByTestId('financial-complete')).toHaveText(/Payment Complete/)
    await expect(paid.getByTestId('financial-overdue')).toHaveCount(0)
  } finally {
    await svc.from('deposits').update({ due_date: target.due_date }).eq('id', target.deposit_id)
    await svc.from('deposits').update({ due_date: originalPaidDueDate }).eq('id', PAID_DEPOSIT_ID)
  }
})

// ─── 7. Permissions ──────────────────────────────────────────────────────────

test('PERMISSIONS: RLS denies junior/admin directly, admin gets read-only oversight, client is scoped', async ({ page }) => {
  const junior = await signInWithPassword(JUNIOR_EMAIL, JUNIOR_PASSWORD)
  const admin = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const client = await signInWithPassword(CLIENT_EMAIL, CLIENT_PASSWORD)
  const senior = await signInWithPassword(SENIOR_EMAIL, SENIOR_PASSWORD)

  const juniorResult = await apiFinancials(junior.accessToken, PARTIAL_PROJECT_ID)
  expect(juniorResult.status).toBe(200)
  expect(juniorResult.body.overview).toHaveLength(0)
  expect(juniorResult.body.payments).toHaveLength(0)

  // Direct database access with the junior token (RLS) must also return none.
  const juniorDb = callerClient(junior.accessToken)
  const juniorOverview = await juniorDb.from('pts_deposit_overview').select('deposit_id').limit(20)
  const juniorPayments = await juniorDb.from('pts_payments').select('id').limit(20)
  expect(juniorOverview.data ?? []).toHaveLength(0)
  expect(juniorPayments.data ?? []).toHaveLength(0)

  // Administrators receive the same records through a trusted, read-only
  // oversight path. Their direct RLS access is unchanged and still empty.
  const adminResult = await apiFinancials(admin.accessToken, PARTIAL_PROJECT_ID)
  expect(adminResult.status).toBe(200)
  expect(adminResult.body.overview).toHaveLength(1)
  expect(adminResult.body.overview[0].reference).toBe('DEP-2026-0002')
  expect(adminResult.body.payments.length).toBeGreaterThan(0)

  const adminDb = callerClient(admin.accessToken)
  const adminOverview = await adminDb.from('pts_deposit_overview').select('deposit_id').limit(20)
  const adminPayments = await adminDb.from('pts_payments').select('id').limit(20)
  expect(adminOverview.data ?? []).toHaveLength(0)
  expect(adminPayments.data ?? []).toHaveLength(0)

  const seniorResult = await apiFinancials(senior.accessToken, PARTIAL_PROJECT_ID)
  expect(seniorResult.body.overview).toHaveLength(1)
  expect(seniorResult.body.payments).toHaveLength(await activePaymentCount(PARTIAL_DEPOSIT_ID))

  const own = await apiFinancials(client.accessToken, CLIENT_PROJECT_ID)
  expect(own.body.overview).toHaveLength(1)
  expect(own.body.overview[0].reference).toBe('DEP-2026-0004')
  const ownReferences = own.body.payments.map((p: { reference: string }) => p.reference)
  expect(ownReferences).toContain('mosa-1')
  expect(ownReferences).not.toContain('pay-002')
  expect(ownReferences).not.toContain('pay-001-5k')

  const other = await apiFinancials(client.accessToken, PARTIAL_PROJECT_ID)
  expect(other.body.overview).toHaveLength(0)
  expect(other.body.payments).toHaveLength(0)

  const clientDb = callerClient(client.accessToken)
  const clientPayments = await clientDb.from('pts_payments').select('reference,status').limit(20)
  // VOID rows stay in the table (deletes are blocked by trigger) but are excluded
  // from the API/history, so assert scoping on the active rows only.
  const clientReferences = (clientPayments.data ?? [])
    .filter((p) => p.status !== 'VOID')
    .map((p) => p.reference)
  expect(clientReferences).toContain('mosa-1')
  expect(clientReferences).not.toContain('pay-002')
  expect(clientReferences).not.toContain('pay-001-5k')

  // The UI must agree with the backend: no data for unauthorised roles.
  // This junior is not assigned to the partial-payment project, so the
  // RLS-filtered workspace hides it entirely rather than showing its figures.
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await page.goto(`/projects/${PARTIAL_PROJECT_ID}?tab=financials`)
  await expect(page.getByText('Project not found.')).toBeVisible()

  // A genuinely assigned project still shows the read-only empty state.
  const juniorProject = await firstAssignedProjectFor(JUNIOR_EMAIL)
  await openFinancials(page, juniorProject.id)
  await expect(page.getByTestId('financials-empty')).toContainText('Payment information unavailable')

  // Administrators see the same project figures read-only in the project tab.
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await openFinancials(page, PARTIAL_PROJECT_ID)
  await expect(page.getByTestId('financial-overview')).toHaveCount(1)
  await expect(page.getByTestId('financial-overview')).toHaveAttribute('data-deposit-id', adminResult.body.overview[0].deposit_id)

  // The client's scoped figures are asserted through the API above. The client
  // shell exposes only home/messages/settings, so both central and per-project
  // financial routes must redirect rather than render another role's UI.
  await login(page, CLIENT_EMAIL, CLIENT_PASSWORD)
  for (const route of ['/financials', `/projects/${CLIENT_PROJECT_ID}?tab=financials`, `/projects/${PARTIAL_PROJECT_ID}?tab=financials`]) {
    await page.goto(route)
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
  }
  await shot(page, SHOT_DIR, '06-client-scoped.png')
})

// ─── Empty states ────────────────────────────────────────────────────────────

test('EMPTY STATES: missing overview and missing payments are handled gracefully', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)

  await openFinancials(page, NO_PAYMENTS_PROJECT_ID)
  await expect(page.getByTestId('financial-overview')).toHaveCount(1)
  await expect(page.getByTestId('payment-history-empty')).toHaveText('No payments recorded yet')
  expect(cleanMoney(await page.getByTestId('stat-paid').textContent())).toBe('R0')
  await expect(page.getByTestId('financial-percentage')).toHaveText('0%')

  const svc = serviceClient()
  const { data: deposits } = await svc.from('pts_deposit_overview').select('project_id')
  const { data: projects } = await svc.from('projects').select('id')
  const withDeposit = new Set((deposits ?? []).map((d) => d.project_id))
  const withoutDeposit = (projects ?? []).find((p) => !withDeposit.has(p.id))
  expect(withoutDeposit, 'a project without a deposit record').toBeTruthy()
  if (withoutDeposit) {
    await openFinancials(page, withoutDeposit.id)
    await expect(page.getByTestId('financials-empty')).toContainText('Payment information unavailable')
  }
})

// ─── Light / dark mode ───────────────────────────────────────────────────────

test('THEMES: financial overview renders in light and dark mode', async ({ page }) => {
  const target = await findPartialDeposit()
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await page.goto('/settings')
  await page.locator('[data-testid="theme-light"]').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await openFinancials(page, target.project_id)
  const card = page.getByTestId('financial-overview')
  const lightBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
  await shot(page, SHOT_DIR, '07-light-mode.png')

  await page.goto('/settings')
  await page.locator('[data-testid="theme-dark"]').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await openFinancials(page, target.project_id)
  const darkCard = page.getByTestId('financial-overview')
  const darkBg = await darkCard.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(darkBg).not.toBe(lightBg)
  expect(darkBg).toBe('rgba(30, 41, 59, 0.5)')

  const fillBg = await darkCard.locator('.financial-progress-fill')
    .evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(fillBg).toContain('linear-gradient')
  await shot(page, SHOT_DIR, '08-dark-mode.png')

  await page.goto('/settings')
  await page.locator('[data-testid="theme-light"]').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

// ─── Responsive layout ───────────────────────────────────────────────────────

test('RESPONSIVE: financial overview fits a mobile viewport without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await openFinancials(page, PARTIAL_PROJECT_ID)

  await expect(page.getByTestId('financial-overview')).toBeVisible()
  await expect(page.getByTestId('financial-progress')).toBeVisible()
  await expect(page.getByTestId('payment-history')).toBeVisible()

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1)
  await shot(page, SHOT_DIR, '09-mobile.png')
})

// ─── Central Financial Records page ──────────────────────────────────────────

test('CENTRAL PAGE: administrator can find, filter and read all financial records', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await openMenu(page)

  const navLink = page.getByRole('link', { name: 'Financial Records', exact: true })
  await expect(navLink).toBeVisible()
  await navLink.click()

  await expect(page.getByRole('heading', { name: 'Financial Records', exact: true })).toBeVisible()
  await expect(page.getByTestId('financial-records-readonly')).toBeVisible()
  await expect(page.getByTestId('financial-records-summary')).toBeVisible()

  await expect(page.getByTestId('financial-records-loading')).toHaveCount(0)
  const cards = page.getByTestId('financial-record-card')
  expect(await cards.count()).toBeGreaterThan(0)
  await expect(page.getByTestId('financial-records-history')).toBeVisible()
  expect(await page.getByTestId('financial-records-payment-row').count()).toBeGreaterThan(0)

  const projectFilter = page.getByTestId('financial-record-filter-project')
  await projectFilter.selectOption({ index: 1 })
  await expect(cards).toHaveCount(1)
  await expect(page.getByTestId('financial-records-reset')).toBeEnabled()

  await page.getByTestId('financial-records-reset').click()
  expect(await cards.count()).toBeGreaterThan(1)

  await page.getByTestId('financial-record-filter-from').fill('2026-11-01')
  await page.getByTestId('financial-record-filter-to').fill('2026-11-30')
  await expect(page.getByTestId('financial-records-reset')).toBeEnabled()
  await page.getByTestId('financial-records-reset').click()
  expect(await page.getByTestId('financial-records-payment-row').count()).toBeGreaterThan(0)

  await shot(page, SHOT_DIR, '10-central-records.png')
})
