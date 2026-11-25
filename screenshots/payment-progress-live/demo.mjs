import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'screenshots/payment-progress-live')
const VIDEO_DIR = path.join(OUT, 'video')
fs.mkdirSync(VIDEO_DIR, { recursive: true })

const PROJECT_ID = 'b594e3d7-532f-4fe2-b26c-67dee768c691'

const log = (message) => console.log(`[LIVE] ${message}`)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  slowMo: 350,
})

const context = await browser.newContext({
  ...devices['Pixel 5'],
})
const page = await context.newPage()

page.on('console', (message) => log(`browser console: ${message.type()}: ${message.text()}`))
page.on('pageerror', (error) => log(`browser pageerror: ${error.message}`))

let step = 0
async function capture(name) {
  step += 1
  const file = path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  log(`screenshot: ${file}`)
}
async function press(action) {
  log(`PRESS/ACTION: ${action}`)
}

try {
  await press('open http://localhost:3000/login')
  await page.goto('http://localhost:3000/login')
  await page.waitForLoadState('domcontentloaded')
  await capture('login-page')

  await press('fill #email-input with elena@test.com')
  await page.locator('#email-input').fill('elena@test.com')
  await press('fill #password-input with test1234')
  await page.locator('#password-input').fill('test1234')
  await capture('credentials-filled')

  await press('click the Sign in button')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 })
  await capture('signed-in-dashboard')

  await press(`navigate to /projects/${PROJECT_ID}?tab=financials`)
  await page.goto(`http://localhost:3000/projects/${PROJECT_ID}?tab=financials`)
  await page.getByTestId('financial-overview').waitFor({ timeout: 30_000 })
  await capture('financial-overview-loaded')

  await press('click the Clients tab')
  await page.getByRole('button', { name: 'Clients' }).click()
  await capture('clients-tab')

  await press('click the Financials tab')
  await page.getByRole('button', { name: 'Financials' }).click()
  await page.getByTestId('financial-overview').waitFor({ timeout: 30_000 })
  await capture('financials-tab-clicked')

  await press('read the progressbar aria-valuenow and percentage text')
  const percent = await page.getByTestId('financial-progress').getAttribute('aria-valuenow')
  const percentText = await page.getByTestId('financial-percentage').textContent()
  log(`progressbar aria-valuenow=${percent}; visible text=${percentText}`)

  await press('scroll to payment history')
  await page.getByTestId('payment-history').scrollIntoViewIfNeeded()
  await capture('payment-history')

  await press('click the Refresh button')
  await page.getByTestId('financials-refresh').click()
  await page.getByTestId('financials-loading').waitFor({ state: 'hidden', timeout: 30_000 })
  await capture('after-refresh')

  await press('open /settings and click theme-dark')
  await page.goto('http://localhost:3000/settings')
  await page.getByTestId('theme-dark').click()
  await capture('settings-dark-selected')

  await press(`navigate back to /projects/${PROJECT_ID}?tab=financials in dark mode`)
  await page.goto(`http://localhost:3000/projects/${PROJECT_ID}?tab=financials`)
  await page.getByTestId('financial-overview').waitFor({ timeout: 30_000 })
  await capture('financial-overview-dark')

  await press('open /settings and restore theme-light')
  await page.goto('http://localhost:3000/settings')
  await page.getByTestId('theme-light').click()
  await capture('settings-light-restored')

  log('LIVE DEMO COMPLETE')
} finally {
  await context.close()
  await browser.close()
}
