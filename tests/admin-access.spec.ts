import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_EMAIL, ADMIN_PASSWORD, openMenu } from './helpers/admin'

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots/admin-access')

test('ADMIN ACCESS: active administrator can sign in and open the admin area', async ({ page }) => {
  const email = ADMIN_EMAIL
  const password = ADMIN_PASSWORD

  fs.mkdirSync(SHOT_DIR, { recursive: true })

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text())
  })

  await page.goto('/login')
  await page.locator('#email-input').fill(email)
  await page.locator('#password-input').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 })
  // The account details are intentionally collapsed below 700px; on mobile the
  // avatar remains visible, so assert the name is rendered without requiring it
  // to be painted in the topbar.
  const accountName = page.getByText('Administrator Two').first()
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await expect(accountName).toBeAttached({ timeout: 15000 })
    await expect(page.locator('.dashboard-avatar')).toBeVisible()
  } else {
    await expect(accountName).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Administrator', { exact: true }).first()).toBeVisible()
  }
  await page.screenshot({ path: path.join(SHOT_DIR, '01-admin-dashboard.png'), fullPage: true })
  console.log('📸 screenshot: screenshots/admin-access/01-admin-dashboard.png')

  // Let the role guard and oversight data settle before navigating; clicking
  // during the first dashboard render can bounce back to /dashboard.
  await expect(page.getByText('Loading oversight records…')).toHaveCount(0)
  await openMenu(page)
  const adminLink = page.locator('.dashboard-nav a[href="/admin"]')
  await expect(adminLink).toBeVisible()
  await adminLink.click()
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible()
  await expect(page.getByTestId('client-readonly')).toHaveCount(0)
  await page.screenshot({ path: path.join(SHOT_DIR, '02-admin-page.png'), fullPage: true })
  console.log('📸 screenshot: screenshots/admin-access/02-admin-page.png')

  expect(errors).toEqual([])
  console.log('🎉 ADMIN ACCESS PASSED — admin2@test.com can use the admin area')
})
