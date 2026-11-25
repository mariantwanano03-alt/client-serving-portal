import { expect, test } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  callerClient,
  login,
  serviceClient,
  shot,
  shotDir,
  signInWithPassword,
} from './helpers/admin'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test('Test E — backend and database reject administrator bypass attempts', async ({ page }) => {
  const shots = shotDir('admin-restrictions')
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

  // Direct navigation to a business-operation URL is redirected.
  await page.goto('/create-project')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('add-new-project')).toHaveCount(0)
  await shot(page, shots, 'E-01-admin-create-project-redirected.png')

  const service = serviceClient()
  const { accessToken: adminToken } = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const { data: adminProfile } = await service
    .from('profiles')
    .select('id')
    .eq('email', ADMIN_EMAIL)
    .single()
  if (!adminProfile?.id) throw new Error('Administrator profile not found')

  // Administrators cannot modify their own role through the trusted API.
  const selfPatch = await fetch(`${BASE_URL}/api/admin/users/${adminProfile.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ role: 'junior_developer' }),
  })
  expect(selfPatch.status).toBe(403)
  expect((await selfPatch.json()).error).toMatch(/own role|own status/i)

  // Nor directly through PostgREST with their own token.
  const asAdmin = callerClient(adminToken)
  const selfUpdate = await asAdmin
    .from('profiles')
    .update({ role: 'junior_developer', is_active: true })
    .eq('id', adminProfile.id)
    .select()
  expect(Boolean(selfUpdate.error) || (selfUpdate.data?.length ?? 0) === 0).toBeTruthy()

  const { data: stillAdmin } = await service
    .from('profiles')
    .select('role, is_active')
    .eq('id', adminProfile.id)
    .single()
  expect(stillAdmin?.role).toBe('administrator')
  expect(stillAdmin?.is_active).toBe(true)

  // A non-admin cannot reach the oversight APIs or governance pages.
  const { accessToken: juniorToken } = await signInWithPassword('alex@test.com', 'test1234')
  for (const path of ['/api/admin/users', '/api/admin/audit']) {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${juniorToken}` },
    })
    expect(response.status, `${path} should reject junior developers`).toBe(403)
  }

  await page.goto('/login')
  await page.locator('#email-input').fill('alex@test.com')
  await page.locator('#password-input').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/$/)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/audit')
  await expect(page).toHaveURL(/\/$/)
  await shot(page, shots, 'E-02-non-admin-governance-redirected.png')

  // Signup metadata cannot self-assign the administrator role.
  const elevatedEmail = `elevation-test-${Date.now()}@test.com`
  const { data: created, error } = await service.auth.admin.createUser({
    email: elevatedEmail,
    password: 'ElevationTest!234',
    email_confirm: true,
    user_metadata: { role: 'administrator', full_name: 'Elevation Attempt' },
  })
  expect(error).toBeNull()
  if (!created.user) throw new Error('Elevation-test user was not created')
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { data } = await service.from('profiles').select('role').eq('id', created.user.id).single()
      if (data) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const { data: profile } = await service
      .from('profiles')
      .select('role')
      .eq('id', created.user.id)
      .single()
    expect(profile?.role).toBe('junior_developer')

    const { accessToken: attemptedToken } = await signInWithPassword(elevatedEmail, 'ElevationTest!234')
    const attempted = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${attemptedToken}` },
    })
    expect(attempted.status).toBe(403)
  } finally {
    await service.auth.admin.deleteUser(created.user.id)
  }
})
