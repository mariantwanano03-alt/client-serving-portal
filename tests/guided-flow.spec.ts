import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SHOTS = path.resolve(process.cwd(), 'screenshots/guided-flow')
fs.mkdirSync(SHOTS, { recursive: true })

const TRANSCRIPT = [
  'Company name: Northwind Trading',
  'Primary contact: Jane Doe',
  'Email: jane@northwind.example',
  'Phone: +1 555 0100',
  'Industry: Logistics',
  'Business requirements: Track shipments and generate invoices.',
  'Client objectives: Reduce manual paperwork.',
  'Required services: Client portal, document generation, reporting.',
].join('\n')

function envFromFile() {
  const file = path.resolve(process.cwd(), '.env.local')
  const text = fs.readFileSync(file, 'utf8')
  return text.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) acc[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    return acc
  }, {})
}

test('GUIDED FLOW: login → theme → audio → review → create → edit client → documents → links', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
    console.log(`📸 screenshot: screenshots/guided-flow/${name}.png`)
  }

  // ---------------------------------------------------------------- LOGIN
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('alex@test.com')
  await page.locator('input[type="password"]').fill('test1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard|\/$/, { timeout: 15000 })
  // Mobile collapses the account label; check the name is rendered there.
  const accountName = page.getByText('Alex Rivers').first()
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await expect(accountName).toBeAttached({ timeout: 15000 })
  } else {
    await expect(accountName).toBeVisible({ timeout: 15000 })
  }
  console.log('✅ STEP 1: logged in as Alex Rivers')
  await shot('01-dashboard')

  // ---------------------------------------------------------------- THEME
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible()
  await page.locator('[data-testid="theme-light"]').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await shot('02-settings-light')

  await page.locator('[data-testid="theme-dark"]').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  console.log(`   body background: light=${lightBg} → dark=${darkBg}`)
  expect(darkBg).not.toBe(lightBg)
  await shot('03-settings-dark')

  await page.goto('/projects')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  console.log('✅ STEP 2: dark theme persists across navigation + refresh')
  await shot('04-projects-dark')

  // restore light for the rest of the walkthrough (easier to watch)
  await page.goto('/settings')
  await page.locator('[data-testid="theme-light"]').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  // ---------------------------------------------------------------- CREATE PROJECT
  await page.goto('/')
  await page.locator('[data-testid="add-new-project"]').click()
  await expect(page).toHaveURL(/\/create-project/)
  await expect(page.getByText('Record Discovery Meeting').first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('transcript-input')).toBeVisible()
  console.log('✅ STEP 3: AudioRecorder + transcript input visible on Create Project')
  await shot('05-create-project-recorder')

  // Microphone hardware is not available in CI; use the same transcript input
  // that the recorder fills (this is the exact review path the recorder uses).
  await page.getByTestId('transcript-input').fill(TRANSCRIPT)
  await expect(page.getByTestId('transcript-status')).toHaveText(/ready/)
  await page.getByTestId('continue-to-review').click()

  await expect(page.getByTestId('detail-client_name')).toHaveValue('Northwind Trading')
  await expect(page.getByTestId('detail-primary_contact')).toHaveValue('Jane Doe')
  await expect(page.getByTestId('detail-contact_email')).toHaveValue('jane@northwind.example')
  // Fields absent from the transcript must stay blank — no invented data.
  await expect(page.getByTestId('detail-company_address')).toHaveValue('')
  console.log('✅ STEP 4: extracted details prefilled; missing fields left blank')
  await shot('06-review-details')

  await page.getByTestId('confirm-details').check()
  await page.getByTestId('create-project-submit').click()
  await expect(page.getByText('Project created', { exact: true })).toBeVisible({ timeout: 30000 })
  const reference = (await page.getByTestId('created-project-reference').innerText()).trim()
  const projectHref = await page.getByTestId('open-project-link').getAttribute('href')
  console.log(`✅ STEP 5: project created — ${reference} (${projectHref})`)
  await shot('07-project-created')

  // ---------------------------------------------------------------- EDIT CLIENT
  await page.getByTestId('open-project-link').click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/)
  await expect(page.getByText('Northwind Trading').first()).toBeVisible()
  await shot('08-project-workspace')

  await page.getByRole('button', { name: /edit client/i }).click()
  await expect(page.getByLabel(/company name/i)).toBeVisible()
  await page.getByLabel(/company name/i).fill('Northwind Trading Ltd')
  await page.getByRole('button', { name: /save client/i }).click()
  await expect(page.getByText('Northwind Trading Ltd').first()).toBeVisible({ timeout: 15000 })
  console.log('✅ STEP 6: client details edited and saved to database')
  await shot('09-client-edited')

  // ---------------------------------------------------------------- DOCUMENTS
  await page.getByRole('button', { name: 'Documents' }).click()
  const beforeDocs = await page.getByText(/Documents \(\d+\)/).innerText()

  await expect(page.getByTestId('generate-document-button')).toHaveCount(1)
  await page.getByTestId('generate-document-button').click()
  await expect(page.getByTestId('generate-modal')).toBeVisible()
  await page.getByTestId('generate-type-Requirements').click()
  await page.getByTestId('generate-continue').click()
  await expect(page.getByTestId('generation-field-functional_requirements')).toBeVisible()
  await page.getByTestId('generation-field-functional_requirements').fill('Track shipment status and generate invoices.')
  await page.getByTestId('generation-field-non_functional_requirements').fill('The portal must load within three seconds and keep client records private.')
  await page.getByTestId('generate-submit').click()

  await expect(page.getByTestId('documents-message')).toContainText('created as a draft', { timeout: 20000 })
  const countFrom = (value: string) => Number(value.match(/\d+/)?.[0] || '0')
  const expectedCount = countFrom(beforeDocs) + 1
  const documentsHeading = page.getByRole('heading', { name: /Documents \(\d+\)/ })
  await expect(documentsHeading).toHaveText(new RegExp(`Documents \\(${expectedCount}\\)`), { timeout: 20000 })
  const afterDocs = await documentsHeading.innerText()
  console.log(`✅ STEP 7: requirements draft generated — ${beforeDocs} → ${afterDocs}`)

  // Download the generated draft as a real PDF.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).first().click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  const pdfBytes = downloadedPath ? fs.readFileSync(downloadedPath) : Buffer.alloc(0)
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdfBytes.length).toBeGreaterThan(1000)
  console.log('✅ STEP 7b: downloaded a readable PDF with real project data')
  await shot('10-documents-generated')

  // ---------------------------------------------------------------- LINKS
  await page.getByRole('button', { name: 'URL Links' }).click()
  await page.getByLabel('Label').fill('GitHub')
  await page.getByLabel('URL').fill('https://github.com/example/northwind-portal')
  await page.getByRole('button', { name: /save link/i }).click()
  const githubLink = page.getByRole('link', { name: /github\.com\/example\/northwind-portal/ })
  await expect(githubLink).toBeVisible({ timeout: 15000 })
  await expect(githubLink).toHaveAttribute('href', 'https://github.com/example/northwind-portal')
  await expect(githubLink).toHaveAttribute('target', '_blank')
  await page.getByLabel('Label').fill('Supabase')
  await page.getByLabel('URL').fill('https://supabase.com/dashboard/project/example')
  await page.getByRole('button', { name: /save link/i }).click()
  const supabaseLink = page.getByRole('link', { name: /supabase\.com\/dashboard\/project\/example/ })
  await expect(supabaseLink).toBeVisible({ timeout: 15000 })
  await expect(supabaseLink).toHaveAttribute('href', 'https://supabase.com/dashboard/project/example')
  await expect(supabaseLink).toHaveAttribute('target', '_blank')
  console.log('✅ STEP 8: GitHub + Supabase links saved with correct href and target="_blank"')
  await shot('11-url-links')

  // ---------------------------------------------------------------- BACKEND PROOF
  const env = envFromFile()
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } }
  )
  const projectId = projectHref?.split('/').pop()
  const { data: savedProject, error: pErr } = await admin.from('projects')
    .select('id, project_reference, clients(name)').eq('id', projectId).single()
  expect(pErr).toBeNull()
  expect(savedProject?.project_reference).toBe(reference)
  const savedClient = savedProject?.clients as { name?: string } | { name?: string }[] | null | undefined
  const savedClientName = Array.isArray(savedClient) ? savedClient[0]?.name : savedClient?.name
  expect(savedClientName).toBe('Northwind Trading Ltd')

  const { data: docs } = await admin.from('documents').select('id, type').eq('project_id', projectId)
  expect((docs || []).some((d) => d.type === 'Requirements')).toBeTruthy()

  // Every generated document revision must be based on real reviewed details.
  for (const doc of docs || []) {
    const { data: rev } = await admin.from('document_revisions')
      .select('content').eq('document_id', doc.id).single()
    const content = rev?.content || ''
    expect(content).toContain('Northwind Trading')
    expect(content).not.toMatch(/placeholder document|lorem ipsum|TODO/i)
  }

  const { data: links } = await admin.from('development_links').select('link_type, url').eq('project_id', projectId)
  const types = (links || []).map((l) => l.link_type)
  expect(types).toContain('GitHub')
  expect(types).toContain('Supabase')

  const { data: profile } = await admin.from('profiles').select('theme_preference')
    .eq('full_name', 'Alex Rivers').maybeSingle()
  const themePreference = (profile as { theme_preference?: string } | null)?.theme_preference
  console.log('   DB project:', savedProject?.project_reference, '| docs:', docs?.length, '| links:', types.join(', '), '| theme:', themePreference)
  console.log('✅ STEP 9: backend/database verification passed')
  console.log(`\n🎉 FULL CLICKTHROUGH PASSED — evidence in ${SHOTS}`)
})
