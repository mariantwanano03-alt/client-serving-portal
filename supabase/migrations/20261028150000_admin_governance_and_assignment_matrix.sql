-- ==========================================================================
-- Phase 4: Administrator governance, project assignment matrix and
-- project-scoped approval authority.
--
-- 4.1 Administrators get global read visibility over clients, projects and
--     documents (plus the supporting project records).
-- 4.2 Project staffing moves to the Admin console:
--       - exactly one active Lead Senior Developer / PM per project
--       - multiple active delivery developers
-- 4.3 Approval authority is delegated per project assignment. The lead always
--     holds it; an Administrator may grant/revoke it for other Senior PMs.
--     Reassigning the lead automatically transfers authority.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Extend assignments into a project assignment matrix
-- --------------------------------------------------------------------------
alter table public.assignments
  add column if not exists assignment_role text not null default 'developer',
  add column if not exists approval_authority boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id);

alter table public.assignments
  drop constraint if exists assignments_assignment_role_check;
alter table public.assignments
  add constraint assignments_assignment_role_check
  check (assignment_role in ('lead', 'developer'));

-- Remove legacy blank assignments and duplicate rows created by the old UI.
delete from public.assignments where developer_user_id is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, developer_user_id
      order by assigned_at asc, id asc
    ) as row_no
  from public.assignments
)
delete from public.assignments a
using ranked r
where a.id = r.id
  and r.row_no > 1;

-- Backfill: the earliest assigned Senior PM becomes the lead for each project.
with lead_candidates as (
  select distinct on (a.project_id) a.id
  from public.assignments a
  join public.profiles p on p.id = a.developer_user_id
  where p.role = 'senior_dev_pm'
    and p.is_active
    and a.is_active
  order by a.project_id, a.assigned_at asc, a.id asc
)
update public.assignments a
set assignment_role = 'lead',
    approval_authority = true
from lead_candidates c
where a.id = c.id;

-- Every other assignment is a delivery assignment.
update public.assignments
set assignment_role = 'developer',
    approval_authority = false
where assignment_role = 'lead'
  and id not in (
    select distinct on (project_id) id
    from public.assignments
    where assignment_role = 'lead'
    order by project_id, assigned_at asc
  );

create unique index if not exists assignments_one_active_lead_per_project
  on public.assignments (project_id)
  where assignment_role = 'lead' and is_active;

create unique index if not exists assignments_one_active_user_per_project
  on public.assignments (project_id, developer_user_id)
  where is_active and developer_user_id is not null;

-- --------------------------------------------------------------------------
-- 2. Assignment invariants
--    - one active lead per project
--    - the lead must be a Senior PM and always has approval authority
--    - only a Senior PM may hold delegated approval authority
--    - inactive assignments never carry approval authority
-- --------------------------------------------------------------------------
create or replace function public.enforce_assignment_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role user_role;
begin
  if new.developer_user_id is null then
    raise exception 'An assignment must reference a team member';
  end if;

  -- Deactivation must always be possible, even if the member has since been
  -- suspended or moved to another role.
  if not new.is_active then
    new.approval_authority := false;
    return new;
  end if;

  select role into member_role
  from public.profiles
  where id = new.developer_user_id
    and is_active;

  if member_role is null then
    raise exception 'The assigned team member is not active';
  end if;

  if new.assignment_role = 'lead' then
    if member_role <> 'senior_dev_pm' then
      raise exception 'The project lead must be a Senior Developer / PM';
    end if;

    update public.assignments
    set is_active = false,
        approval_authority = false,
        revoked_at = now(),
        revoked_by = auth.uid()
    where project_id = new.project_id
      and id <> new.id
      and assignment_role = 'lead'
      and is_active;

    new.approval_authority := true;
  elsif new.approval_authority and member_role <> 'senior_dev_pm' then
    raise exception 'Only a Senior Developer / PM can hold approval authority';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_assignment_matrix on public.assignments;
create trigger enforce_assignment_matrix
before insert or update on public.assignments
for each row execute function public.enforce_assignment_matrix();

-- If a lead is demoted away from Senior PM, remove their lead assignment so
-- the project cannot retain a stale approver.
create or replace function public.enforce_lead_role_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'senior_dev_pm' and new.role <> 'senior_dev_pm' then
    update public.assignments
    set is_active = false,
        approval_authority = false,
        revoked_at = now(),
        revoked_by = auth.uid()
    where developer_user_id = new.id
      and assignment_role = 'lead'
      and is_active;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_lead_role_on_profile_change on public.profiles;
create trigger enforce_lead_role_on_profile_change
after update of role on public.profiles
for each row execute function public.enforce_lead_role_on_profile_change();

-- --------------------------------------------------------------------------
-- 3. Project-scoped authority helpers
-- --------------------------------------------------------------------------
create or replace function public.is_administrator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(current_user_role() = 'administrator', false)
$$;

create or replace function public.can_approve_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.assignments a
    join public.profiles p on p.id = a.developer_user_id
    where a.project_id = p_project_id
      and a.developer_user_id = auth.uid()
      and a.is_active
      and a.approval_authority
      and p.role = 'senior_dev_pm'
      and p.is_active
  )
$$;

create or replace function public.can_approve_document(p_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and public.can_approve_project(d.project_id)
  )
$$;

create or replace function public.can_approve_revision(p_revision_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.document_revisions dr
    join public.documents d on d.id = dr.document_id
    where dr.id = p_revision_id
      and public.can_approve_project(d.project_id)
  )
$$;

create or replace function public.can_approve_quotation(p_quotation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.quotations q
    where q.id = p_quotation_id
      and public.can_approve_project(q.project_id)
  )
$$;

create or replace function public.can_approve_readiness_check(p_readiness_check_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.readiness_checks rc
    where rc.id = p_readiness_check_id
      and public.can_approve_project(rc.project_id)
  )
$$;

-- --------------------------------------------------------------------------
-- 4. Admin-only assignment operations
-- --------------------------------------------------------------------------
create or replace function public.assign_project_lead(p_project_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_id uuid;
  member_role user_role;
begin
  if not public.is_administrator() then
    raise exception 'Only an Administrator can assign a project lead';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  select role into member_role
  from public.profiles
  where id = p_user_id
    and is_active;

  if member_role is null then
    raise exception 'The selected team member is not active';
  end if;

  if member_role <> 'senior_dev_pm' then
    raise exception 'The project lead must be a Senior Developer / PM';
  end if;

  select id into assignment_id
  from public.assignments
  where project_id = p_project_id
    and developer_user_id = p_user_id
    and is_active;

  if assignment_id is not null then
    update public.assignments
    set assignment_role = 'lead',
        approval_authority = true,
        assigned_by = auth.uid(),
        assigned_at = now(),
        revoked_at = null,
        revoked_by = null
    where id = assignment_id;
  else
    insert into public.assignments (
      project_id,
      developer_user_id,
      assigned_by,
      assignment_role,
      approval_authority,
      is_active
    ) values (
      p_project_id,
      p_user_id,
      auth.uid(),
      'lead',
      true,
      true
    )
    returning id into assignment_id;
  end if;

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(),
    'project.lead_assigned',
    'project',
    p_project_id,
    jsonb_build_object('lead_user_id', p_user_id, 'assignment_id', assignment_id)
  );

  return assignment_id;
end;
$$;

create or replace function public.assign_project_developer(p_project_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_id uuid;
  member_role user_role;
begin
  if not public.is_administrator() then
    raise exception 'Only an Administrator can assign project developers';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  select role into member_role
  from public.profiles
  where id = p_user_id
    and is_active;

  if member_role is null then
    raise exception 'The selected team member is not active';
  end if;

  if member_role not in ('junior_developer', 'senior_dev_pm') then
    raise exception 'Only a Junior Developer or Senior Developer / PM can be assigned';
  end if;

  if exists (
    select 1
    from public.assignments
    where project_id = p_project_id
      and developer_user_id = p_user_id
      and assignment_role = 'lead'
      and is_active
  ) then
    raise exception 'This team member is already the project lead';
  end if;

  select id into assignment_id
  from public.assignments
  where project_id = p_project_id
    and developer_user_id = p_user_id
    and is_active;

  if assignment_id is not null then
    update public.assignments
    set assignment_role = 'developer',
        assigned_by = auth.uid(),
        assigned_at = now(),
        revoked_at = null,
        revoked_by = null
    where id = assignment_id;
  else
    insert into public.assignments (
      project_id,
      developer_user_id,
      assigned_by,
      assignment_role,
      approval_authority,
      is_active
    ) values (
      p_project_id,
      p_user_id,
      auth.uid(),
      'developer',
      false,
      true
    )
    returning id into assignment_id;
  end if;

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(),
    'project.developer_assigned',
    'project',
    p_project_id,
    jsonb_build_object('developer_user_id', p_user_id, 'assignment_id', assignment_id)
  );

  return assignment_id;
end;
$$;

create or replace function public.set_project_approval_authority(
  p_assignment_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_record record;
  member_role user_role;
begin
  if not public.is_administrator() then
    raise exception 'Only an Administrator can delegate approval authority';
  end if;

  select a.assignment_role, a.is_active, a.project_id, a.developer_user_id
  into assignment_record
  from public.assignments a
  where a.id = p_assignment_id;

  if assignment_record is null then
    raise exception 'Assignment not found';
  end if;

  if not assignment_record.is_active then
    raise exception 'This assignment is no longer active';
  end if;

  if assignment_record.assignment_role = 'lead' and not p_enabled then
    raise exception 'The project lead always holds approval authority; reassign the lead instead';
  end if;

  select role into member_role
  from public.profiles
  where id = assignment_record.developer_user_id
    and is_active;

  if p_enabled and member_role <> 'senior_dev_pm' then
    raise exception 'Only a Senior Developer / PM can hold approval authority';
  end if;

  update public.assignments
  set approval_authority = p_enabled
  where id = p_assignment_id;

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(),
    case
      when p_enabled then 'project.approval_authority_granted'
      else 'project.approval_authority_revoked'
    end,
    'project',
    assignment_record.project_id,
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'developer_user_id', assignment_record.developer_user_id,
      'approval_authority', p_enabled
    )
  );
end;
$$;

create or replace function public.remove_project_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_record record;
begin
  if not public.is_administrator() then
    raise exception 'Only an Administrator can remove project assignments';
  end if;

  select assignment_role, is_active, project_id, developer_user_id
  into assignment_record
  from public.assignments
  where id = p_assignment_id;

  if assignment_record is null then
    raise exception 'Assignment not found';
  end if;

  if assignment_record.assignment_role = 'lead' then
    raise exception 'Reassign the project lead before removing this assignment';
  end if;

  update public.assignments
  set is_active = false,
      approval_authority = false,
      revoked_at = now(),
      revoked_by = auth.uid()
  where id = p_assignment_id;

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(),
    'project.assignment_removed',
    'project',
    assignment_record.project_id,
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'developer_user_id', assignment_record.developer_user_id
    )
  );
end;
$$;

-- --------------------------------------------------------------------------
-- 5. Administrator global read visibility
-- --------------------------------------------------------------------------
do $$
declare
  table_name text;
  admin_tables text[] := array[
    'clients',
    'client_contacts',
    'projects',
    'project_stage_history',
    'discovery_records',
    'attachments',
    'requirements',
    'requirement_versions',
    'documents',
    'document_revisions',
    'reviews',
    'approvals',
    'quotations',
    'quotation_line_items',
    'slas',
    'purchase_orders',
    'deposits',
    'payment_confirmations',
    'readiness_checks',
    'readiness_items',
    'handovers',
    'development_links',
    'ai_requests'
  ];
begin
  foreach table_name in array admin_tables loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Admins can view ' || table_name,
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_administrator())',
      'Admins can view ' || table_name,
      table_name
    );
  end loop;
end;
$$;

-- Admin governance over the records the Admin console edits directly.
drop policy if exists "Admins can manage clients" on public.clients;
create policy "Admins can manage clients"
  on public.clients for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "Admins can manage client contacts" on public.client_contacts;
create policy "Admins can manage client contacts"
  on public.client_contacts for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "Admins can manage projects" on public.projects;
create policy "Admins can manage projects"
  on public.projects for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "Admins can manage assignments" on public.assignments;
create policy "Admins can manage assignments"
  on public.assignments for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- --------------------------------------------------------------------------
-- 6. Replace global Senior PM authority with project-scoped authority
-- --------------------------------------------------------------------------
drop policy if exists "Senior can edit projects" on public.projects;
drop policy if exists "Senior can update projects" on public.projects;
drop policy if exists "Project approvers can update projects" on public.projects;
create policy "Project approvers can update projects"
  on public.projects for update to authenticated
  using (public.can_approve_project(id))
  with check (public.can_approve_project(id));

drop policy if exists "Senior can update requirements" on public.requirements;
drop policy if exists "Project approvers can update requirements" on public.requirements;
create policy "Project approvers can update requirements"
  on public.requirements for update to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can delete requirements" on public.requirements;
drop policy if exists "Project approvers can delete requirements" on public.requirements;
create policy "Project approvers can delete requirements"
  on public.requirements for delete to authenticated
  using (public.can_approve_project(project_id));

drop policy if exists "Senior can update documents" on public.documents;
drop policy if exists "Project approvers can update documents" on public.documents;
create policy "Project approvers can update documents"
  on public.documents for update to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can delete documents" on public.documents;
drop policy if exists "Project approvers can delete documents" on public.documents;
create policy "Project approvers can delete documents"
  on public.documents for delete to authenticated
  using (public.can_approve_project(project_id));

drop policy if exists "Senior can update revisions" on public.document_revisions;
drop policy if exists "Project approvers can update revisions" on public.document_revisions;
create policy "Project approvers can update revisions"
  on public.document_revisions for update to authenticated
  using (public.can_approve_document(document_id))
  with check (public.can_approve_document(document_id));

drop policy if exists "Senior can create approvals" on public.approvals;
drop policy if exists "Project approvers can create approvals" on public.approvals;
create policy "Project approvers can create approvals"
  on public.approvals for insert to authenticated
  with check (
    public.can_approve_revision(revision_id)
    and approver_id = auth.uid()
  );

drop policy if exists "Senior can manage quotations" on public.quotations;
drop policy if exists "Senior can insert quotations" on public.quotations;
drop policy if exists "Project approvers can manage quotations" on public.quotations;
create policy "Project approvers can manage quotations"
  on public.quotations for all to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can manage quotation lines" on public.quotation_line_items;
drop policy if exists "Senior can insert quotation lines" on public.quotation_line_items;
drop policy if exists "Project approvers can manage quotation lines" on public.quotation_line_items;
create policy "Project approvers can manage quotation lines"
  on public.quotation_line_items for all to authenticated
  using (public.can_approve_quotation(quotation_id))
  with check (public.can_approve_quotation(quotation_id));

drop policy if exists "Senior can manage slas" on public.slas;
drop policy if exists "Project approvers can manage slas" on public.slas;
create policy "Project approvers can manage slas"
  on public.slas for all to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can manage purchase orders" on public.purchase_orders;
drop policy if exists "Senior can insert purchase orders" on public.purchase_orders;
drop policy if exists "Project approvers can manage purchase orders" on public.purchase_orders;
create policy "Project approvers can manage purchase orders"
  on public.purchase_orders for all to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can manage deposits" on public.deposits;
drop policy if exists "Senior can insert deposits" on public.deposits;
drop policy if exists "Project approvers can manage deposits" on public.deposits;
create policy "Project approvers can manage deposits"
  on public.deposits for all to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can confirm payments" on public.payment_confirmations;
drop policy if exists "Senior can manage payment confirmations" on public.payment_confirmations;
drop policy if exists "Project approvers can manage payment confirmations" on public.payment_confirmations;
create policy "Project approvers can manage payment confirmations"
  on public.payment_confirmations for all to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior or system can run readiness" on public.readiness_checks;
drop policy if exists "Project approvers can run readiness" on public.readiness_checks;
create policy "Project approvers can run readiness"
  on public.readiness_checks for insert to authenticated
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can manage readiness items" on public.readiness_items;
drop policy if exists "Senior can insert readiness items" on public.readiness_items;
drop policy if exists "Project approvers can manage readiness items" on public.readiness_items;
create policy "Project approvers can manage readiness items"
  on public.readiness_items for all to authenticated
  using (public.can_approve_readiness_check(readiness_check_id))
  with check (public.can_approve_readiness_check(readiness_check_id));

drop policy if exists "Senior can insert handovers" on public.handovers;
drop policy if exists "Senior can update handovers" on public.handovers;
drop policy if exists "Staff can create handovers" on public.handovers;
drop policy if exists "Project approvers can create handovers" on public.handovers;
create policy "Project approvers can create handovers"
  on public.handovers for insert to authenticated
  with check (public.can_approve_project(project_id));

drop policy if exists "Project approvers can update handovers" on public.handovers;
create policy "Project approvers can update handovers"
  on public.handovers for update to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can verify development links" on public.development_links;
drop policy if exists "Project approvers can verify development links" on public.development_links;
create policy "Project approvers can verify development links"
  on public.development_links for update to authenticated
  using (public.can_approve_project(project_id))
  with check (public.can_approve_project(project_id));

drop policy if exists "Senior can manage stage history" on public.project_stage_history;
drop policy if exists "Senior can insert stage history" on public.project_stage_history;
drop policy if exists "Project approvers can insert stage history" on public.project_stage_history;
create policy "Project approvers can insert stage history"
  on public.project_stage_history for insert to authenticated
  with check (public.can_approve_project(project_id));

-- Assignments are now an Administrator responsibility.
drop policy if exists "Senior can manage assignments" on public.assignments;
drop policy if exists "Senior can insert assignments" on public.assignments;

-- --------------------------------------------------------------------------
-- 7. Demo: make the Junior test account part of the ACME project team so the
--    reporting line is visible immediately. Safe/no-op if the demo rows are
--    absent (for example in a fresh environment).
-- --------------------------------------------------------------------------
do $$
declare
  demo_project_id uuid;
  junior_id uuid;
  admin_id uuid;
begin
  select id into demo_project_id
  from public.projects
  where project_reference = 'PRJ-ACME-01';

  select p.id into junior_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = 'junior@test.com'
    and p.role = 'junior_developer';

  select p.id into admin_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = 'admin@test.com';

  if demo_project_id is not null and junior_id is not null then
    insert into public.assignments (
      project_id,
      developer_user_id,
      assigned_by,
      assignment_role,
      approval_authority,
      is_active
    )
    select
      demo_project_id,
      junior_id,
      admin_id,
      'developer',
      false,
      true
    where not exists (
      select 1
      from public.assignments
      where project_id = demo_project_id
        and developer_user_id = junior_id
        and is_active
    );
  end if;
end;
$$;
