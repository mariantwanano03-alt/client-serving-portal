-- PostgreSQL does not use the USING clause of an ALL policy for INSERT.
-- Add an explicit project-scoped insert policy for readiness criteria.
drop policy if exists "Project approvers can insert readiness items" on public.readiness_items;
create policy "Project approvers can insert readiness items"
  on public.readiness_items for insert to authenticated
  with check (public.can_approve_readiness_check(readiness_check_id));
