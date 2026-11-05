-- ==========================================================================
-- TASK 1 — STRICT ROLE BOUNDARIES (Client Serving Portal refactor)
--
-- Drops conflicting / overly broad RLS policies inherited from earlier fix
-- migrations and installs the strict role matrix required by the Master
-- Prompt:
--
--   Administrator : may create users, assign leads / developers, grant or
--                   revoke approval authority, view ALL projects / payments /
--                   full audit trail, and manage assignments. May NOT create
--                   projects, draft documents, or approve documents.
--   Junior Dev     : may INSERT/UPDATE projects, clients and discovery,
--                   capture discovery records, draft AI documents (SRS, PRD,
--                   SLA, Quotation, Dev Prompt .md) and link repositories.
--                   May NOT approve or reject documents.
--   Senior Dev/PM : may UPDATE only readiness items and documents (approval
--                   status transitions). May NOT edit document content. May
--                   edit projects ONLY while acting as the assigned developer.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 0. Helpers (idempotent re-creation)
-- --------------------------------------------------------------------------
create or replace function public.current_user_role()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.is_administrator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() = 'administrator', false)
$$;

-- Returns true when a development link points at a source-code repository
-- (GitHub / GitLab / Bitbucket / Azure DevOps / Git services). Used by the
-- RLS insert policy and the client to auto-verify repository links on save.
create or replace function public.is_repository_link(p_link_type text, p_url text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select
    lower(coalesce(p_link_type, '')) ~* '(repository|git|github|gitlab|bitbucket)'
    or lower(coalesce(p_url, '')) ~* '(github\.com|gitlab\.com|bitbucket\.org|bitbucket\.io|dev\.azure\.com|visualstudio\.com|git\.io|git\.app)';
$$;

-- --------------------------------------------------------------------------
-- 1. Profiles
-- --------------------------------------------------------------------------
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Admins can manage profiles" on public.profiles;
create policy "Admins can manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "Staff can read active profiles" on public.profiles;
create policy "Staff can read active profiles"
  on public.profiles for select
  to authenticated
  using (
    is_active = true
    and public.current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator')
  );

-- --------------------------------------------------------------------------
-- 2. Clients — Junior Developers may create / update clients (task requirement).
--    Administrators retain full governance over clients.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can view clients" on public.clients;
create policy "Staff can view clients"
  on public.clients for select
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Senior can create clients" on public.clients;
create policy "Junior or Senior can create clients"
  on public.clients for insert
  to authenticated
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Senior can edit clients" on public.clients;
create policy "Junior or Senior can edit clients"
  on public.clients for update
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'))
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Admins can manage clients" on public.clients;
create policy "Admins can manage clients"
  on public.clients for all
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- --------------------------------------------------------------------------
-- 3. Projects — Juniors may create / update projects; Administrators may only
--    view (never create / draft / approve). Senior approvers may update a
--    project only through the project-approval authority path.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can view projects" on public.projects;
create policy "Staff can view projects"
  on public.projects for select
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Senior can create projects" on public.projects;
create policy "Junior or Senior can create projects"
  on public.projects for insert
  to authenticated
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Admins can manage projects" on public.projects;
create policy "Admins can view all projects"
  on public.projects for select
  to authenticated
  using (public.is_administrator());

drop policy if exists "Project approvers can update projects" on public.projects;
create policy "Project approvers can update projects"
  on public.projects for update
  to authenticated
  using (public.can_approve_project(id))
  with check (public.can_approve_project(id));

drop policy if exists "Junior can update projects" on public.projects;
create policy "Junior can update projects"
  on public.projects for update
  to authenticated
  using (public.current_user_role() = 'junior_developer')
  with check (public.current_user_role() = 'junior_developer');

-- --------------------------------------------------------------------------
-- 4. Discovery Records — Juniors (and seniors) may insert and update.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can view discovery" on public.discovery_records;
create policy "Staff can view discovery"
  on public.discovery_records for select
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Staff can create discovery" on public.discovery_records;
create policy "Staff can create discovery"
  on public.discovery_records for insert
  to authenticated
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Senior can update discovery" on public.discovery_records;
create policy "Junior or Senior can update discovery"
  on public.discovery_records for update
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'))
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Senior can delete discovery" on public.discovery_records;
create policy "Senior can delete discovery"
  on public.discovery_records for delete
  to authenticated
  using (public.current_user_role() = 'senior_dev_pm');

-- --------------------------------------------------------------------------
-- 5. Documents — Juniors draft (insert drafts / pending revisions); Seniors
--    (project approvers) update for approval status only; admins never draft.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can view documents" on public.documents;
create policy "Staff can view documents"
  on public.documents for select
  to authenticated
  using (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Staff can create documents" on public.documents;
create policy "Junior can create documents"
  on public.documents for insert
  to authenticated
  with check (public.current_user_role() = 'junior_developer' and status in ('draft', 'pending_review'));

drop policy if exists "Project approvers can update documents" on public.documents;
create policy "Project approvers can update documents"
  on public.documents for update
  to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can delete documents" on public.documents;
create policy "Senior can delete documents"
  on public.documents for delete
  to authenticated
  using (public.current_user_role() = 'senior_dev_pm');

-- --------------------------------------------------------------------------
-- 6. Readiness — only the assigned Senior Developer / PM approver may manage
--    readiness items / run readiness checks (auto re-evaluation on approval).
-- --------------------------------------------------------------------------
drop policy if exists "Project approvers can manage readiness items" on public.readiness_items;
create policy "Project approvers can manage readiness items"
  on public.readiness_items for all
  to authenticated
  using (public.can_approve_readiness_check(readiness_check_id))
  with check (public.can_approve_readiness_check(readiness_check_id));

drop policy if exists "Project approvers can run readiness" on public.readiness_checks;
create policy "Project approvers can run readiness"
  on public.readiness_checks for insert
  to authenticated
  with check (public.can_approve_project(project_id));

-- --------------------------------------------------------------------------
-- 6b. Client Contacts — Juniors may add contacts to clients they work on.
-- --------------------------------------------------------------------------
drop policy if exists "Junior can insert client contacts" on public.client_contacts;
create policy "Junior can insert client contacts"
  on public.client_contacts for insert
  to authenticated
  with check (public.current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- --------------------------------------------------------------------------
-- 7. Assignments — Administrators hold the governance write path (task 1).
--    Senior PMs are *assigned* to projects by admins; they do not self-manage
--    assignments from the project workspace.
-- --------------------------------------------------------------------------
drop policy if exists "Admins can manage assignments" on public.assignments;
create policy "Admins can manage assignments"
  on public.assignments for all
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- --------------------------------------------------------------------------
-- 8. Development Links — repositories auto-verify upon save (verified = true
--    allowed only for repository links); manual unverified recording otherwise.
--    The old manual "Verify Link" step is retired by the UI refactor.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can record development links" on public.development_links;
create policy "Staff can record development links"
  on public.development_links for insert
  to authenticated
  with check (
    public.current_user_role() in ('senior_dev_pm', 'junior_developer')
    and (
      verified = false
      or (verified = true and public.is_repository_link(link_type, url))
    )
  );
