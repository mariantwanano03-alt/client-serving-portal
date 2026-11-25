import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots/signup-link')

test('LOGIN → SIGNUP: unregistered users can navigate to the signup page', async ({ page }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text())
  })

  const shot = async (name: string) => {
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true })
    console.log(`📸 screenshot: screenshots/signup-link/${name}.png`)
  }

  // ------------------------------------------------------------- LIGHT MODE
  await page.goto('/login')
  const signupLink = page.getByTestId('signup-link')
  await expect(signupLink).toBeVisible()
  await expect(signupLink).toHaveAttribute('href', '/signup')
  await expect(signupLink).toHaveText(/sign up/i)
  await shot('01-login-light')

  await signupLink.click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible()
  await shot('02-signup-light')

  // -------------------------------------------------------------- DARK MODE
  await page.goto('/login')
  await page.evaluate(() => localStorage.setItem('cf-theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const darkLink = page.getByTestId('signup-link')
  await expect(darkLink).toBeVisible()
  const promptBg = await page.locator('.auth-signup-prompt')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log(`   dark signup prompt background=${promptBg}`)
  expect(promptBg).not.toBe('rgb(243, 244, 246)')
  expect(promptBg).toMatch(/^rgba\(37, 99, 235/)
  await shot('03-login-dark')

  await darkLink.click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible()
  await shot('04-signup-dark')

  expect(errors).toEqual([])
  console.log('🎉 SIGNUP LINK PASSED — visible and navigates in light + dark mode')
})
