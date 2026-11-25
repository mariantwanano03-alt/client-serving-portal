import { expect, test } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  login,
  openMenu,
  serviceClient,
  shot,
  shotDir,
} from './helpers/admin'

const NEW_PASSWORD = 'AdminTest!New123'

test('Test F — administrator can manage personal theme and password', async ({ page }) => {
  const shots = shotDir('admin-restrictions')
  const service = serviceClient()
  const { data: adminProfile } = await service
    .from('profiles')
    .select('id')
    .eq('email', ADMIN_EMAIL)
    .single()
  if (!adminProfile?.id) throw new Error('Administrator profile not found')

  let passwordChanged = false
  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await openMenu(page)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible()

    await page.getByTestId('theme-dark').click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await shot(page, shots, 'F-01-admin-dark-theme-persisted.png')

    await page.getByTestId('theme-light').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await shot(page, shots, 'F-02-admin-light-theme.png')

    await page.locator('#current-password').fill(ADMIN_PASSWORD)
    await page.locator('#new-password').fill(NEW_PASSWORD)
    await page.locator('#confirm-new-password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: /change password/i }).click()
    await expect(page.getByText('Password updated successfully!')).toBeVisible({ timeout: 20000 })
    passwordChanged = true
    await shot(page, shots, 'F-03-password-changed.png')

    await openMenu(page)
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.waitForURL(/\/login$/)
    await login(page, ADMIN_EMAIL, NEW_PASSWORD)
    await expect(page.locator('.dashboard-account-details')).toContainText('Administrator')
    await shot(page, shots, 'F-04-login-with-new-password.png')

    // Restore the original credential through Supabase Auth admin API.
    await service.auth.admin.updateUserById(adminProfile.id, { password: ADMIN_PASSWORD })
    passwordChanged = false
    await openMenu(page)
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.waitForURL(/\/login$/)
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await expect(page.locator('.dashboard-account-details')).toContainText('Administrator')
  } finally {
    if (passwordChanged) {
      await service.auth.admin.updateUserById(adminProfile.id, { password: ADMIN_PASSWORD })
    }
  }
})
