import { test, expect, type Page, type TestInfo } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  login,
  openMenu,
  shot,
  shotDir,
} from './helpers/admin'

const JUNIOR_EMAIL = 'alex@test.com'
const JUNIOR_PASSWORD = 'test1234'
const SENIOR_EMAIL = 'elena@test.com'
const SENIOR_PASSWORD = 'test1234'
const CLIENT_EMAIL = 'musainnocent456@gmail.com'
const CLIENT_PASSWORD = 'test1234'

const SHOTS = shotDir('portal-redesign')

function shotName(testInfo: TestInfo, name: string) {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `${name}-${project}.png`
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(300)
  await shot(page, SHOTS, shotName(testInfo, name))
}

test('HEADER/DRAWER: compact header and transient right-side navigation', async ({ page }, testInfo) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await expect(page).toHaveURL(/\/$/)

  const header = page.getByTestId('portal-header')
  const toggle = page.getByTestId('menu-toggle')
  const drawer = page.getByTestId('nav-drawer')
  const overlay = page.getByTestId('nav-overlay')

  await expect(header).toBeVisible()
  await expect(header).toContainText('Client Serving Portal')
  await expect(header).toContainText('by X Spark')
  await expect(header).toContainText('Welcome,')
  await expect(page.locator('.dashboard-avatar')).toBeVisible()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-label', 'Open navigation menu')

  // The permanent sidebar is gone and reserves no layout space.
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(0)
  const mainMargin = await page.locator('.dashboard-main')
    .evaluate((el) => getComputedStyle(el).marginLeft)
  expect(mainMargin).toBe('0px')
  await expect(drawer).toBeHidden()
  await expect(overlay).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await capture(page, testInfo, '01-home-header-closed')

  // ── Open: overlay, headings, icons, labels, close button, selected state ──
  await toggle.click()
  await expect(drawer).toBeVisible()
  await expect(overlay).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer).toContainText('WORKSPACE')
  await expect(drawer).toContainText('Client Serving Portal')
  await expect(drawer).toContainText('by X Spark')
  await expect(drawer).toContainText('Signed in as')
  await expect(drawer.getByRole('button', { name: 'Close navigation menu' })).toBeVisible()
  await expect(drawer.locator('a[href="/"]')).toHaveClass(/selected/)
  await expect(drawer.getByRole('link', { name: /Messages/ })).toBeVisible()

  const viewportWidth = page.viewportSize()?.width ?? 0
  // The drawer slides in with a CSS transform; wait for it to settle before
  // measuring instead of sampling a mid-transition bounding box.
  await expect.poll(async () => {
    const box = await drawer.boundingBox()
    return box ? box.x + box.width : Number.POSITIVE_INFINITY
  }, { message: 'drawer should finish sliding into the viewport' }).toBeLessThanOrEqual(viewportWidth + 1)
  const drawerBox = await drawer.boundingBox()
  expect(drawerBox).not.toBeNull()
  expect(drawerBox!.x).toBeGreaterThanOrEqual(viewportWidth - 360)
  await capture(page, testInfo, '02-drawer-open')

  // ── Close by Escape ───────────────────────────────────────────────────────
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(overlay).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // ── Close by outside click ────────────────────────────────────────────────
  await openMenu(page)
  await overlay.click({ position: { x: 10, y: 10 } })
  await expect(drawer).toBeHidden()

  // ── Close by button ───────────────────────────────────────────────────────
  await openMenu(page)
  await drawer.getByTestId('drawer-close').click()
  await expect(drawer).toBeHidden()

  // ── Close by navigation ───────────────────────────────────────────────────
  await openMenu(page)
  await drawer.getByRole('link', { name: 'My Assigned Projects', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(drawer).toBeHidden()
  await capture(page, testInfo, '03-projects-from-drawer')
})

test('HOME: default landing, X Spark branding and role-specific shortcuts', async ({ page }, testInfo) => {
  // Administrator: oversight-only shortcuts and governance navigation.
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('home-branding')).toContainText('ADMINISTRATOR OVERSIGHT')
  await expect(page.getByTestId('home-branding')).toContainText('Welcome to your workspace')
  await expect(page.getByTestId('home-about')).toContainText('About X Spark')
  await expect(page.getByTestId('home-about')).toContainText('Software Development and IT Infrastructure')
  await expect(page.getByTestId('home-role-label')).toHaveText('Administrator')
  await expect(page.getByTestId('admin-readonly-banner')).toBeVisible()
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('User Management')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Audit Trail')
  await expect(page.getByTestId('add-new-project')).toHaveCount(0)
  await openMenu(page)
  await expect(page.getByTestId('nav-drawer').getByRole('link', { name: 'User Management', exact: true })).toBeVisible()
  await expect(page.getByTestId('nav-drawer').getByRole('link', { name: 'Audit Trails', exact: true })).toBeVisible()
  await expect(page.getByTestId('messages-nav-link')).toHaveCount(0)
  await capture(page, testInfo, '04-home-admin')

  // Senior Developer / PM: delivery shortcuts, no governance links.
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home-role-label')).toHaveText('Senior Dev / PM')
  await expect(page.getByTestId('add-new-project')).toBeVisible()
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Discovery Meetings')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Messages')
  await expect(page.getByTestId('admin-readonly-banner')).toHaveCount(0)
  await openMenu(page)
  await expect(page.getByTestId('nav-drawer').getByRole('link', { name: 'User Management', exact: true })).toHaveCount(0)
  await capture(page, testInfo, '05-home-senior')

  // Junior Developer: assigned-work shortcuts, no governance links.
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home-role-label')).toHaveText('Junior Developer')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('My Assigned Projects')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Financial Records')
  await capture(page, testInfo, '06-home-junior')

  // Client: communication-first shortcuts only.
  await login(page, CLIENT_EMAIL, CLIENT_PASSWORD)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home-role-label')).toHaveText('Client')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Messages')
  await expect(page.getByTestId('workspace-shortcuts')).toContainText('Settings')
  await expect(page.getByTestId('workspace-shortcuts')).not.toContainText('User Management')
  await expect(page.getByTestId('add-new-project')).toHaveCount(0)
  await openMenu(page)
  await expect(page.getByTestId('messages-nav-link')).toBeVisible()
  await expect(page.getByTestId('nav-drawer').getByRole('link', { name: 'User Management', exact: true })).toHaveCount(0)
})

test('HOME: sign-in always lands on Home, not the last visited page', async ({ page }) => {
  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await page.goto('/projects')
  await expect(page).toHaveURL(/\/projects$/)

  await openMenu(page)
  await page.getByTestId('nav-drawer').getByRole('button', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/login$/)

  await login(page, SENIOR_EMAIL, SENIOR_PASSWORD)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('PALETTE: Purple Bee tokens are consistent in light and dark modes', async ({ page }, testInfo) => {
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)

  // ── Light ──────────────────────────────────────────────────────────────────
  await page.goto('/settings')
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.goto('/')
  await expect(page.getByTestId('home-page')).toBeVisible()

  const light = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    const header = document.querySelector('.portal-header')
    const card = document.querySelector('.home-shortcut-card')
    return {
      background: root.getPropertyValue('--background').trim(),
      surface: root.getPropertyValue('--surface').trim(),
      accent: root.getPropertyValue('--accent').trim(),
      bodyBackground: body.backgroundColor,
      headerBackground: header ? getComputedStyle(header).backgroundColor : '',
      cardBackground: card ? getComputedStyle(card).backgroundColor : '',
    }
  })
  expect(light.background).toBe('#f9fafb')
  expect(light.surface).toBe('#ffffff')
  expect(light.accent).toBe('#9333ea')
  expect(light.bodyBackground).toBe('rgb(249, 250, 251)')
  expect(light.headerBackground).toBe('rgb(255, 255, 255)')
  expect(light.cardBackground).toBe('rgb(255, 255, 255)')

  const lightGradient = await page.getByTestId('add-new-project')
    .evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(lightGradient).toContain('rgb(147, 51, 234)')
  expect(lightGradient).toContain('rgb(37, 99, 235)')
  await capture(page, testInfo, '07-home-light')

  // ── Dark ───────────────────────────────────────────────────────────────────
  await page.goto('/settings')
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.goto('/')
  await expect(page.getByTestId('home-page')).toBeVisible()

  const dark = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    const header = document.querySelector('.portal-header')
    const card = document.querySelector('.home-shortcut-card')
    return {
      background: root.getPropertyValue('--background').trim(),
      surface: root.getPropertyValue('--surface').trim(),
      accent: root.getPropertyValue('--accent').trim(),
      bodyBackground: body.backgroundColor,
      headerBackground: header ? getComputedStyle(header).backgroundColor : '',
      cardBackground: card ? getComputedStyle(card).backgroundColor : '',
    }
  })
  expect(dark.background).toBe('#0f172a')
  expect(dark.surface).toBe('#1e293b')
  expect(dark.accent).toBe('#c084fc')
  expect(dark.bodyBackground).toBe('rgb(15, 23, 42)')
  expect(dark.headerBackground).toBe('rgb(15, 23, 42)')
  expect(dark.cardBackground).toBe('rgba(30, 41, 59, 0.5)')
  await capture(page, testInfo, '08-home-dark')
})

test('ADMIN PAGES: Client Records and Financial Records keep the shared palette', async ({ page }, testInfo) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page.getByTestId('portal-header')).toBeVisible()

  await openMenu(page)
  await page.getByTestId('nav-drawer').getByRole('link', { name: 'Clients', exact: true }).click()
  await expect(page.getByTestId('client-readonly')).toBeVisible()
  await expect(page.getByTestId('portal-header')).toBeVisible()
  await capture(page, testInfo, '09-client-records')

  await openMenu(page)
  await page.getByTestId('nav-drawer').getByRole('link', { name: 'Financial Records', exact: true }).click()
  await expect(page.getByTestId('financial-records-readonly')).toBeVisible()
  await expect(page.getByTestId('portal-header')).toBeVisible()
  await capture(page, testInfo, '10-financial-records')
})

test('MOBILE: compact header and drawer fit a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await expect(page).toHaveURL(/\/$/)

  await expect(page.getByTestId('portal-header')).toBeVisible()
  await expect(page.getByTestId('menu-toggle')).toBeVisible()
  await expect(page.locator('.portal-welcome')).toBeHidden()
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(0)

  const closedOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(closedOverflow).toBeLessThanOrEqual(1)
  await capture(page, testInfo, '11-mobile-home')

  await openMenu(page)
  const drawerBox = await page.getByTestId('nav-drawer').boundingBox()
  expect(drawerBox).not.toBeNull()
  expect(drawerBox!.x).toBeGreaterThanOrEqual(0)
  expect(drawerBox!.width).toBeLessThanOrEqual(390 * 0.92 + 1)
  await capture(page, testInfo, '12-mobile-drawer')

  await page.getByTestId('drawer-close').click()
  await expect(page.getByTestId('nav-drawer')).toBeHidden()
})
