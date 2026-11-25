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

test('Test D — audit trail is visible, read-only, and records role management', async ({ page }) => {
  const shots = shotDir('admin-restrictions')
  const service = serviceClient()
  const email = `audit-test-${Date.now()}@test.com`
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: 'AuditTest!234',
    email_confirm: true,
    user_metadata: { full_name: 'Audit Trail Test User' },
  })
  expect(error).toBeNull()
  const userId = created.user!.id

  try {
    // Wait for the profile trigger, then generate an audited role change through
    // the trusted admin API (the same path the UI uses).
    for (let attempt = 0; attempt < 50; attempt++) {
      const { data } = await service.from('profiles').select('id').eq('id', userId).single()
      if (data) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const { accessToken } = await signInWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
    const change = await fetch(`${BASE_URL}/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ role: 'senior_dev_pm' }),
    })
    expect(change.status).toBe(200)
    expect((await change.json()).audits).toContain('user.role_changed')

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await openMenu(page)
    await page.getByRole('link', { name: 'Audit Trails', exact: true }).click()
    await expect(page.getByTestId('audit-readonly')).toBeVisible()
    await expect(page.getByTestId('audit-row').first()).toBeVisible()

    await page.getByRole('combobox', { name: 'Filter by activity' }).selectOption({ label: 'Role changed' })
    // The generated email is unique to this run, so only this user's role
    // change remains after both filters are applied.
    await page.getByRole('textbox', { name: 'Search by user name or email' }).fill(email)
    const rows = page.getByTestId('audit-row').filter({ hasText: 'Audit Trail Test User' })
    await expect(rows).toHaveCount(1)
    const row = rows.first()
    await expect(row).toContainText('Role changed')
    await expect(row).toContainText('Senior Developer / Project Manager')

    const rowText = (await row.innerText()) || ''
    expect(rowText).not.toContain(userId)
    expect(rowText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i)
    expect(rowText).not.toMatch(/[{}]\s*"/)
    expect(rowText).not.toMatch(/\b(?:user\.|pts_|project\.|document\.)[a-z_]+/i)
    await shot(page, shots, 'D-01-audit-role-change.png')

    const controls = page.locator('button').filter({
      hasText: /edit|delete|remove|create fake|add entry/i,
    })
    await expect(controls).toHaveCount(0)

    // Every filter can be cleared in one action.
    await expect(page.getByTestId('audit-reset-filters')).toBeEnabled()
    await page.getByTestId('audit-reset-filters').click()
    await expect(page.getByRole('textbox', { name: 'Search by user name or email' })).toHaveValue('')

    const { data: auditRow } = await service
      .from('audit_entries')
      .select('id, action, entity_id')
      .eq('entity_id', userId)
      .eq('action', 'user.role_changed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!auditRow?.id) throw new Error('Audited role change was not found')

    const { count: beforeCount } = await service
      .from('audit_entries')
      .select('id', { count: 'exact', head: true })

    const asAdmin = callerClient(accessToken)

    const updateAttempt = await asAdmin
      .from('audit_entries')
      .update({ action: 'fake.edited_entry' })
      .eq('id', auditRow.id)
    expect(updateAttempt.error).toBeTruthy()
    expect(updateAttempt.error?.message || '').toMatch(/row-level security|permission denied|not allowed/i)

    const deleteAttempt = await asAdmin.from('audit_entries').delete().eq('id', auditRow.id)
    expect(deleteAttempt.error).toBeTruthy()

    const insertAttempt = await asAdmin.from('audit_entries').insert({
      action: 'fake.audit_entry',
      entity_type: 'profile',
      entity_id: userId,
      actor_user_id: userId,
    })
    expect(insertAttempt.error).toBeTruthy()

    const { count: afterCount } = await service
      .from('audit_entries')
      .select('id', { count: 'exact', head: true })
    expect(afterCount).toBe(beforeCount)

    const { data: stillThere } = await service
      .from('audit_entries')
      .select('action')
      .eq('id', auditRow.id)
      .single()
    expect(stillThere?.action).toBe('user.role_changed')
  } finally {
    await service.auth.admin.deleteUser(userId)
  }
})
