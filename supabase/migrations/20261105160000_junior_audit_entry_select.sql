-- ==========================================================================
-- AUDIT ENTRY RLS — Junior access to project audit trails
-- ==========================================================================
-- Juniors may view audit entries for projects they are assigned to
-- (as developer or lead, active assignment).
-- ==========================================================================

create policy "Junior can view audit entries for assigned projects"
  on public.audit_entries for select
  to authenticated
  using (
    public.current_user_role() = 'junior_developer'
    and exists (
      select 1 from public.assignments a
      where a.project_id = audit_entries.entity_id
        and a.developer_user_id = auth.uid()
        and a.is_active
    )
  );
