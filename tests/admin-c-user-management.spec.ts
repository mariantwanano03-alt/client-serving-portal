import { expect, test, type Page } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  login,
  openMenu,
  serviceClient,
  shot,
  shotDir,
  signInWithPassword,
} from './helpers/admin'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const SUSPEND_MESSAGE =
  "Are you sure you want to suspend this user's role? Their permissions associated with this role will be revoked."
const REACTIVATE_MESSAGE = "Are you sure you want to reactivate this user's role?"

/**
 * Confirm a role/status change and wait for the trusted admin API to finish.
 * The dialog only closes on a successful PATCH; under load that call can take
 * several seconds, so waiting for closure (instead of a fixed 5s message
 * assertion) removes the race and surfaces server errors explicitly.
 */
async function confirmAndExpectSuccess(page: Page) {
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 60000 })

  const error = page.getByTestId('admin-error')
  if (await error.isVisible().catch(() => false)) {
    throw new Error('Admin action failed: ' + (await error.textContent()))
  }
  await expect(page.getByTestId('admin-success')).toBeVisible({ timeout: 15000 })
}

async function waitForProfile(service: ReturnType<typeof serviceClient>, id: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { data } = await service.from('profiles').select('id, role, is_active').eq('id', id).single()
    if (data) return data
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Profile was not created by handle_new_user()')
}

test('Test C — user roles and status can be managed, persist, and are effective', async ({ page, browser }) => {
  test.setTimeout(180000)
  const shots = shotDir('admin-restrictions')
  const service = serviceClient()
  const email = `role-test-${Date.now()}@test.com`
  const password = 'RoleTest!234'
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Role Management Test User' },
  })
  expect(createError).toBeNull()
  const userId = created.user!.id

  try {
    const profile = await waitForProfile(service, userId)
    expect(profile.role).toBe('junior_developer')

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await openMenu(page)
    await page.getByRole('link', { name: 'User Management', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible()
    await expect(page.getByText('Loading users...')).toBeHidden({ timeout: 30000 })

    const search = page.getByRole('textbox', { name: 'Search users' })
    await search.fill(email)
    const row = page.getByTestId('user-row').filter({ hasText: email })
    await expect(row).toBeVisible({ timeout: 15000 })
    await shot(page, shots, 'C-01-user-found.png')

    // Assign a permitted role with a confirmation step.
    await row.getByTestId('user-role-select').selectOption('senior_dev_pm')
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await confirmAndExpectSuccess(page)
    await expect(row.getByTestId('user-role-select')).toHaveValue('senior_dev_pm')
    await shot(page, shots, 'C-02-role-assigned.png')

    const { data: afterRole } = await service
      .from('profiles')
      .select('role, is_active')
      .eq('id', userId)
      .single()
    expect(afterRole?.role).toBe('senior_dev_pm')

    const { data: roleAudits } = await service
      .from('audit_entries')
      .select('*')
      .eq('entity_id', userId)
      .eq('action', 'user.role_changed')
      .order('created_at', { ascending: false })
      .limit(1)
    expect(roleAudits?.length).toBeGreaterThan(0)
    expect((roleAudits?.[0] as { after_value: { role: string } }).after_value.role).toBe('senior_dev_pm')

    // Persistence after refresh.
    await page.reload()
    await expect(page.getByText('Loading users...')).toBeHidden({ timeout: 30000 })
    await page.getByRole('textbox', { name: 'Search users' }).fill(email)
    await expect(page.getByTestId('user-row').filter({ hasText: email }).getByTestId('user-role-select'))
      .toHaveValue('senior_dev_pm')

    // Suspend the role with the exact confirmation prompt.
    const rowAfterReload = page.getByTestId('user-row').filter({ hasText: email })
    await rowAfterReload.getByTestId('user-status-toggle').click()
    await expect(page.getByTestId('confirm-dialog')).toContainText(SUSPEND_MESSAGE)
    await shot(page, shots, 'C-03-suspend-confirmation.png')
    await confirmAndExpectSuccess(page)
    await shot(page, shots, 'C-04-role-suspended.png')

    const { data: suspended } = await service
      .from('profiles')
      .select('role, is_active')
      .eq('id', userId)
      .single()
    expect(suspended?.is_active).toBe(false)
    expect(suspended?.role).toBe('senior_dev_pm')

    const { data: suspendAudits } = await service
      .from('audit_entries')
      .select('*')
      .eq('entity_id', userId)
      .eq('action', 'user.role_suspended')
      .limit(1)
    expect(suspendAudits?.length).toBeGreaterThan(0)

    // The suspended user cannot perform business operations or use the workspace.
    const targetSession = await signInWithPassword(email, password)
    const denied = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${targetSession.accessToken}`,
      },
      body: JSON.stringify({ name: 'Suspended user project attempt' }),
    })
    expect(denied.status).toBe(403)

    const suspendedContext = await browser.newContext()
    const suspendedPage = await suspendedContext.newPage()
    await suspendedPage.goto('/login')
    await suspendedPage.locator('#email-input').fill(email)
    await suspendedPage.locator('#password-input').fill(password)
    await suspendedPage.getByRole('button', { name: /sign in/i }).click()
    await expect(suspendedPage.getByTestId('role-suspended-screen')).toBeVisible({ timeout: 20000 })
    await expect(suspendedPage.getByTestId('role-suspended-banner')).toBeVisible()
    await shot(suspendedPage, shots, 'C-05-suspended-user-screen.png')
    await suspendedContext.close()

    // Reactivate with the exact confirmation prompt.
    await page.getByRole('textbox', { name: 'Search users' }).fill(email)
    await page.getByTestId('user-row').filter({ hasText: email }).getByTestId('user-status-toggle').click()
    await expect(page.getByTestId('confirm-dialog')).toContainText(REACTIVATE_MESSAGE)
    await confirmAndExpectSuccess(page)

    const { data: reactivated } = await service
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .single()
    expect(reactivated?.is_active).toBe(true)
    const { data: reactivateAudits } = await service
      .from('audit_entries')
      .select('*')
      .eq('entity_id', userId)
      .eq('action', 'user.role_reactivated')
      .limit(1)
    expect(reactivateAudits?.length).toBeGreaterThan(0)
    await shot(page, shots, 'C-06-role-reactivated.png')
  } finally {
    // Restore test state and remove the throwaway account.
    await service.from('profiles').update({ role: 'junior_developer', is_active: true }).eq('id', userId)
    await service.auth.admin.deleteUser(userId)
  }
})
