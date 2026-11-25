import { expect, test } from '@playwright/test'
import { login, openMenu, serviceClient, shot, shotDir, signInWithPassword } from './helpers/admin'

// Separate visible website walkthrough. This is not a targeted test: it opens
// a real headed Chrome window and captures the complete user-facing path.
test.use({ headless: false })
test.skip(({ browserName }) => browserName !== 'chromium')
test.setTimeout(300000)

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PASSWORD = 'test1234'
const JUNIOR_EMAIL = 'alex@test.com'
const WALKTHROUGH_SHOTS = shotDir('visible-walkthrough')

type Json = Record<string, unknown>

async function api(token: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json: Json = {}
  try {
    json = text ? (JSON.parse(text) as Json) : {}
  } catch {
    json = {}
  }
  return { status: response.status, json }
}

function nestedString(value: unknown, ...keys: string[]): string {
  let current: unknown = value
  for (const key of keys) {
    current = current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
  }
  return typeof current === 'string' ? current : ''
}

test('Visible headed walkthrough — home, drawer, readiness and central document generation', async ({ page }) => {
  const service = serviceClient()
  const junior = await signInWithPassword(JUNIOR_EMAIL, PASSWORD)
  const { data: clientRow } = await service.from('clients').select('id, name').limit(1).maybeSingle()
  expect(clientRow?.id).toBeTruthy()

  const projectName = `Visible Walkthrough ${new Date().toISOString().replace(/[^0-9]/g, '').slice(-10)}`
  const created = await api(junior.accessToken, '/api/projects', 'POST', {
    client_id: clientRow?.id,
    name: projectName,
    description: 'Created for the separate visible website walkthrough.',
  })
  expect([200, 201]).toContain(created.status)
  const projectId = nestedString(created.json, 'id') || nestedString(created.json, 'project', 'id') || nestedString(created.json, 'data', 'id')
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/i)

  // 1. Home after login — no permanent sidebar.
  await login(page, JUNIOR_EMAIL, PASSWORD)
  await expect(page.getByTestId('portal-header')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(/Welcome,/)).toBeVisible()
  await shot(page, WALKTHROUGH_SHOTS, '01-home-after-login.png')

  // 2. Transient right drawer with role-specific navigation.
  await openMenu(page)
  await expect(page.getByTestId('nav-drawer')).toBeVisible()
  await expect(page.getByTestId('nav-drawer')).toContainText('Projects')
  await expect(page.getByTestId('nav-drawer')).toContainText('Settings')
  await shot(page, WALKTHROUGH_SHOTS, '02-navigation-drawer.png')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-drawer')).toBeHidden()

  // 3. Readiness panel shows the locked state and required wording.
  await page.goto(`/projects/${projectId}`)
  await expect(page.getByTestId('development-readiness-panel')).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('development-status')).toContainText('Development: Locked')
  await expect(page.getByTestId('sla-status')).toContainText('SLA Awaiting Client Signature.')
  await expect(page.getByTestId('client-agreement-status')).toContainText('Client Approved & Agreed to Terms: ✗')
  await expect(page.getByTestId('readiness-prerequisites')).toContainText('SLA signed by client')
  await shot(page, WALKTHROUGH_SHOTS, '03-development-readiness-locked.png')

  // 4. Exactly one central generation button on the Documents tab.
  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(page.getByTestId('generate-document-button')).toHaveCount(1)
  await shot(page, WALKTHROUGH_SHOTS, '04-documents-central-button.png')

  // 5. Type selection opens first; the SLA form opens only after Continue.
  await page.getByTestId('generate-document-button').click()
  await expect(page.getByTestId('generate-modal')).toBeVisible()
  await expect(page.getByTestId('generate-type-SLA')).toBeVisible()
  await expect(page.getByTestId('generation-field-service_terms')).toHaveCount(0)
  await shot(page, WALKTHROUGH_SHOTS, '05-generate-type-selection.png')

  await page.getByTestId('generate-type-SLA').click()
  await page.getByTestId('generate-continue').click()
  await expect(page.getByTestId('generation-field-service_terms')).toBeVisible()
  await shot(page, WALKTHROUGH_SHOTS, '06-sla-specific-form.png')

  // 6. Type-specific validation blocks an incomplete draft.
  await page.getByTestId('generate-submit').click()
  const validationError = page.getByTestId('generation-error')
  await expect(validationError).toContainText('Service terms is required.')
  // The modal scrolls to the submit button; bring the alert back into view so
  // the screenshot visibly proves the type-specific validation message.
  await validationError.scrollIntoViewIfNeeded()
  await shot(page, WALKTHROUGH_SHOTS, '07-sla-validation.png')

  // 7. Real project data is used and the saved result is an editable draft.
  await page.getByTestId('generation-field-service_terms').fill('The supplier will maintain the portal and respond to agreed support requests.')
  await page.getByTestId('generation-field-responsibilities').fill('The client will provide timely access, decisions and approved content.')
  await page.getByTestId('generation-field-support_hours').fill('Monday to Friday, 09:00–17:00')
  await page.getByTestId('generate-submit').click()
  await expect(page.getByTestId('documents-message')).toContainText('created as a draft', { timeout: 20000 })
  await expect(page.getByTestId('generate-modal')).toHaveCount(0)

  const { data: generatedDocument } = await service
    .from('documents')
    .select('id, title, type, status')
    .eq('project_id', projectId)
    .eq('type', 'SLA')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  expect(generatedDocument?.status).toBe('draft')

  const row = page.locator('table tbody tr').filter({ hasText: String(generatedDocument?.title) }).first()
  await expect(row).toBeVisible()
  await expect(row.getByTestId('document-status')).toHaveText('Draft')
  await shot(page, WALKTHROUGH_SHOTS, '08-generated-sla-draft.png')

  await row.getByTestId('open-document').click()
  await expect(page.getByTestId('document-editor')).toBeVisible()
  await expect(page.getByTestId('document-content')).toContainText(projectName)
  await expect(page.getByTestId('document-content')).toContainText(String(clientRow?.name))
  await shot(page, WALKTHROUGH_SHOTS, '09-editable-draft-with-real-data.png')

  console.log('VISIBLE WALKTHROUGH PASSED — screenshots:', WALKTHROUGH_SHOTS)
})
