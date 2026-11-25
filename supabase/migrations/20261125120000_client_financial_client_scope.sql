-- Clients must be able to read their own client record for the financial view.
--
-- `pts_deposit_overview` is a security_invoker view that joins `clients` for the
-- client name. The scoped portal policies deliberately exclude the client role
-- from general client reads, which also hid every overview row from clients.
-- Extend the existing client helper only for records already in the caller's
-- `pts_user_scopes`; this is the same scope used by messages and finance RLS.

create or replace function public.portal_can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_administrator()
    or public.current_user_role() = 'senior_dev_pm'
    or (
      public.current_user_role() = 'junior_developer'
      and exists (
        select 1
        from public.projects p
        join public.assignments a on a.project_id = p.id
        where p.client_id = p_client_id
          and a.developer_user_id = auth.uid()
          and a.is_active
      )
    )
    or (
      public.current_user_role() = 'client'
      and exists (
        select 1
        from public.pts_user_scopes s
        join public.projects p on p.id = s.project_id
        where s.user_id = auth.uid()
          and (s.client_id = p_client_id or p.client_id = p_client_id)
      )
    );
$$;

-- Recreate the dependent policy so the updated helper is definitely used.
drop policy if exists "Portal client read" on public.clients;
create policy "Portal client read"
  on public.clients for select to authenticated
  using (public.portal_can_access_client(id));

-- The financial overview inner-joins `projects` for the project name. Give
-- clients read-only access to exactly their scoped projects so the view can
-- resolve that join. This is deliberately a separate policy: document access
-- uses `portal_can_access_project()` and must remain closed to clients.
drop policy if exists "Client financial project read" on public.projects;
create policy "Client financial project read"
  on public.projects for select to authenticated
  using (
    public.current_user_role() = 'client'
    and exists (
      select 1
      from public.pts_user_scopes s
      where s.user_id = auth.uid()
        and s.project_id = projects.id
    )
  );
