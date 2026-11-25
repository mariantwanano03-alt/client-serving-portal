import { expect, test } from '@playwright/test'
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

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function callApi(token: string, path: string, method: string, body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('Test B — administrator can view projects but cannot perform project operations', async ({ page }) => {
  // This suite runs after a long serial regression; give the dev server room
  // to compile the project workspace before asserting read-only behaviour.
  test.setTimeout(180000)
  const shots = shotDir('admin-restrictions')
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

  await openMenu(page)
  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(page.getByTestId('add-new-project')).toHaveCount(0)
  await shot(page, shots, 'B-01-projects-list.png')

  await rows.first().click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/i)
  await expect(page.getByTestId('project-readonly')).toBeVisible()
  // Oversight exception: administrators may reassign the project developer.
  await expect(page.getByTestId('admin-developer-assignment')).toBeVisible()
  const forbidden = page.locator('button').filter({
    hasText: /generate|add link|delete|change status|approve|invoice|record discovery|upload audio|edit client/i,
  })
  await expect(forbidden).toHaveCount(0)
  await shot(page, shots, 'B-02-project-readonly.png')

  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(page.getByRole('button', { name: /generate/i })).toHaveCount(0)
  await shot(page, shots, 'B-03-documents-readonly.png')

  await page.getByRole('button', { name: 'URL Links', exact: true }).click()
  await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0)
  await expect(page.locator('form').filter({ hasText: /add link/i })).toHaveCount(0)
  await shot(page, shots, 'B-04-links-readonly.png')

  // Backend boundary: every business-operation endpoint rejects the admin token.
  const { accessToken } = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const service = serviceClient()
  const { data: project } = await service
    .from('projects')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  const { data: document } = await service.from('documents').select('id').limit(1).single()
  if (!project?.id) throw new Error('No project available for verification')

  const restrictedCalls: Array<[string, string, unknown?]> = [
    ['/api/projects', 'POST', { name: 'Forbidden Direct Project' }],
    ['/api/projects/create-from-meeting', 'POST', { details: { client_name: 'Forbidden', primary_contact: 'Nobody' }, transcript: 'x' }],
    ['/api/generate-document', 'POST', { project_id: project.id, type: 'PRD' }],
    ['/api/discovery/start', 'POST', { meeting_date: '2026-01-01', client_name: 'Forbidden', primary_contact: 'Nobody' }],
    ['/api/discovery/approve', 'POST', { id: '00000000-0000-4000-8000-000000000000' }],
    ['/api/transcribe', 'POST', {}],
    ['/api/documents', 'POST', { project_id: project.id, type: 'Proposal', title: 'Forbidden Draft' }],
    ['/api/documents/project-placeholder/submit', 'POST', {}],
  ]
  if (document?.id) {
    restrictedCalls.push([`/api/documents/${document.id}`, 'PATCH', { content: 'forbidden' }])
    restrictedCalls.push([`/api/documents/${document.id}/approve`, 'POST', { decision: 'approved' }])
    restrictedCalls.push([`/api/documents/${document.id}/send`, 'POST', {}])
    restrictedCalls.push([`/api/documents/${document.id}/upload`, 'POST', {}])
  }

  for (const [path, method, body] of restrictedCalls) {
    const response = await callApi(accessToken, path, method, body)
    expect(response.status, `${method} ${path} should deny administrators`).toBe(403)
  }

  // Direct PostgREST project writes are also denied by RLS.
  const asAdmin = callerClient(accessToken)
  const update = await asAdmin
    .from('projects')
    .update({ name: 'Forbidden Direct Update' })
    .eq('id', project.id)
    .select()
  expect(Boolean(update.error) || (update.data?.length ?? 0) === 0).toBeTruthy()
  const { data: unchanged } = await service.from('projects').select('name').eq('id', project.id).single()
  expect(unchanged?.name).not.toBe('Forbidden Direct Update')
})
