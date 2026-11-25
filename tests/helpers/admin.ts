import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

export const ADMIN_EMAIL = 'admin2@test.com'
// Shared local test credential for the active administrator account.
// Override with ADMIN_TEMP_PASSWORD when running outside this environment.
export const ADMIN_PASSWORD = process.env.ADMIN_TEMP_PASSWORD || 'test1234'

export function envFromFile(): Record<string, string> {
  const raw = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

const env = envFromFile()
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
export const PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** A caller-bound client: equivalent to direct Supabase calls from the browser. */
export function callerClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function signInWithPassword(email: string, password: string) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(error?.message || `Could not sign in ${email}`)
  return { client, session: data.session, accessToken: data.session.access_token }
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email-input').fill(email)
  await page.locator('#password-input').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Home is the default landing page for every role.
  await page.waitForURL(/\/$/, { timeout: 20000 })
}

/**
 * Finds the newest project where the given user holds an active assignment.
 * Tests must not select the globally newest project: project creation can be
 * reassigning work, and the workspace is intentionally hidden from developers
 * who are no longer assigned to it.
 */
export async function firstAssignedProjectFor(email: string) {
  const service = serviceClient()
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
  if (profileError || !profile?.id) {
    throw new Error(`Could not find profile for ${email}: ${profileError?.message}`)
  }

  const { data: assignment, error: assignmentError } = await service
    .from('assignments')
    .select('project_id')
    .eq('developer_user_id', profile.id)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (assignmentError || !assignment?.project_id) {
    throw new Error(`No active project assignment for ${email}: ${assignmentError?.message}`)
  }

  const { data: project, error: projectError } = await service
    .from('projects')
    .select('id, client_id')
    .eq('id', assignment.project_id)
    .single()
  if (projectError || !project?.id) {
    throw new Error(`Could not load assigned project: ${projectError?.message}`)
  }

  const { data: clientRow } = await service
    .from('clients')
    .select('id, name')
    .eq('id', project.client_id)
    .maybeSingle()
  return { id: project.id, client_id: project.client_id, client_name: clientRow?.name ?? '' }
}

/** Opens the right-side navigation drawer before clicking a drawer link. */
export async function openMenu(page: Page) {
  const drawer = page.getByTestId('nav-drawer')
  if (!(await drawer.isVisible())) {
    // aria-expanded can lag behind the real state after a client-side
    // navigation. Trust actual visibility and reset with Escape first.
    await page.keyboard.press('Escape')
    await page.getByTestId('menu-toggle').click()
  }
  await drawer.waitFor({ state: 'visible' })
}

export function shotDir(name: string) {
  const dir = path.resolve(process.cwd(), 'screenshots', name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function shot(page: Page, dir: string, name: string) {
  const file = path.join(dir, name)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`📸 screenshot: ${file}`)
}

export function rlsError(error: { message?: string } | null | undefined) {
  return Boolean(error && /row-level security|permission denied|not allowed/i.test(error.message || ''))
}
