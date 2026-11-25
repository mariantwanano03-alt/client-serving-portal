import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describeAudit } from '../lib/audit-display'
import { normalizeGenerationType, validateGenerationFields } from '../lib/document-generation'
import { verifySignedSla } from '../lib/sla-verification'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  PUBLISHABLE_KEY,
  SUPABASE_URL,
  login,
  serviceClient,
  signInWithPassword,
} from './helpers/admin'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PASSWORD = 'test1234'
const JUNIOR_EMAIL = 'alex@test.com'
const SENIOR_EMAIL = 'elena@test.com'
const CLIENT_EMAIL = 'musainnocent456@gmail.com'
const TOKEN = new Date().toISOString().replace(/[^0-9]/g, '').slice(-10)
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

type Json = Record<string, unknown>
type Row = Record<string, unknown>

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
  return { status: response.status, json, text }
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

class FakeQuery {
  private rows: Row[]

  constructor(rows: Row[]) {
    this.rows = [...rows]
  }

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.rows = this.rows.filter((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.rows = this.rows.filter((row) => values.includes(row[column]))
    return this
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.rows, error: null as null }).then(onfulfilled, onrejected)
  }
}

function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from: (table: string) => new FakeQuery(tables[table] || []),
  } as unknown as SupabaseClient
}

function slaTables(signedRows: Row[], slaDocumentIds = ['sla-1']) {
  return {
    documents: [
      ...slaDocumentIds.map((id) => ({ id, project_id: PROJECT_ID, type: 'SLA', status: 'approved' })),
      { id: 'requirements-1', project_id: PROJECT_ID, type: 'Requirements', status: 'approved' },
    ],
    document_revisions: slaDocumentIds.map((id) => ({ id: `rev-${id}`, document_id: id })),
    signed_documents: signedRows.map((row) => ({ project_id: PROJECT_ID, ...row })),
  }
}

test.describe('Document generation configuration', () => {
  test('accepts only canonical or legacy-mapped types and validates type-specific fields', async () => {
    expect(normalizeGenerationType('Requirements')).toBe('Requirements')
    expect(normalizeGenerationType('PRD')).toBe('Requirements')
    expect(normalizeGenerationType('Service Level Agreement')).toBe('SLA')
    expect(normalizeGenerationType('Made Up Type')).toBeNull()

    expect(validateGenerationFields('Requirements', {})).toContain('Functional requirements is required.')
    expect(validateGenerationFields('Quotation', { line_items: [] })).toContain('Add at least one line item')

    const validInvoice = {
      invoice_number: 'INV-0001',
      line_items: [{ description: 'Portal build', quantity: 1, unit_price: '1000' }],
      tax_rate: '15',
    }
    expect(validateGenerationFields('Invoice', validInvoice)).toBeNull()

    const invalidInvoice = {
      invoice_number: 'INV-0001',
      line_items: [{ description: 'Portal build', quantity: 1, unit_price: '1000' }],
      tax_rate: '150',
    }
    expect(validateGenerationFields('Invoice', invalidInvoice)).toContain('Tax rate cannot exceed 100%.')

    const validTimeline = {
      start_date: '2026-12-01',
      milestones: [{ name: 'Discovery complete', duration: '2 weeks', date: '2026-12-15' }],
    }
    expect(validateGenerationFields('Timeline', validTimeline)).toBeNull()
  })

  test('audit descriptions for new events stay human-readable', async () => {
    const lookups = {
      profiles: new Map<string, { name: string; email: string | null }>(),
      projects: new Map([[PROJECT_ID, 'Masanabo Construction']]),
      clients: new Map<string, string>(),
      documents: new Map<string, string>(),
    }
    const description = describeAudit(
      {
        action: 'development.gate_denied',
        entity_type: 'project',
        entity_id: PROJECT_ID,
        before_value: null,
        after_value: { project_name: 'Masanabo Construction' },
      },
      lookups
    )
    expect(description.summary).toContain('Blocked an attempt to begin development')
    expect(description.summary).not.toContain('development.gate_denied')
    expect(description.summary).not.toContain(PROJECT_ID)
  })
})

test.describe('SLA verification decision matrix', () => {
  test('A — explicit signed status with a sister-system completion timestamp is verified', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'signed-1',
        source_document_id: 'sla-1',
        revision_id: 'rev-sla-1',
        external_status: 'signed',
        external_pulled_at: '2026-11-24T10:00:00Z',
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T10:00:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(true)
    expect(result.state).toBe('signed')
    expect(result.signedAt).toBe('2026-11-24T10:00:00Z')
  })

  test('B — ready_to_pull is not a signature', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'ready-1',
        source_document_id: 'sla-1',
        revision_id: 'rev-sla-1',
        external_status: 'ready_to_pull',
        external_pulled_at: null,
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T09:30:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('in_progress')
    expect(result.message).toContain('Development remains locked')
  })

  test('C — signed status without a completion timestamp is unconfirmed', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'signed-no-date',
        source_document_id: 'sla-1',
        revision_id: 'rev-sla-1',
        external_status: 'signed',
        external_pulled_at: null,
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T09:30:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('unconfirmed')
    expect(result.message).toContain('verified signing completion date')
  })

  test('D — a signed record for an unrelated document does not verify the SLA', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'signed-other',
        source_document_id: 'different-document',
        revision_id: null,
        external_status: 'signed',
        external_pulled_at: '2026-11-24T10:00:00Z',
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T10:00:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('awaiting_signature')
  })

  test('E — cancelled, replaced or invalidated status locks development', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'replaced-1',
        source_document_id: 'sla-1',
        revision_id: 'rev-sla-1',
        external_status: 'replaced',
        external_pulled_at: '2026-11-24T10:00:00Z',
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T10:00:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('invalidated')
    expect(result.message).toContain('cancelled, replaced or invalidated')
  })

  test('F — the latest SLA record governs after an older signed record', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([
        {
          id: 'old-signed',
          source_document_id: 'sla-1',
          revision_id: 'rev-sla-1',
          external_status: 'signed',
          external_pulled_at: '2026-11-20T10:00:00Z',
          created_at: '2026-11-20T09:00:00Z',
          updated_at: '2026-11-20T10:00:00Z',
        },
        {
          id: 'new-in-progress',
          source_document_id: 'sla-1',
          revision_id: 'rev-sla-1',
          external_status: 'in_progress',
          external_pulled_at: '2026-11-24T10:00:00Z',
          created_at: '2026-11-24T09:00:00Z',
          updated_at: '2026-11-24T10:00:00Z',
        },
      ])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('in_progress')
    expect(result.signedAt).toBeNull()
  })

  test('G — shared/upload metadata and signed-looking titles do not prove signing', async () => {
    const result = await verifySignedSla(
      fakeAdmin(slaTables([{
        id: 'metadata-only',
        document_title: 'signed_sla.pdf',
        source_document_id: 'sla-1',
        revision_id: 'rev-sla-1',
        external_status: 'ready_to_pull',
        external_pulled_at: null,
        approved_at: '2026-11-24T09:10:00Z',
        shared_at: '2026-11-24T09:20:00Z',
        created_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T09:30:00Z',
      }])),
      PROJECT_ID
    )
    expect(result.verified).toBe(false)
    expect(result.state).toBe('in_progress')
  })
})

test('Generated drafts use real data, stay editable and pass senior review', async ({ page }) => {
  const service = serviceClient()
  const junior = await signInWithPassword(JUNIOR_EMAIL, PASSWORD)
  const senior = await signInWithPassword(SENIOR_EMAIL, PASSWORD)
  const { data: clientRow } = await service.from('clients').select('id, name').limit(1).maybeSingle()
  expect(clientRow?.id).toBeTruthy()

  const projectName = `Generation Verification ${TOKEN}`
  const created = await api(junior.accessToken, '/api/projects', 'POST', {
    client_id: clientRow?.id,
    name: projectName,
    description: 'Used to verify real-data draft generation and approval.',
  })
  expect([200, 201]).toContain(created.status)
  const projectId = nestedString(created.json, 'id') || nestedString(created.json, 'project', 'id') || nestedString(created.json, 'data', 'id')
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/i)

  await login(page, JUNIOR_EMAIL, PASSWORD)
  await page.goto(`/projects/${projectId}?tab=documents`)

  await expect(page.getByTestId('generate-document-button')).toHaveCount(1, { timeout: 30000 })
  expect(await page.getByRole('button', { name: 'Generate PRD', exact: true }).count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Draft Document', exact: true }).count()).toBe(0)

  await page.getByTestId('generate-document-button').click()
  await expect(page.getByTestId('generate-modal')).toBeVisible()
  await page.getByTestId('generate-type-Requirements').click()
  await page.getByTestId('generate-continue').click()

  await expect(page.getByTestId('generation-field-functional_requirements')).toBeVisible()
  await page.getByTestId('generate-submit').click()
  await expect(page.getByTestId('generation-error')).toContainText('Functional requirements is required.')

  await page.getByTestId('generation-field-functional_requirements').fill('Capture and report all client requirements.')
  await page.getByTestId('generation-field-non_functional_requirements').fill('Client records must remain private and the portal must be responsive.')
  await page.getByTestId('generate-submit').click()
  await expect(page.getByTestId('documents-message')).toContainText('created as a draft', { timeout: 20000 })
  await expect(page.getByTestId('generate-modal')).toHaveCount(0)

  const { data: generatedDocument } = await service
    .from('documents')
    .select('id, title, type, status')
    .eq('project_id', projectId)
    .eq('type', 'Requirements')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  expect(generatedDocument?.id).toBeTruthy()
  expect(generatedDocument?.status).toBe('draft')
  expect(String(generatedDocument?.title)).toContain(projectName)

  const { data: revision } = await service
    .from('document_revisions')
    .select('content')
    .eq('document_id', String(generatedDocument?.id))
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  expect(String(revision?.content)).toContain(projectName)
  expect(String(revision?.content)).toContain(String(clientRow?.name))
  expect(String(revision?.content)).not.toMatch(/lorem|ipsum|placeholder/i)

  const row = page.locator('table tbody tr').filter({ hasText: String(generatedDocument?.title) }).first()
  await expect(row).toBeVisible()
  await row.getByTestId('open-document').click()
  const content = page.getByTestId('document-content')
  await expect(content).toContainText(projectName)
  await content.fill(`${await content.inputValue()}\n\nJunior verification edit.`)
  await page.getByTestId('save-document').click()
  await expect(page.getByTestId('documents-message')).toContainText('saved')

  await page.getByTestId('submit-review').click()
  await expect(page.getByTestId('document-editor')).toContainText('Pending Review')

  const { data: submitted } = await service
    .from('documents')
    .select('status')
    .eq('id', String(generatedDocument?.id))
    .single()
  expect(submitted?.status).toBe('pending_review')

  // Senior approval authority is granted by an administrator through the real
  // assignment relationship; role alone never grants approval on this project.
  const admin = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const { data: seniorProfile } = await service.from('profiles').select('id').eq('email', SENIOR_EMAIL).single()
  expect(seniorProfile?.id).toBeTruthy()
  const reassigned = await api(admin.accessToken, `/api/projects/${projectId}/assign`, 'POST', {
    developer_user_id: seniorProfile?.id,
  })
  expect([200, 201]).toContain(reassigned.status)

  const approval = await api(senior.accessToken, `/api/documents/${String(generatedDocument?.id)}/approve`, 'POST', { decision: 'approved' })
  expect([200, 201]).toContain(approval.status)

  const { data: approved } = await service
    .from('documents')
    .select('status')
    .eq('id', String(generatedDocument?.id))
    .single()
  expect(approved?.status).toBe('approved')
})

test('Development readiness is locked and cannot be bypassed through API or direct database writes', async () => {
  const service = serviceClient()
  const senior = await signInWithPassword(SENIOR_EMAIL, PASSWORD)
  const junior = await signInWithPassword(JUNIOR_EMAIL, PASSWORD)
  const juniorB = await signInWithPassword('junior@test.com', PASSWORD)
  const juniorC = await signInWithPassword('marcus@test.com', PASSWORD)
  const admin = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  const client = await signInWithPassword(CLIENT_EMAIL, PASSWORD)
  const { data: clientRow } = await service.from('clients').select('id').limit(1).maybeSingle()
  expect(clientRow?.id).toBeTruthy()

  const created = await api(senior.accessToken, '/api/projects', 'POST', {
    client_id: clientRow?.id,
    name: `Development Gate Check ${TOKEN}`,
    description: 'Used to verify locked development readiness.',
  })
  expect([200, 201]).toContain(created.status)
  const projectId = nestedString(created.json, 'id') || nestedString(created.json, 'project', 'id') || nestedString(created.json, 'data', 'id')
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/i)

  const readiness = await api(senior.accessToken, `/api/projects/${projectId}/readiness`)
  expect(readiness.status).toBe(200)
  expect(readiness.json.development).toBe('locked')
  expect(readiness.json.clientAgreement).toMatchObject({
    verified: false,
    label: 'Client Approved & Agreed to Terms: ✗',
  })
  expect(String(readiness.json.clientAgreement && typeof readiness.json.clientAgreement === 'object'
    ? (readiness.json.clientAgreement as Json).detail
    : '')).toContain('SLA Awaiting Client Signature.')
  expect((readiness.json.prerequisites as Row[] | undefined)?.length).toBe(4)

  // Separate junior accounts on other assignments must not read this project.
  for (const [label, token] of [
    ['Junior B', juniorB.accessToken],
    ['Junior C', juniorC.accessToken],
  ]) {
    const deniedRead = await api(token, `/api/projects/${projectId}/readiness`)
    expect(deniedRead.status, `${label} should not read readiness`).toBe(403)
  }

  const attempts: [string, string, number][] = [
    ['junior', junior.accessToken, 403],
    ['Junior B', juniorB.accessToken, 403],
    ['Junior C', juniorC.accessToken, 403],
    ['administrator', admin.accessToken, 403],
    ['client', client.accessToken, 403],
    ['senior with incomplete prerequisites', senior.accessToken, 409],
  ]
  for (const [label, token, expected] of attempts) {
    const response = await api(token, `/api/projects/${projectId}/development/begin`, 'POST')
    expect(response.status, `${label} should not begin development`).toBe(expected)
  }

  const { data: afterApi } = await service.from('projects').select('stage').eq('id', projectId).single()
  expect(String(afterApi?.stage)).not.toMatch(/development/i)

  const directUpdate = await service
    .from('projects')
    .update({ stage: 'development' })
    .eq('id', projectId)
  expect(String(directUpdate.error?.message || '')).toMatch(/Development is locked/i)

  const { data: afterDb } = await service.from('projects').select('stage').eq('id', projectId).single()
  expect(String(afterDb?.stage)).not.toMatch(/development/i)

  // An unauthenticated client must not read signed records or call the gate.
  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: visibleSignedRows } = await anon.from('signed_documents').select('id').limit(5)
  expect((visibleSignedRows || []).length).toBe(0)
  const { error: rpcError } = await anon.rpc('development_readiness_satisfied', { p_project_id: projectId })
  expect(rpcError).toBeTruthy()
})
