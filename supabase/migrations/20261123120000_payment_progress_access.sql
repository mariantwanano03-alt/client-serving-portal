-- Payment Progress / Financial Overview read access.
--
-- The financial data already lives in `pts_payments` and `pts_deposit_overview`.
-- This migration only widens SELECT access to the records a caller is already
-- authorised to see; it creates no tables, copies no amounts and adds no
-- status/due-date fields. `pts_deposit_overview` is security_invoker, so it
-- inherits the policies on `deposits`, `pts_deposit_details` and `pts_payments`.
--
-- Roles:
--   * Existing PTS finance permissions (deposit.view + pts_user_scopes) are
--     preserved exactly as before.
--   * Senior developers / PMs: all projects (matches the existing app model
--     where seniors manage every project).
--   * Clients: only projects/clients already in their pts_user_scopes, via the
--     existing client_can_access_message() scope helper.
--   * Junior developers and administrators gain no new access unless they
--     already hold the PTS `deposit.view` permission.

begin;

-- ---------------------------------------------------------------------------
-- 1. Reusable read helpers (SECURITY DEFINER avoids RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.can_view_financial_project(p_project_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
       (public.pts_has_perm('deposit.view') and public.pts_can_see_project(p_project_id))
    or public.current_user_role() = 'senior_dev_pm'
    or public.client_can_access_message(p_client_id, p_project_id),
    false
  );
$$;

create or replace function public.can_view_financial_project_id(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_financial_project(p.id, p.client_id)
    from public.projects p
    where p.id = p_project_id
  ), false);
$$;

create or replace function public.can_view_financial_deposit(p_deposit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_financial_project(p.id, p.client_id)
    from public.deposits d
    join public.projects p on p.id = d.project_id
    where d.id = p_deposit_id
  ), false);
$$;

revoke all on function public.can_view_financial_project(uuid, uuid) from public;
grant execute on function public.can_view_financial_project(uuid, uuid) to authenticated;
revoke all on function public.can_view_financial_project_id(uuid) from public;
grant execute on function public.can_view_financial_project_id(uuid) to authenticated;
revoke all on function public.can_view_financial_deposit(uuid) from public;
grant execute on function public.can_view_financial_deposit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Additive SELECT policies. Existing policies are intentionally left in
--    place so current finance users keep exactly the access they had.
-- ---------------------------------------------------------------------------
drop policy if exists "Financial overview: deposits read" on public.deposits;
create policy "Financial overview: deposits read"
  on public.deposits for select to authenticated
  using (public.can_view_financial_project_id(project_id));

drop policy if exists "Financial overview: deposit details read" on public.pts_deposit_details;
create policy "Financial overview: deposit details read"
  on public.pts_deposit_details for select to authenticated
  using (public.can_view_financial_deposit(deposit_id));

drop policy if exists "Financial overview: payments read" on public.pts_payments;
create policy "Financial overview: payments read"
  on public.pts_payments for select to authenticated
  using (public.can_view_financial_deposit(deposit_id));

commit;
