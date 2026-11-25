import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  callerClient,
  login,
  openMenu,
  serviceClient,
  shot,
  shotDir,
  signInWithPassword,
} from './helpers/admin'

test.use({ headless: false })
// This single test walks every role and every major workflow. The project-wide
// 90s limit expires before the later review/permission steps finish.
test.setTimeout(600000)

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const SHOTS = shotDir('master-workflow')
const PASSWORD = 'test1234'
const JUNIOR_EMAIL = 'alex@test.com'
const SENIOR_EMAIL = 'elena@test.com'
const CLIENT_EMAIL = 'musainnocent456@gmail.com'
const TOKEN = new Date().toISOString().replace(/[^0-9]/g, '').slice(-10)
const DRAFT_TITLE = `Workflow Proposal ${TOKEN}`
const REJECTION_REASON = `Please add a delivery timeline before approval (${TOKEN}).`

type Json = Record<string, unknown>

type ApiResult = {
  status: number
  json: Json
  text: string
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

type Monitor = {
  phase: string
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: string[]
  abortedRequests: string[]
  httpFailures: string[]
  unexpected: string[]
  expectedDenials: string[]
}

const monitor: Monitor = {
  phase: 'setup',
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  abortedRequests: [],
  httpFailures: [],
  unexpected: [],
  expectedDenials: [],
}

function watchPage(page: Page) {
  const starts = new Map<unknown, number>()
  page.on('request', (request) => starts.set(request, Date.now()))
  page.on('pageerror', (error) => {
    monitor.pageErrors.push(`[${monitor.phase}] PAGEERROR ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      monitor.consoleErrors.push(
        `[${monitor.phase}] CONSOLE ${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`
      )
    }
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown failure'
    const line = `[${monitor.phase}] REQUEST ${request.method()} ${request.url()} — ${failure}`
    // Route replacements and sign-outs cancel in-flight requests by design.
    // Keep them visible in the report, but do not call them application errors.
    if (/ERR_ABORTED/i.test(failure)) {
      monitor.abortedRequests.push(line)
    } else {
      monitor.requestFailures.push(line)
      monitor.unexpected.push(line)
    }
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const pathname = new URL(response.url()).pathname
    const duration = Date.now() - (starts.get(response.request()) ?? Date.now())
    const line = `[${monitor.phase}] HTTP ${response.status()} ${response.request().method()} ${pathname} (+${duration}ms, page=${page.url()})`
    monitor.httpFailures.push(line)
    // Next.js HMR and favicon misses are browser plumbing, not app errors.
    if (!pathname.startsWith('/_next/') && pathname !== '/favicon.ico') {
      monitor.unexpected.push(line)
    }
  })
}

async function step<T>(name: string, filename: string, action: () => Promise<T>): Promise<T> {
  monitor.phase = name
  console.log(`\n=== ${name} ===`)
  try {
    const result = await action()
    await shot(pageForTests, SHOTS, filename)
    return result
  } catch (error) {
    const failName = `FAIL-${filename.replace(/\.png$/i, '')}.png`
    try {
      await pageForTests.screenshot({ path: path.join(SHOTS, failName), fullPage: true })
      console.log(`📸 failure screenshot: screenshots/master-workflow/${failName}`)
    } catch {
      // The browser may already be closed; the original error is more useful.
    }
    console.error(`❌ ${name} failed:`, error)
    throw error
  }
}

let pageForTests: Page

async function api(
  accessToken: string,
  pathname: string,
  method = 'GET',
  body?: unknown
): Promise<ApiResult> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json: Json = {}
  try {
    json = (JSON.parse(text) as Json) || {}
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: response.status, json, text }
}

async function expectDenied(
  label: string,
  accessToken: string,
  pathname: string,
  method = 'GET',
  body?: unknown
) {
  const result = await api(accessToken, pathname, method, body)
  monitor.expectedDenials.push(
    `${label}: ${method} ${pathname} → ${result.status}${result.json.error ? ` (${String(result.json.error)})` : ''}`
  )
  expect(result.status, `${label} must be denied`).toBe(403)
  return result
}

async function profileFor(email: string) {
  const { data, error } = await serviceClient()
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('email', email)
    .single()
  if (error || !data) throw new Error(`Could not load profile ${email}: ${error?.message}`)
  return data as { id: string; full_name: string; email: string | null; role: string }
}

async function openProjectsList(page: Page) {
  await openMenu(page)
  await page.locator('.dashboard-nav a[href="/projects"]').click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
}

async function openProjectByReference(page: Page, projectReference: string) {
  await openProjectsList(page)
  const row = page.locator('table tbody tr').filter({ hasText: projectReference }).first()
  await expect(row).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/i)
}

async function switchUser(page: Page, email: string, password = PASSWORD) {
  // The document editor is a modal overlay; close it before using the header.
  const editor = page.getByTestId('document-editor')
  if (await editor.isVisible()) {
    await editor.getByRole('button', { name: 'Close' }).click()
    await expect(editor).toHaveCount(0)
  }
  await openMenu(page)
  await page.locator('.dashboard-signout').click()
  await page.waitForURL(/\/login$/, { timeout: 20000 })
  await login(page, email, password)
  await expect(page.getByTestId('portal-header')).toBeVisible()
}

async function openDraft(page: Page, title: string) {
  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  const row = page.locator('table tbody tr').filter({ hasText: title }).first()
  await expect(row).toBeVisible()
  await row.getByTestId('open-document').click()
  await expect(page.getByTestId('document-editor')).toBeVisible()
}

test('Visible master workflow — assignment, documents, review, permissions and audit', async ({ page }) => {
  pageForTests = page
  watchPage(page)
  const service = serviceClient()
  const juniorProfile = await profileFor(JUNIOR_EMAIL)
  const seniorProfile = await profileFor(SENIOR_EMAIL)
  const juniorName = juniorProfile.full_name.split(/\s+/)[0]
  const seniorName = seniorProfile.full_name.split(/\s+/)[0]

  // ---------------------------------------------------------------- JUNIOR CREATE
  const created = await step('Junior creates a project from an existing client', '01-junior-login.png', async () => {
    await login(page, JUNIOR_EMAIL, PASSWORD)
    // The drawer contains the same first name but stays hidden until opened;
    // assert the visible home greeting instead of the first DOM match.
    await expect(page.getByText(`Hello ${juniorProfile.full_name}.`, { exact: false })).toBeVisible()
    await page.goto('/create-project')
    await expect(page.getByTestId('wizard-steps')).toBeVisible()

    await page.getByLabel(/use an existing client instead/i).check()
    const clientSelect = page.locator('select').first()
    await expect(clientSelect).toBeVisible()
    await clientSelect.selectOption({ index: 1 })
    const selectedClientId = await clientSelect.inputValue()
    expect(selectedClientId).toBeTruthy()

    await page.getByTestId('continue-to-review').click()
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/i, { timeout: 30000 })
    const projectId = new URL(page.url()).pathname.split('/').pop() || ''
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/i)

    const { data: project, error } = await service
      .from('projects')
      .select('id, name, project_reference, client_id')
      .eq('id', projectId)
      .single()
    expect(error).toBeNull()
    expect(project?.client_id).toBe(selectedClientId)
    await expect(page.getByRole('heading', { name: project?.name || '' })).toBeVisible()

    const { data: assignment, error: assignmentError } = await service
      .from('assignments')
      .select('developer_user_id, assignment_role, approval_authority, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single()
    expect(assignmentError).toBeNull()
    expect(assignment?.developer_user_id).toBe(juniorProfile.id)
    expect(assignment?.assignment_role).toBe('developer')
    expect(assignment?.approval_authority).toBe(false)

    return { projectId, projectReference: project?.project_reference || '', projectName: project?.name || '' }
  })

  const { projectId, projectReference, projectName } = created

  // -------------------------------------------------------------- JUNIOR DOCUMENT
  const documentId = await step('Junior drafts, edits and submits a document', '02-junior-draft-submitted.png', async () => {
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    await expect(page.getByTestId('draft-document-button')).toHaveCount(1)
    await page.getByTestId('draft-document-button').click()
    await expect(page.getByTestId('draft-modal')).toBeVisible()
    await page.getByTestId('draft-type-select').selectOption('Proposal')
    await page.getByTestId('draft-title-input').fill(DRAFT_TITLE)
    await page.getByTestId('create-draft-submit').click()

    await expect(page.getByTestId('document-editor')).toBeVisible()
    const content = page.getByTestId('document-content')
    await expect(content).toBeEnabled()
    await content.fill('Initial proposal content prepared by the junior developer.')
    await page.getByTestId('save-document').click()
    await expect(page.getByTestId('documents-message')).toContainText('saved')

    await page.getByTestId('submit-review').click()
    await expect(page.getByTestId('document-editor')).toContainText('Pending Review')
    await expect(page.getByTestId('approve-document')).toHaveCount(0)
    await expect(page.getByTestId('reject-document')).toHaveCount(0)

    const { data, error } = await service
      .from('documents')
      .select('id, status, title')
      .eq('project_id', projectId)
      .eq('title', DRAFT_TITLE)
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('pending_review')
    return data?.id || ''
  })
  expect(documentId).toBeTruthy()

  await step('Junior approval and unrelated-project bypasses are denied', '03-junior-denied.png', async () => {
    const junior = await signInWithPassword(JUNIOR_EMAIL, PASSWORD)
    await expectDenied(
      'Junior approving own document',
      junior.accessToken,
      `/api/documents/${documentId}/approve`,
      'POST',
      { decision: 'approved' }
    )

    const senior = await signInWithPassword(SENIOR_EMAIL, PASSWORD)
    const { data: clientRow, error: clientError } = await service
      .from('clients')
      .select('id')
      .limit(1)
      .single()
    expect(clientError).toBeNull()
    const clientId = String(clientRow?.id || '')
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/i)
    const otherProject = await api(senior.accessToken, '/api/projects', 'POST', {
      client_id: clientId,
      name: `Unassigned Project ${TOKEN}`,
      description: 'Created only to verify another-project access denial.',
    })
    expect([200, 201]).toContain(otherProject.status)
    const otherProjectId = nestedString(otherProject.json, 'id') || nestedString(otherProject.json, 'data', 'id')
    expect(otherProjectId).toMatch(/^[0-9a-f-]{36}$/i)
    const otherDocument = await api(senior.accessToken, '/api/documents', 'POST', {
      project_id: otherProjectId,
      type: 'Proposal',
      title: `Other Project Document ${TOKEN}`,
    })
    expect(otherDocument.status).toBe(200)
    await expectDenied(
      'Junior reading another project document',
      junior.accessToken,
      `/api/documents/${nestedString(otherDocument.json, 'document', 'id')}`
    )

    const asJunior = callerClient(junior.accessToken)
    const { data: visibleProjects } = await asJunior
      .from('projects')
      .select('id')
      .eq('id', otherProjectId)
    expect(visibleProjects?.length || 0).toBe(0)

    await page.goto(`/projects/${otherProjectId}`)
    await expect(page.getByText('Project not found.')).toBeVisible({ timeout: 20000 })
    await page.goto(`/projects/${projectId}?tab=documents`)
  })

  // ------------------------------------------------------------ ADMIN REASSIGN #1
  await step('Administrator reassigns the developer to the senior', '04-admin-reassign-senior.png', async () => {
    await switchUser(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await openProjectByReference(page, projectReference)
    await expect(page.getByTestId('project-readonly')).toBeVisible()
    await expect(page.getByTestId('admin-developer-assignment')).toBeVisible()
    await expect(page.getByTestId('admin-developer-assignment')).toContainText(juniorName)

    await page.getByTestId('developer-select').selectOption(seniorProfile.id)
    await page.getByTestId('change-developer').click()
    await expect(page.getByTestId('assignment-message')).toContainText('assigned to')
    await expect(page.getByTestId('admin-developer-assignment')).toContainText(seniorName)

    const { data, error } = await service
      .from('assignments')
      .select('developer_user_id, assignment_role, approval_authority, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single()
    expect(error).toBeNull()
    expect(data?.developer_user_id).toBe(seniorProfile.id)
    expect(data?.assignment_role).toBe('lead')
    expect(data?.approval_authority).toBe(true)

    const admin = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
    const junior = await signInWithPassword(JUNIOR_EMAIL, PASSWORD)
    await expectDenied(
      'Administrator approving a document',
      admin.accessToken,
      `/api/documents/${documentId}/approve`,
      'POST',
      { decision: 'approved' }
    )
    await expectDenied(
      'Administrator creating a document',
      admin.accessToken,
      '/api/documents',
      'POST',
      { project_id: projectId, type: 'Proposal', title: 'Forbidden Admin Draft' }
    )
    await expectDenied('Junior loses access after reassignment', junior.accessToken, `/api/documents/${documentId}`)
  })

  await step('Administrator audit trail is human-readable', '05-admin-audit.png', async () => {
    await openMenu(page)
    await page.locator('.dashboard-nav a[href="/audit"]').click()
    await expect(page.getByRole('heading', { name: 'Audit Trails', exact: true })).toBeVisible()
    const row = page
      .getByTestId('audit-row')
      .filter({ hasText: 'Developer assigned' })
      .filter({ hasText: projectName })
      .first()
    await expect(row).toBeVisible({ timeout: 20000 })
    const text = await row.innerText()
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(text).not.toContain('developer_user_id')
    expect(text).not.toContain('{')
  })

  // -------------------------------------------------------------- SENIOR REJECT
  await step('Senior rejects with a visible reason', '06-senior-rejected.png', async () => {
    await switchUser(page, SENIOR_EMAIL, PASSWORD)
    await openProjectByReference(page, projectReference)
    await openDraft(page, DRAFT_TITLE)
    await page.getByTestId('rejection-reason').fill(REJECTION_REASON)
    await page.getByTestId('reject-document').click()
    await expect(page.getByTestId('documents-message')).toContainText('rejected')
    await expect(page.getByTestId('document-editor')).toContainText('Rejected')

    const { data, error } = await service.from('documents').select('status').eq('id', documentId).single()
    expect(error).toBeNull()
    expect(data?.status).toBe('rejected')
  })

  // ------------------------------------------------------------ ADMIN REASSIGN #2
  await step('Administrator returns the project to the junior', '07-admin-reassign-junior.png', async () => {
    await switchUser(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`/projects/${projectId}`)
    await expect(page.getByTestId('admin-developer-assignment')).toBeVisible()
    await page.getByTestId('developer-select').selectOption(juniorProfile.id)
    await page.getByTestId('change-developer').click()
    await expect(page.getByTestId('assignment-message')).toContainText('assigned to')
    const { data } = await service
      .from('assignments')
      .select('developer_user_id, approval_authority')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single()
    expect(data?.developer_user_id).toBe(juniorProfile.id)
    expect(data?.approval_authority).toBe(false)
  })

  // -------------------------------------------------------- JUNIOR SEES REJECTION
  await step('Junior sees the reason, revises and resubmits', '08-junior-resubmitted.png', async () => {
    await switchUser(page, JUNIOR_EMAIL, PASSWORD)
    await page.goto(`/projects/${projectId}?tab=documents`)
    await openDraft(page, DRAFT_TITLE)
    await expect(page.getByTestId('rejection-reason-display')).toContainText('Please add a delivery timeline')
    await page.getByTestId('document-content').fill(
      'Initial proposal content prepared by the junior developer. Revised delivery timeline: two weeks after approval.'
    )
    await page.getByTestId('save-document').click()
    await expect(page.getByTestId('documents-message')).toContainText('saved')
    await page.getByTestId('submit-review').click()
    await expect(page.getByTestId('document-editor')).toContainText('Pending Review')
  })

  // ------------------------------------------------------------ ADMIN REASSIGN #3
  await step('Administrator gives approval authority back to the senior', '09-admin-reassign-approver.png', async () => {
    await switchUser(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`/projects/${projectId}`)
    await expect(page.getByTestId('admin-developer-assignment')).toBeVisible()
    await page.getByTestId('developer-select').selectOption(seniorProfile.id)
    await page.getByTestId('change-developer').click()
    await expect(page.getByTestId('assignment-message')).toContainText('assigned to')
    const { data } = await service
      .from('assignments')
      .select('developer_user_id, approval_authority')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single()
    expect(data?.developer_user_id).toBe(seniorProfile.id)
    expect(data?.approval_authority).toBe(true)
  })

  // ------------------------------------------------------------- SENIOR APPROVAL
  await step('Senior approves and downloads a real PDF', '10-senior-approved.png', async () => {
    await switchUser(page, SENIOR_EMAIL, PASSWORD)
    await page.goto(`/projects/${projectId}?tab=documents`)
    await openDraft(page, DRAFT_TITLE)
    await expect(page.getByTestId('approve-document')).toBeVisible()
    await page.getByTestId('approve-document').click()
    await expect(page.getByTestId('documents-message')).toContainText('approved')
    await expect(page.getByTestId('document-editor')).toContainText('Approved')

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('download-pdf').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
    const downloadPath = await download.path()
    const pdf = downloadPath ? await import('node:fs').then((fs) => fs.readFileSync(downloadPath)) : Buffer.alloc(0)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

    const { data: revisions } = await service
      .from('document_revisions')
      .select('revision_no, content, status')
      .eq('document_id', documentId)
      .order('revision_no', { ascending: false })
    expect(revisions?.[0]?.content).toContain('Revised delivery timeline')
    expect(revisions?.[0]?.status).toBe('approved')
  })

  // --------------------------------------------------------------- SENIOR UPLOAD
  await step('Senior uploads a real document and it enters review', '11-senior-uploaded.png', async () => {
    const uploadTitle = `Workflow Upload ${TOKEN}`
    await page.getByTestId('document-editor').getByRole('button', { name: 'Close' }).click()
    await page.getByTestId('upload-document-button').click()
    await expect(page.getByTestId('upload-modal')).toBeVisible()
    await page.getByTestId('upload-type-select').selectOption('Requirements')
    await page.getByTestId('upload-title-input').fill(uploadTitle)
    await page.getByTestId('upload-file-input').setInputFiles({
      name: 'workflow-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Uploaded project requirements for workflow verification.'),
    })
    await page.getByTestId('upload-submit').click()
    await expect(page.getByTestId('upload-modal')).toHaveCount(0)
    await expect(page.getByTestId('documents-message')).toContainText('uploaded')

    const row = page.locator('table tbody tr').filter({ hasText: uploadTitle }).first()
    await expect(row.getByTestId('document-status')).toHaveText('Pending Review')
    const { data, error } = await service
      .from('documents')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('title', uploadTitle)
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('pending_review')
  })

  // ------------------------------------------------------------------- FINANCIALS
  await step('Financial records stay visible and source-backed', '12-financial-records.png', async () => {
    await openMenu(page)
    await page.locator('.dashboard-nav a[href="/financials"]').click()
    await expect(page.getByRole('heading', { name: 'Financial Records', exact: true })).toBeVisible()
    await expect(page.getByTestId('financial-records-summary')).toBeVisible()
    await expect(page.getByTestId('financial-records-error')).toHaveCount(0)
  })

  // ---------------------------------------------------------------- CLIENT LIMITS
  await step('Client is confined to client-facing areas', '13-client-restricted.png', async () => {
    await switchUser(page, CLIENT_EMAIL, PASSWORD)
    await expect(page.getByTestId('portal-header')).toBeVisible()
    await openMenu(page)
    const internalLinks = page.locator(
      '.dashboard-nav a[href="/admin"], .dashboard-nav a[href="/audit"], .dashboard-nav a[href="/projects"], .dashboard-nav a[href="/clients"], .dashboard-nav a[href="/financials"], .dashboard-nav a[href="/create-project"]'
    )
    await expect(internalLinks).toHaveCount(0)
    await page.keyboard.press('Escape')

    for (const route of ['/admin', '/audit', '/projects', '/clients', '/financials', '/create-project']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
    }

    const client = await signInWithPassword(CLIENT_EMAIL, PASSWORD)
    await expectDenied('Client listing projects', client.accessToken, '/api/projects')
    await expectDenied('Client reading a document', client.accessToken, `/api/documents/${documentId}`)
    await expectDenied('Client reading audit', client.accessToken, '/api/admin/audit')
    await expectDenied('Client listing users', client.accessToken, '/api/admin/users')
  })

  // -------------------------------------------------------------------- REPORTING
  monitor.phase = 'report'
  console.log('\n--- Browser diagnostics ---')
  console.log('Console errors:', monitor.consoleErrors.length ? monitor.consoleErrors.join('\n') : 'none')
  console.log('Page errors:', monitor.pageErrors.length ? monitor.pageErrors.join('\n') : 'none')
  console.log('Failed requests (non-abort):', monitor.requestFailures.length ? monitor.requestFailures.join('\n') : 'none')
  console.log('Aborted requests (navigation cancellations):', monitor.abortedRequests.length ? monitor.abortedRequests.join('\n') : 'none')
  console.log('HTTP >=400 responses:', monitor.httpFailures.length ? monitor.httpFailures.join('\n') : 'none')
  console.log('Expected API denials:\n' + monitor.expectedDenials.join('\n'))
  console.log(`Screenshots: ${SHOTS}`)

  expect(monitor.consoleErrors, 'No browser console errors allowed').toEqual([])
  expect(monitor.pageErrors, 'No browser page errors allowed').toEqual([])
  expect(monitor.requestFailures, 'No failed browser requests allowed').toEqual([])
  expect(monitor.unexpected, 'No unexpected browser/network errors allowed').toEqual([])
  console.log('\n🎉 MASTER WORKFLOW PASSED — visible headed browser run completed')
})
