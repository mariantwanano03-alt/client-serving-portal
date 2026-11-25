import { expect, test } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  callerClient,
  login,
  openMenu,
  rlsError,
  serviceClient,
  shot,
  shotDir,
  signInWithPassword,
} from './helpers/admin'

test('Test A — administrator can view clients but cannot mutate them', async ({ page }) => {
  const shots = shotDir('admin-restrictions')
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

  // Navigation reflects only oversight responsibilities.
  await openMenu(page)
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Clients', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'User Management', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Audit Trails', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByTestId('add-new-project')).toHaveCount(0)

  await page.getByRole('link', { name: 'Clients', exact: true }).click()
  await expect(page.getByTestId('client-readonly')).toBeVisible()
  await expect(page.getByTestId('client-row').first()).toBeVisible()
  expect(await page.getByTestId('client-row').count()).toBeGreaterThan(0)

  const forbiddenControls = page.locator('button, a').filter({
    hasText: /create client|add client|edit client|delete client|upload client|new client/i,
  })
  await expect(forbiddenControls).toHaveCount(0)
  await shot(page, shots, 'A-01-clients-readonly.png')

  // Open an individual client profile (read-only).
  await page.getByTestId('client-row').first().locator('a').first().click()
  await expect(page.getByTestId('client-readonly')).toBeVisible()
  await expect(forbiddenControls).toHaveCount(0)
  await shot(page, shots, 'A-02-client-profile-readonly.png')

  // Backend boundary: direct PostgREST writes with the admin token must fail RLS.
  const adminSession = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const asAdmin = callerClient(adminSession.accessToken)
  const insert = await asAdmin.from('clients').insert({
    client_code: `FORBIDDEN-${Date.now()}`,
    name: 'Forbidden Client Direct Insert',
    primary_contact: 'Should not be created',
  })
  expect(rlsError(insert.error)).toBeTruthy()

  const service = serviceClient()
  const { data: firstClient } = await service.from('clients').select('id, name').limit(1).single()
  if (!firstClient) throw new Error('No client available for verification')
  const update = await asAdmin
    .from('clients')
    .update({ name: 'Forbidden Client Direct Update' })
    .eq('id', firstClient.id)
    .select()
  // RLS filters rows the caller cannot update: either an explicit error or
  // zero affected rows. The data-integrity assertion below is the real check.
  expect(Boolean(update.error) || (update.data?.length ?? 0) === 0).toBeTruthy()

  const { data: unchanged } = await service
    .from('clients')
    .select('name')
    .eq('id', firstClient.id)
    .single()
  expect(unchanged?.name).toBe(firstClient.name)
})
