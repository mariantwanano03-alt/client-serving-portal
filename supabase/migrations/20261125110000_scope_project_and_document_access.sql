-- Scope staff access to the correct projects at the database layer.
-- UI and route handlers are not the only boundary: the earlier broad
-- "authenticated select" policies exposed every project, document, revision and
-- client to every signed-in account. Seniors keep portfolio-wide authority;
-- junior developers only see records for projects where they hold an active
-- assignment; administrators retain read-only oversight.

create or replace function public.portal_can_access_project(p_project_id uuid)
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
      and (
        exists (
          select 1
          from public.assignments a
          where a.project_id = p_project_id
            and a.developer_user_id = auth.uid()
            and a.is_active
        )
        -- An INSERT ... RETURNING checks SELECT policies before the creator's
        -- AFTER INSERT assignment is guaranteed to be visible. This narrow
        -- exception exists only until the project has an active assignment;
        -- once an administrator reassigns it, the former creator loses access.
        or (
          not exists (
            select 1 from public.assignments a
            where a.project_id = p_project_id and a.is_active
          )
          and exists (
            select 1 from public.projects p
            where p.id = p_project_id and p.created_by = auth.uid()
          )
        )
      )
    );
$$;

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
    );
$$;

create or replace function public.portal_can_access_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.portal_can_access_project((
    select d.project_id
    from public.documents d
    where d.id = p_document_id
  ));
$$;

-- Make this migration safe to re-apply after live-database reconciliation.
drop policy if exists "Portal project read" on public.projects;
drop policy if exists "Portal document read" on public.documents;
drop policy if exists "Junior can create draft documents" on public.documents;
drop policy if exists "Senior can create documents" on public.documents;
drop policy if exists "Junior can update own draft documents" on public.documents;
drop policy if exists "Senior can update documents" on public.documents;
drop policy if exists "Portal revision read" on public.document_revisions;
drop policy if exists "Junior can create draft revisions" on public.document_revisions;
drop policy if exists "Senior can create revisions" on public.document_revisions;
drop policy if exists "Junior can update own draft revisions" on public.document_revisions;
drop policy if exists "Senior can update revisions" on public.document_revisions;
drop policy if exists "Portal approval read" on public.approvals;
drop policy if exists "Portal assignment read" on public.assignments;
drop policy if exists "Portal client read" on public.clients;
drop policy if exists "Junior can edit assigned clients" on public.clients;
drop policy if exists "Senior can edit clients" on public.clients;

-- Projects: admins and seniors see all; juniors see assigned projects only.
drop policy if exists "Allow authenticated select projects" on public.projects;
drop policy if exists "Staff can view projects" on public.projects;
drop policy if exists "pts: staff read projects" on public.projects;
drop policy if exists "Junior can update projects" on public.projects;
create policy "Portal project read"
  on public.projects for select to authenticated
  using (public.portal_can_access_project(id));

-- Documents: remove direct approved-status inserts that bypassed review.
drop policy if exists "Allow authenticated select documents" on public.documents;
drop policy if exists "Staff can view documents" on public.documents;
drop policy if exists "Staff can create approved documents" on public.documents;
drop policy if exists "Staff can update documents" on public.documents;
drop policy if exists "Junior can create documents" on public.documents;
create policy "Portal document read"
  on public.documents for select to authenticated
  using (public.portal_can_access_project(project_id));
create policy "Junior can create draft documents"
  on public.documents for insert to authenticated
  with check (
    public.current_user_role() = 'junior_developer'
    and status in ('draft', 'pending_review')
    and public.portal_can_access_project(project_id)
  );
create policy "Senior can create documents"
  on public.documents for insert to authenticated
  with check (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_project(project_id)
  );
create policy "Junior can update own draft documents"
  on public.documents for update to authenticated
  using (
    public.current_user_role() = 'junior_developer'
    and public.portal_can_access_project(project_id)
    and status not in ('approved', 'sent_to_client')
    and exists (
      select 1 from public.document_revisions r
      where r.document_id = id and r.created_by = auth.uid()
    )
  )
  with check (
    public.current_user_role() = 'junior_developer'
    and public.portal_can_access_project(project_id)
    and status not in ('approved', 'sent_to_client')
  );
create policy "Senior can update documents"
  on public.documents for update to authenticated
  using (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_project(project_id)
  )
  with check (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_project(project_id)
  );

-- Revisions are the editable source and must obey the same project scope.
drop policy if exists "Allow authenticated select document_revisions" on public.document_revisions;
drop policy if exists "Staff can view revisions" on public.document_revisions;
drop policy if exists "Staff can create approved revisions" on public.document_revisions;
drop policy if exists "Staff can create revisions" on public.document_revisions;
drop policy if exists "Staff can update revisions" on public.document_revisions;
create policy "Portal revision read"
  on public.document_revisions for select to authenticated
  using (public.portal_can_access_document(document_id));
create policy "Junior can create draft revisions"
  on public.document_revisions for insert to authenticated
  with check (
    public.current_user_role() = 'junior_developer'
    and status in ('draft', 'pending_review')
    and created_by = auth.uid()
    and public.portal_can_access_document(document_id)
  );
create policy "Senior can create revisions"
  on public.document_revisions for insert to authenticated
  with check (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_document(document_id)
  );
create policy "Junior can update own draft revisions"
  on public.document_revisions for update to authenticated
  using (
    public.current_user_role() = 'junior_developer'
    and created_by = auth.uid()
    and status in ('draft', 'pending_review')
    and public.portal_can_access_document(document_id)
  )
  with check (
    public.current_user_role() = 'junior_developer'
    and created_by = auth.uid()
    and status in ('draft', 'pending_review')
    and public.portal_can_access_document(document_id)
  );
create policy "Senior can update revisions"
  on public.document_revisions for update to authenticated
  using (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_document(document_id)
  )
  with check (
    public.current_user_role() = 'senior_dev_pm'
    and public.portal_can_access_document(document_id)
  );

-- Review metadata follows the document it belongs to.
drop policy if exists "Staff can view approvals" on public.approvals;
create policy "Portal approval read"
  on public.approvals for select to authenticated
  using (
    public.portal_can_access_document((
      select r.document_id
      from public.document_revisions r
      where r.id = revision_id
    ))
  );

-- A junior may see only their own assignment; seniors and admins see the matrix.
drop policy if exists "Staff can view assignments" on public.assignments;
create policy "Portal assignment read"
  on public.assignments for select to authenticated
  using (
    public.is_administrator()
    or public.current_user_role() = 'senior_dev_pm'
    or (
      public.current_user_role() = 'junior_developer'
      and developer_user_id = auth.uid()
    )
  );

-- Clients belong to the same project scope.
drop policy if exists "Allow authenticated select clients" on public.clients;
drop policy if exists "Staff can view clients" on public.clients;
drop policy if exists "pts: staff read clients" on public.clients;
drop policy if exists "Junior or Senior can edit clients" on public.clients;
create policy "Portal client read"
  on public.clients for select to authenticated
  using (public.portal_can_access_client(id));
create policy "Junior can edit assigned clients"
  on public.clients for update to authenticated
  using (
    public.current_user_role() = 'junior_developer'
    and public.portal_can_access_client(id)
  )
  with check (
    public.current_user_role() = 'junior_developer'
    and public.portal_can_access_client(id)
  );
create policy "Senior can edit clients"
  on public.clients for update to authenticated
  using (public.current_user_role() = 'senior_dev_pm')
  with check (public.current_user_role() = 'senior_dev_pm');

-- Live database drift: the version history table is referenced by the app but
-- was never created. Restore it without duplicating any document status model.
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  revision_id uuid references public.document_revisions(id) on delete set null,
  version_no integer not null,
  title text not null,
  content text,
  change_summary text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

create index if not exists document_versions_document_id_idx
  on public.document_versions (document_id);

alter table public.document_versions enable row level security;
drop policy if exists "Portal document version read" on public.document_versions;
drop policy if exists "Senior can manage document versions" on public.document_versions;
drop policy if exists "Staff can view document versions" on public.document_versions;
create policy "Portal document version read"
  on public.document_versions for select to authenticated
  using (
    public.is_administrator()
    or public.portal_can_access_document(document_id)
  );
create policy "Senior can manage document versions"
  on public.document_versions for all to authenticated
  using (public.current_user_role() = 'senior_dev_pm')
  with check (public.current_user_role() = 'senior_dev_pm');
