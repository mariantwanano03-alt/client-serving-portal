-- Allow project approvers to reset and populate readiness results when
-- re-evaluating a checklist.
drop policy if exists "Project approvers can update readiness" on public.readiness_checks;
create policy "Project approvers can update readiness"
  on public.readiness_checks for update to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

-- PostgreSQL does not reliably apply the USING clause of an ALL policy to
-- INSERT rows. Define the required INSERT permission explicitly.
drop policy if exists "Project approvers can insert readiness items" on public.readiness_items;
create policy "Project approvers can insert readiness items"
  on public.readiness_items for insert to authenticated
  with check (public.can_approve_readiness_check(readiness_check_id));
