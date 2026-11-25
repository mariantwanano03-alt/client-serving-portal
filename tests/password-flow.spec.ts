import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SHOTS = path.resolve(process.cwd(), 'screenshots/guided-flow')
fs.mkdirSync(SHOTS, { recursive: true })

const ORIGINAL = 'Throwaway123!'
const CHANGED = 'Changed456!'
const EMAIL = `pwtest${Date.now()}@example.com`

function envFromFile() {
  const file = path.resolve(process.cwd(), '.env.local')
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) acc[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    return acc
  }, {})
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard|\/$/, { timeout: 20000 })
}

async function changePassword(page: import('@playwright/test').Page, from: string, to: string) {
  await page.goto('/settings')
  await page.getByPlaceholder('Enter your current password').fill(from)
  await page.getByPlaceholder('At least 6 characters').fill(to)
  await page.getByPlaceholder('Confirm new password').fill(to)
  await page.getByRole('button', { name: 'Change Password' }).click()
  await expect(page.getByText('Password updated successfully!')).toBeVisible({ timeout: 20000 })
}

test('PASSWORD FLOW: Supabase Auth login → change → login with new password → restore', async ({ browser }) => {
  test.setTimeout(240000)

  // Provision a throwaway CONFIRMED user (the project requires email confirmation,
  // so UI signup cannot complete without an inbox). All password actions below
  // still happen through the real browser UI.
  const env = envFromFile()
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: ORIGINAL,
    email_confirm: true,
  })
  expect(createError, createError?.message).toBeNull()
  expect(created?.user?.id).toBeTruthy()

  // New registrations are pending until a role is assigned. Activate this
  // throwaway fixture so the test exercises password changes, not pending gating.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', created.user!.id)
      .maybeSingle()
    if (profile) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const { error: activationError } = await admin
    .from('profiles')
    .update({ account_status: 'active', is_active: true })
    .eq('id', created.user!.id)
  expect(activationError).toBeNull()

  console.log(`✅ PASSWORD STEP 0: throwaway Supabase Auth user ready — ${EMAIL}`)

  const contextA = await browser.newContext()
  const page = await contextA.newPage()
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
    console.log(`📸 screenshot: screenshots/guided-flow/${name}.png`)
  }

  // ------------------------------------------------------------ LOGIN (UI)
  await login(page, EMAIL, ORIGINAL)
  console.log('✅ PASSWORD STEP 1: login with original password succeeded')
  await shot('12-password-login')

  // ------------------------------------------------------------ CHANGE (UI)
  await changePassword(page, ORIGINAL, CHANGED)
  console.log('✅ PASSWORD STEP 2: password changed through Supabase Auth UI')
  await shot('13-password-changed')
  await contextA.close()

  // ------------------------------------------- LOGIN WITH NEW PASSWORD (UI)
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await login(pageB, EMAIL, CHANGED)
  console.log('✅ PASSWORD STEP 3: login with NEW password succeeded')

  // ------------------------------------------------ RESTORE ORIGINAL (UI)
  await changePassword(pageB, CHANGED, ORIGINAL)
  console.log('✅ PASSWORD STEP 4: throwaway password restored')
  await contextB.close()

  // ------------------------------------- LOGIN WITH RESTORED PASSWORD (UI)
  const contextC = await browser.newContext()
  const pageC = await contextC.newPage()
  await login(pageC, EMAIL, ORIGINAL)
  console.log('✅ PASSWORD STEP 5: login with restored password succeeded')
  await contextC.close()

  // --------------------------------------------- RESET EMAIL REQUEST (UI)
  const contextD = await browser.newContext()
  const pageD = await contextD.newPage()
  await login(pageD, 'alex@test.com', 'test1234')
  await pageD.goto('/settings')
  await pageD.getByLabel('Email address').fill('alex@test.com')
  // Supabase mail delivery may be rate-limited in this hosted project, so prove
  // the UI actually calls Supabase Auth's recovery endpoint with the address.
  const recoverRequest = pageD.waitForRequest(
    (request) => request.url().includes('/auth/v1/recover') && request.method() === 'POST',
    { timeout: 20000 }
  )
  await pageD.getByRole('button', { name: /send reset email/i }).click()
  const request = await recoverRequest
  expect(request.postData() || '').toContain('alex@test.com')
  console.log('✅ PASSWORD STEP 6: reset request sent to Supabase Auth (/auth/v1/recover)')

  // Remove the throwaway account so no test credentials linger in the system.
  const throwawayId = created.user?.id
  if (throwawayId) await admin.auth.admin.deleteUser(throwawayId)
  console.log('✅ PASSWORD STEP 7: throwaway account deleted')

  console.log('\n🎉 PASSWORD FLOW PASSED — Supabase Auth only, no custom password storage')
})
