import { test, expect, type Page } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  serviceClient,
  callerClient,
  signInWithPassword,
  login,
  openMenu,
} from './helpers/admin'

const TEST_PASSWORD = 'PendingTest!234'

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`
}

async function waitForProfile(service: ReturnType<typeof serviceClient>, userId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data } = await service.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (data) return data
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Profile for ${userId} was never created`)
}

async function profileByEmail(service: ReturnType<typeof serviceClient>, email: string) {
  const { data, error } = await service
    .from('profiles')
    .select('id, email, full_name, role, is_active, account_status, created_at')
    .eq('email', email)
    .single()
  if (error || !data) throw new Error(`Could not load profile for ${email}: ${error?.message}`)
  return data
}

async function auditRows(service: ReturnType<typeof serviceClient>, userId: string, action: string) {
  const { data } = await service
    .from('audit_entries')
    .select('id, action, actor_user_id, before_value, after_value, created_at')
    .eq('entity_id', userId)
    .eq('action', action)
  return data ?? []
}

async function apiStatus(page: Page, path: string, token: string, method: 'GET' | 'PATCH' = 'GET', body?: object) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.request.fetch(`http://localhost:3000${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { data: body } : {}),
      })
      return response.status()
    } catch (error) {
      // A long serial run can reset a keep-alive socket between Playwright and
      // the dev server. Retry only that transport condition; application
      // responses and denials are never retried or swallowed.
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 2 || !/ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)) throw error
      console.log(`   retrying ${path} after transport reset: ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error(`Could not call ${path}`)
}

async function signupPendingUser(page: Page, email: string) {
  // The cloud auth provider rate-limits UI sign-ups and rejects @test.com
  // addresses. Create the account with the service role (the same auth user
  // the sign-up endpoint would create), then verify the real pending screen
  // through the browser login flow.
  const service = serviceClient()
  await createPendingUser(service, email, 'Pending Registration Test User')
  await login(page, email, TEST_PASSWORD)
  await expect(page.getByTestId('pending-role-screen')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Your account has been created successfully.')).toBeVisible()
  await expect(page.getByTestId('pending-role-banner')).toContainText(
    'awaiting role assignment by an Administrator',
  )
}

async function createPendingUser(service: ReturnType<typeof serviceClient>, email: string, fullName: string) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`)
  await waitForProfile(service, data.user.id)
  return data.user.id
}

async function assignRoleFromAdminUI(page: Page, email: string, role: string) {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible()
  await page.getByTestId('user-filter-all').click()
  await page.getByRole('textbox', { name: 'Search users' }).fill(email)
  const row = page.getByTestId('user-row').filter({ hasText: email })
  await expect(row).toBeVisible()
  await row.getByTestId('assign-role-button').click()
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('assign-role-select').selectOption(role)
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 60000 })
  const errorBanner = page.getByTestId('admin-error')
  if (await errorBanner.isVisible().catch(() => false)) {
    throw new Error(`Role assignment failed: ${await errorBanner.textContent()}`)
  }
  await expect(page.getByTestId('admin-success')).toBeVisible()
}

test.describe.serial('Pending Role Assignment workflow', () => {
  test.setTimeout(240000)

  test('1. new registration defaults to junior developer with pending status', async ({ page }) => {
    const service = serviceClient()
    const email = uniqueEmail('pending-register')
    let userId: string | null = null

    try {
      await signupPendingUser(page, email)
      const profile = await profileByEmail(service, email)
      userId = profile.id

      expect(profile.role).toBe('junior_developer')
      expect(profile.account_status).toBe('pending_role_assignment')
      expect(profile.is_active).toBe(false)
      expect(profile.created_at).toBeTruthy()

      expect((await auditRows(service, profile.id, 'user.registered')).length).toBeGreaterThan(0)
      expect((await auditRows(service, profile.id, 'user.default_role_assigned')).length).toBeGreaterThan(0)

      const signOut = page.getByRole('button', { name: 'Sign out' })
      await expect(signOut).toBeVisible()
    } finally {
      if (userId) await service.auth.admin.deleteUser(userId)
    }
  })

  test('2. pending users cannot reach protected pages, APIs or self-service writes', async ({ page }) => {
    const service = serviceClient()
    const email = uniqueEmail('pending-restrict')
    let userId: string | null = null

    try {
      await signupPendingUser(page, email)
      const profile = await profileByEmail(service, email)
      userId = profile.id

      for (const path of ['/dashboard', '/projects', '/clients', '/messages', '/admin', '/audit', '/create-project']) {
        await page.goto(path)
        await expect(page.getByTestId('pending-role-screen'), `pending screen on ${path}`).toBeVisible()
        await expect(page.getByRole('link', { name: 'User Management', exact: true })).toHaveCount(0)
        await expect(page.getByTestId('messages-nav-link')).toHaveCount(0)
        await expect(page.getByTestId('user-row')).toHaveCount(0)
      }

      const { accessToken } = await signInWithPassword(email, TEST_PASSWORD)
      for (const path of [
        '/api/projects',
        '/api/messages',
        '/api/financials?projectId=00000000-0000-0000-0000-000000000000',
        '/api/admin/users',
        '/api/admin/audit',
        '/api/discovery-meetings',
      ]) {
        expect(await apiStatus(page, path, accessToken), `API ${path}`).toBe(403)
      }

      // Direct PostgREST write with the caller's own token is rejected by RLS.
      const caller = callerClient(accessToken)
      const { data: updatedByCaller } = await caller
        .from('profiles')
        .update({ role: 'administrator', account_status: 'active', is_active: true })
        .eq('id', profile.id)
        .select('id')
      // RLS filters the forbidden row out, so PostgREST reports no rows rather
      // than an error. Either outcome is a denial; the DB check below is the
      // authoritative assertion.
      expect(updatedByCaller ?? []).toEqual([])

      const unchanged = await profileByEmail(service, email)
      expect(unchanged.role).toBe('junior_developer')
      expect(unchanged.account_status).toBe('pending_role_assignment')
      expect(unchanged.is_active).toBe(false)

      // Even a trusted API call cannot activate a pending account without a role.
      const adminSession = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
      expect(await apiStatus(
        page,
        `/api/admin/users/${profile.id}`,
        adminSession.accessToken,
        'PATCH',
        { account_status: 'active' },
      )).toBe(400)
    } finally {
      if (userId) await service.auth.admin.deleteUser(userId)
    }
  })

  test('3. administrator finds pending users and confirms the junior role', async ({ page }) => {
    const service = serviceClient()
    const email = uniqueEmail('pending-assign')
    const fullName = 'Pending Assignment Test User'
    let userId: string | null = null

    try {
      userId = await createPendingUser(service, email, fullName)
      const adminSession = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await openMenu(page)
      await page.getByRole('link', { name: 'User Management', exact: true }).click()
      await page.getByTestId('user-filter-pending').click()
      await page.getByRole('textbox', { name: 'Search users' }).fill(email)
      const row = page.getByTestId('user-row').filter({ hasText: email })
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute('data-status', 'pending_role_assignment')
      await expect(row.getByTestId('user-status-badge')).toContainText('Pending Role Assignment')
      await expect(row.locator('td').nth(2)).not.toHaveText('')

      await row.getByTestId('assign-role-button').click()
      await expect(page.getByTestId('confirm-dialog')).toBeVisible()
      await page.getByTestId('assign-role-select').selectOption('junior_developer')
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 60000 })
      await expect(page.getByTestId('admin-success')).toContainText('now active')

      await page.getByTestId('user-filter-all').click()
      await expect(row).toHaveAttribute('data-status', 'active')
      await expect(row.getByTestId('user-status-badge')).toContainText('Active')

      const updated = await profileByEmail(service, email)
      expect(updated.role).toBe('junior_developer')
      expect(updated.account_status).toBe('active')
      expect(updated.is_active).toBe(true)

      const assignment = await auditRows(service, userId, 'user.role_assigned')
      expect(assignment.length).toBeGreaterThan(0)
      expect(assignment[0].after_value).toMatchObject({
        previous_role: 'junior_developer',
        new_role: 'junior_developer',
        account_status: 'active',
      })
      expect(assignment[0].actor_user_id).toBeTruthy()
      expect((await auditRows(service, userId, 'user.account_activated')).length).toBeGreaterThan(0)

      // The newly active account can reach a staff API on its next request.
      const targetSession = await signInWithPassword(email, TEST_PASSWORD)
      expect(await apiStatus(page, '/api/messages', targetSession.accessToken)).toBe(200)
      expect(await apiStatus(page, '/api/admin/users', targetSession.accessToken)).toBe(403)
      expect(adminSession.accessToken).toBeTruthy()
    } finally {
      if (userId) await service.auth.admin.deleteUser(userId)
    }
  })

  test('4. each assignable role activates the account and applies its permissions', async ({ page }) => {
    const service = serviceClient()
    const roles = [
      { role: 'junior_developer', allowed: '/api/messages', denied: '/api/admin/users' },
      { role: 'senior_dev_pm', allowed: '/api/messages', denied: '/api/admin/users' },
      { role: 'client', allowed: '/api/messages', denied: '/api/admin/users' },
      // Administrators are oversight-only and deliberately excluded from messages.
      { role: 'administrator', allowed: '/api/admin/users', denied: '/api/messages' },
    ] as const

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    for (const { role, allowed, denied } of roles) {
      const email = uniqueEmail(`role-${role}`)
      let userId: string | null = null
      try {
        userId = await createPendingUser(service, email, `Role ${role} Test User`)
        await assignRoleFromAdminUI(page, email, role)

        const updated = await profileByEmail(service, email)
        expect(updated.role, `role ${role}`).toBe(role)
        expect(updated.account_status, `status after ${role}`).toBe('active')
        expect(updated.is_active, `is_active after ${role}`).toBe(true)
        expect((await auditRows(service, userId, 'user.role_assigned')).length).toBeGreaterThan(0)

        const session = await signInWithPassword(email, TEST_PASSWORD)
        expect(await apiStatus(page, allowed, session.accessToken), `${role} allowed ${allowed}`).toBe(200)
        if (denied) {
          expect(await apiStatus(page, denied, session.accessToken), `${role} denied ${denied}`).toBe(403)
        }
      } finally {
        if (userId) await service.auth.admin.deleteUser(userId)
      }
    }
  })

  test('5. role and status escalation attempts are rejected', async ({ page }) => {
    const service = serviceClient()
    const email = uniqueEmail('pending-escalation')
    let userId: string | null = null

    try {
      userId = await createPendingUser(service, email, 'Escalation Test User')
      const { accessToken } = await signInWithPassword(email, TEST_PASSWORD)
      const adminSession = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)

      // Modified API request from the pending account itself.
      expect(await apiStatus(
        page,
        `/api/admin/users/${userId}`,
        accessToken,
        'PATCH',
        { role: 'administrator', account_status: 'active' },
      )).toBe(403)

      // Direct database write with the pending account's token.
      const denied = await callerClient(accessToken)
        .from('profiles')
        .update({ role: 'administrator', is_active: true, account_status: 'active' })
        .eq('id', userId)
        .select('id')
      expect(denied.data ?? []).toEqual([])

      // An administrator cannot re-create the pending status or set their own role.
      expect(await apiStatus(
        page,
        `/api/admin/users/${userId}`,
        adminSession.accessToken,
        'PATCH',
        { account_status: 'pending_role_assignment' },
      )).toBe(400)
      expect(await apiStatus(
        page,
        `/api/admin/users/${adminSession.session.user.id}`,
        adminSession.accessToken,
        'PATCH',
        { role: 'junior_developer' },
      )).toBe(403)

      // A non-administrator cannot change another user.
      const juniorSession = await signInWithPassword('alex@test.com', 'test1234')
      expect(await apiStatus(
        page,
        `/api/admin/users/${userId}`,
        juniorSession.accessToken,
        'PATCH',
        { role: 'administrator' },
      )).toBe(403)

      const unchanged = await profileByEmail(service, email)
      expect(unchanged.role).toBe('junior_developer')
      expect(unchanged.account_status).toBe('pending_role_assignment')
      expect(unchanged.is_active).toBe(false)
    } finally {
      if (userId) await service.auth.admin.deleteUser(userId)
    }
  })

  test('6. existing users keep their roles, statuses and permissions', async ({ page }) => {
    const service = serviceClient()
    const expectations = [
      { email: 'alex@test.com', role: 'junior_developer', status: 'active' },
      { email: 'elena@test.com', role: 'senior_dev_pm', status: 'active' },
      { email: 'admin2@test.com', role: 'administrator', status: 'active' },
      { email: 'musainnocent456@gmail.com', role: 'client', status: 'active' },
    ]

    for (const expected of expectations) {
      const profile = await profileByEmail(service, expected.email)
      expect(profile.role, expected.email).toBe(expected.role)
      expect(profile.account_status, expected.email).toBe(expected.status)
      expect(profile.is_active, expected.email).toBe(true)
    }

    const legacyPending = await service
      .from('profiles')
      .select('id, email')
      .lt('created_at', '2026-11-23')
      .eq('account_status', 'pending_role_assignment')
    expect(legacyPending.data ?? []).toEqual([])

    for (const [email, allowedPath] of [
      ['alex@test.com', '/api/messages'],
      ['elena@test.com', '/api/messages'],
      ['admin2@test.com', '/api/admin/users'],
    ]) {
      const session = await signInWithPassword(email, 'test1234')
      expect(await apiStatus(page, allowedPath, session.accessToken), email).toBe(200)
    }
  })

  test('7. regression: login, dashboards, user management, logout and themes', async ({ page }) => {
    await login(page, 'elena@test.com', 'test1234')
    await openMenu(page)
    await expect(page.getByTestId('messages-nav-link')).toBeVisible()
    await expect(page.getByRole('link', { name: 'User Management', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('admin-readonly-banner')).toHaveCount(0)

    await page.goto('/settings')
    await page.getByTestId('theme-dark').click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByTestId('theme-light').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await openMenu(page)
    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('signup-link')).toBeVisible()

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await expect(page.getByTestId('admin-readonly-banner')).toBeVisible()
    await openMenu(page)
    await page.getByRole('link', { name: 'User Management', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible()
    await expect(page.getByTestId('user-row').first()).toBeVisible()
    await expect(page.getByTestId('user-filter-pending')).toBeVisible()
  })
})
