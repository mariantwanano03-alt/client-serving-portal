import type { SupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY. All application audit writes go through the database RPC, which
// derives actor_user_id from auth.uid(). Direct INSERTs are blocked by RLS.
export type AuditWrite = {
  action: string
  entity_type: string
  entity_id?: string | null
  before_value?: unknown
  after_value?: unknown
}

export async function writeAudit(db: SupabaseClient, entry: AuditWrite) {
  const { error } = await db.rpc('insert_audit_entry', {
    p_action: entry.action,
    p_entity_type: entry.entity_type,
    p_entity_id: entry.entity_id ?? null,
    p_before_value: (entry.before_value as never) ?? null,
    p_after_value: (entry.after_value as never) ?? null,
  })
  if (error) {
    console.error('Audit write failed:', error.message)
  }
  return { error }
}
