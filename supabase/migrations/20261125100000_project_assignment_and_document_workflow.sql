-- Project developer assignment + document approval hardening.
-- The existing assignment relationship is public.assignments; created_by on
-- projects is provenance only. The live database already carries an
-- auto-assignment trigger and an assignment matrix. This migration keeps one
-- canonical version of that trigger and closes direct-status updates that
-- bypassed the approval workflow.

-- 1. One active assignment per project. -------------------------------------
alter table public.assignments
  add column if not exists is_active boolean not null default true;

create unique index if not exists assignments_one_active_per_project
  on public.assignments (project_id) where is_active;

-- 2. Automatically assign the creator as the project developer. ------------
-- Canonical version of the pre-existing out-of-band trigger. Senior creators
-- receive lead/approval authority; junior creators receive developer access.
create or replace function public.auto_assign_project_creator_as_developer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role user_role;
begin
  if new.created_by is null then
    return new;
  end if;

  select role into member_role
  from public.profiles
  where id = new.created_by
    and is_active;

  -- Pending/suspended creators cannot hold a project assignment.
  if member_role is null then
    return new;
  end if;

  if exists (
    select 1 from public.assignments
    where project_id = new.id
      and developer_user_id = new.created_by
      and is_active
  ) then
    return new;
  end if;

  insert into public.assignments (
    project_id, developer_user_id, assigned_by,
    assignment_role, approval_authority, is_active
  ) values (
    new.id, new.created_by, new.created_by,
    case when member_role = 'senior_dev_pm' then 'lead' else 'developer' end,
    member_role = 'senior_dev_pm',
    true
  );

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    new.created_by, 'project.developer_assigned', 'project', new.id,
    jsonb_build_object(
      'developer_user_id', new.created_by,
      'assigned_by', new.created_by,
      'auto_assigned', true
    )
  );

  return new;
end;
$$;

-- Replace both the earlier local trigger and the out-of-band duplicate.
drop trigger if exists trg_assign_project_creator on public.projects;
drop trigger if exists trg_auto_assign_project_creator on public.projects;
create trigger trg_auto_assign_project_creator
  after insert on public.projects
  for each row execute function public.auto_assign_project_creator_as_developer();

drop function if exists public.assign_project_creator();

-- 3. Administrators can view assignments (oversight) but still cannot write.
drop policy if exists "Administrators can view assignments" on public.assignments;
create policy "Administrators can view assignments"
  on public.assignments for select to authenticated
  using (current_user_role() = 'administrator');

-- 4. Client deletion is senior-level authority, not junior authority.
drop policy if exists "Senior can delete clients" on public.clients;
drop policy if exists "Staff can delete clients" on public.clients;
create policy "Senior can delete clients"
  on public.clients for delete to authenticated
  using (current_user_role() = 'senior_dev_pm');

-- 5. Approval cannot be bypassed by writing status directly. ---------------
create or replace function public.enforce_document_approval_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and not exists (
       select 1
       from public.approvals a
       join public.document_revisions r on r.id = a.revision_id
       where r.document_id = new.id and a.decision = 'approved'
     ) then
    raise exception 'A document can only be approved through the review workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_document_approval on public.documents;
create trigger trg_enforce_document_approval
  before update on public.documents
  for each row execute function public.enforce_document_approval_on_update();

create or replace function public.enforce_revision_approval_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and not exists (
       select 1
       from public.approvals a
       where a.revision_id = new.id and a.decision = 'approved'
     ) then
    raise exception 'A revision can only be approved through the review workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_revision_approval on public.document_revisions;
create trigger trg_enforce_revision_approval
  before update on public.document_revisions
  for each row execute function public.enforce_revision_approval_on_update();
