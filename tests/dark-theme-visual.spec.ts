import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { firstAssignedProjectFor } from './helpers/admin'

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots/dark-theme')

test('DARK THEME: Purple Bee-inspired palette applied across the app', async ({ page }) => {
  test.setTimeout(300000)
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text())
  })

  const settle = () => page.waitForTimeout(450)
  const goto = async (url: string) => {
    await page.goto(url)
    await settle()
  }

  const shot = async (name: string) => {
    await settle()
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true })
    console.log(`📸 screenshot: screenshots/dark-theme/${name}.png`)
  }

  // Flag any visibly large element that is still painted with a light theme
  // surface. Native controls and tiny icons are intentionally excluded.
  const lightSurfaces = async () => page.evaluate(() => {
    const bad: string[] = []
    const lightColors = new Set([
      'rgb(255, 255, 255)',
      'rgb(249, 250, 251)',
      'rgb(243, 244, 246)',
      'rgb(241, 245, 249)',
    ])
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height < 1200) continue
      if (lightColors.has(cs.backgroundColor)) {
        bad.push(`${el.tagName.toLowerCase()}.${el.className || '(no class)'} → ${cs.backgroundColor}`)
      }
    }
    return bad.slice(0, 20)
  })

  // ------------------------------------------------------------------ LOGIN
  await goto('/login')
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

  await page.locator('input[type="email"]').fill('alex@test.com')
  await page.locator('input[type="password"]').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/$/, { timeout: 15000 })

  // --------------------------------------------------------- SETTINGS THEME
  await goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible()
  await page.locator('[data-testid="theme-dark"]').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await settle()

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    return {
      body: body.backgroundColor,
      surface: root.getPropertyValue('--surface').trim(),
      surfaceAlt: root.getPropertyValue('--surface-alt').trim(),
      card: root.getPropertyValue('--card').trim(),
      accent: root.getPropertyValue('--accent').trim(),
      purple: root.getPropertyValue('--accent-2').trim(),
      gradient: root.getPropertyValue('--accent-gradient').trim(),
    }
  })
  console.log('   tokens:', JSON.stringify(tokens))
  expect(tokens.body).toBe('rgb(15, 23, 42)')
  expect(tokens.surface).toBe('#1e293b')
  expect(tokens.surfaceAlt).toBe('#1e293b')
  expect(tokens.card).toBe('rgba(30, 41, 59, 0.5)')
  expect(tokens.accent).toBe('#c084fc')
  expect(tokens.purple).toBe('#2563eb')
  expect(tokens.gradient).toContain('linear-gradient')

  const themeButtonBg = await page.locator('[data-testid="theme-dark"]')
    .evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(themeButtonBg).toContain('linear-gradient')
  const inputBg = await page.locator('#reset-email')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(inputBg).toBe('rgb(30, 41, 59)')
  expect(await lightSurfaces()).toEqual([])
  await shot('01-settings-dark')

  // ---------------------------------------------------------- HOME / ROOT
  await goto('/')
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(0)
  const headerBg = await page.locator('.portal-header')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const drawerBg = await page.getByTestId('nav-drawer')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(headerBg).toBe('rgb(15, 23, 42)')
  expect(drawerBg).toBe('rgb(15, 23, 42)')

  await page.getByTestId('menu-toggle').click()
  const selectedNav = page.locator('.portal-drawer .dashboard-nav-link.selected').first()
  const selectedBg = await selectedNav.evaluate((el) => getComputedStyle(el).backgroundColor)
  const selectedColor = await selectedNav.evaluate((el) => getComputedStyle(el).color)
  console.log(`   header=${headerBg} | selected nav=${selectedBg} / ${selectedColor}`)
  expect(selectedBg).toBe('rgba(147, 51, 234, 0.2)')
  expect(selectedColor).toBe('rgb(216, 180, 254)')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-drawer')).toBeHidden()

  const cardBg = await page.locator('.home-shortcut-card').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(cardBg).toBe('rgba(30, 41, 59, 0.5)')
  expect(await lightSurfaces()).toEqual([])
  await shot('02-home-dark')

  // --------------------------------------------------------------- DASHBOARD
  await goto('/dashboard')
  await expect(page.locator('.dashboard-shell')).toBeVisible()
  const heroBg = await page.locator('.dashboard-welcome')
    .evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(heroBg).toContain('linear-gradient')
  expect(await lightSurfaces()).toEqual([])
  await shot('03-dashboard-dark')

  // ---------------------------------------------------------------- PROJECTS
  await goto('/projects')
  await expect(page.locator('table th').first()).toBeVisible()
  const tableHeaderBg = await page.locator('table th').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(tableHeaderBg).toBe('rgb(30, 41, 59)')
  expect(await lightSurfaces()).toEqual([])
  await shot('04-projects-dark')

  // ----------------------------------------------------------- CREATE / AI
  await goto('/create-project')
  await expect(page.locator('.ai-card')).toBeVisible()
  const aiBorder = await page.locator('.ai-card')
    .evaluate((el) => getComputedStyle(el).borderTopColor)
  console.log(`   AI card border=${aiBorder}`)
  expect(aiBorder).toContain('192, 132, 252')
  expect(await lightSurfaces()).toEqual([])
  await shot('05-create-project-dark')

  // -------------------------------------------------------- PROJECT WORKSPACE
  // The workspace must be one this junior is assigned to; a globally newest
  // project may now be owned by a different developer.
  const assigned = await firstAssignedProjectFor('alex@test.com')
  expect(assigned.id).toBeTruthy()
  await goto(`/projects/${assigned.id}`)
  await expect(page.getByRole('button', { name: /edit client/i })).toBeVisible()
  const activeTabColor = await page.locator('.portal-tab-btn.active').first()
    .evaluate((el) => getComputedStyle(el).color)
  expect(activeTabColor).toBe('rgb(192, 132, 252)')
  expect(await lightSurfaces()).toEqual([])
  await shot('06-project-workspace-dark')

  // -------------------------------------------------------------- LOGIN PAGE
  await goto('/login')
  await expect(page.locator('.auth-card')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const authCardBg = await page.locator('.auth-card')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(authCardBg).toBe('rgb(30, 41, 59)')
  expect(await lightSurfaces()).toEqual([])
  await shot('07-login-dark')

  // ------------------------------------- REDESIGNED ADMIN SURFACES (DARK)
  await goto('/login')
  await page.locator('input[type="email"]').fill('admin2@test.com')
  await page.locator('input[type="password"]').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/$/, { timeout: 20000 })

  const adminSurfaces: Array<[route: string, name: string, marker: string]> = [
    ['/financials', '08-financial-records-dark', '[data-testid="financial-records-readonly"]'],
    ['/clients', '09-client-records-dark', '[data-testid="client-readonly"]'],
    ['/admin', '10-user-management-dark', '[data-testid="pending-user-count"]'],
    ['/audit', '11-audit-trails-dark', '[data-testid="audit-readonly"]'],
  ]
  for (const [route, name, marker] of adminSurfaces) {
    await goto(route)
    await expect(page.locator(marker)).toBeVisible({ timeout: 30000 })
    expect(await lightSurfaces()).toEqual([])
    await shot(name)
  }

  expect(errors).toEqual([])
  console.log('🎉 DARK THEME PASSED — no light surfaces, no console errors')
})
