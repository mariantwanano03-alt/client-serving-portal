import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from './authz'

// SERVER-ONLY. Project visibility is role-based: seniors may work across the
// delivery portfolio, juniors only on projects where they hold an active
// assignment. Administrators are read-only and never pass these write gates.
export async function canAccessProject(
  db: SupabaseClient,
  callerId: string,
  role: Role,
  projectId: string
): Promise<boolean> {
  if (role === 'senior_dev_pm') {
    const { data, error } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle()
    return !error && Boolean(data)
  }

  if (role === 'junior_developer') {
    const { data, error } = await db
      .from('assignments')
      .select('id')
      .eq('project_id', projectId)
      .eq('developer_user_id', callerId)
      .eq('is_active', true)
      .maybeSingle()
    return !error && Boolean(data)
  }

  return false
}
