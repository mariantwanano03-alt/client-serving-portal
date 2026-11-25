import { test, expect } from '@playwright/test'
import { firstAssignedProjectFor, serviceClient } from './helpers/admin'

test('CLIENT EDIT TYPING: backspace and type work without reset or hook errors', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text())
  })

  const admin = serviceClient()
  // Use a project the signed-in junior is actually assigned to. The newest
  // project in the database may belong to another developer.
  const assigned = await firstAssignedProjectFor('alex@test.com')
  const originalName = assigned.client_name
  expect(assigned.id).toBeTruthy()
  expect(originalName).toBeTruthy()

  // ------------------------------------------------------------------ LOGIN
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('alex@test.com')
  await page.locator('input[type="password"]').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/dashboard|\/$/, { timeout: 15000 })

  await page.goto(`/projects/${assigned.id}`)
  await page.getByRole('button', { name: /edit client/i }).click()
  const input = page.locator('#client-company-name')
  await input.waitFor()
  await expect(input).toHaveValue(originalName)

  // ------------------------------------------------- REAL KEYBOARD EDITING
  await input.click()
  // Place the caret explicitly: a re-render from ambient profile loading can
  // otherwise leave it where the click landed, making Backspace hit the middle.
  await input.evaluate((el: HTMLInputElement) => {
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
  for (let i = 0; i < 3; i++) await input.press('Backspace')
  const afterBackspaces = await input.inputValue()
  expect(afterBackspaces).toBe(originalName.slice(0, -3))

  await input.pressSequentially('XYZ')
  const afterTyping = await input.inputValue()
  expect(afterTyping).toBe(`${originalName.slice(0, -3)}XYZ`)

  // Must NOT snap back to the database value while typing.
  await page.waitForTimeout(1500)
  await expect(input).toHaveValue(afterTyping)
  console.log(`✅ typing: "${originalName}" → backspace×3 → "${afterBackspaces}" → type "XYZ" → "${afterTyping}"`)

  // ---------------------------------------------------------- SAVE TO DB
  await page.getByRole('button', { name: /save client/i }).click()
  await expect(page.getByText('Client updated!')).toBeVisible({ timeout: 15000 })
  const { data: saved } = await admin.from('clients').select('name').eq('id', assigned.client_id).single()
  expect(saved?.name).toBe(afterTyping)
  console.log('✅ saved value confirmed in database')

  // Restore the original name so the test leaves no misleading data behind.
  await admin.from('clients').update({ name: originalName }).eq('id', assigned.client_id)

  expect(errors).toEqual([])
  console.log('✅ no React hook errors / console errors during typing')
})
