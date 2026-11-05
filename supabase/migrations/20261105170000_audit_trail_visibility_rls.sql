-- ==========================================================================
-- AUDIT TRAIL VISIBILITY — Role-based RLS on audit_entries
-- ==========================================================================
-- This migration drops legacy audit_entries policies. The new role-scoped
-- policies are created in migration 20261105190000_audit_entries_project_id
-- which adds the project_id column that the policies depend on.
-- ==========================================================================

-- Drop existing policies (idempotent)
drop policy if exists "Admins can view all audit entries" on public.audit_entries;
drop policy if exists "Senior can view assigned project audit entries" on public.audit_entries;
drop policy if exists "Junior can view assigned project audit entries" on public.audit_entries;
drop policy if exists "System can create audit entries" on public.audit_entries;

-- Note: Role-scoped policies are created in migration
-- 20261105190000_audit_entries_project_id.sql which adds the project_id column
-- that these policies depend on.
