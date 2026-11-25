import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { openMenu } from './helpers/admin'

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots/sign-out')

test('SIGN OUT: drawer control ends the Supabase session', async ({ page }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  await page.goto('/login')
  await page.locator('input[type="email"]').fill('alex@test.com')
  await page.locator('input[type="password"]').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 })
  // Mobile hides the account label in the header; the name still renders in
  // the drawer and is attached to the DOM at every viewport size.
  const accountName = page.getByText('Alex Rivers').first()
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await expect(accountName).toBeAttached({ timeout: 15000 })
  } else {
    await expect(accountName).toBeVisible({ timeout: 15000 })
  }

  await openMenu(page)
  const signOut = page.getByTestId('nav-drawer').getByRole('button', { name: /sign out/i })
  await expect(signOut).toBeVisible()
  await page.screenshot({ path: path.join(SHOT_DIR, '01-drawer-sign-out.png'), fullPage: true })
  console.log('📸 screenshot: screenshots/sign-out/01-drawer-sign-out.png')

  await signOut.click()
  await expect(page).toHaveURL(/\/login$/, { timeout: 15000 })
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

  // Session must really be gone: protected pages redirect back to login.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/, { timeout: 15000 })
  await page.screenshot({ path: path.join(SHOT_DIR, '02-after-sign-out.png'), fullPage: true })
  console.log('📸 screenshot: screenshots/sign-out/02-after-sign-out.png')

  console.log('🎉 SIGN OUT PASSED — drawer control is visible and session is cleared')
})
