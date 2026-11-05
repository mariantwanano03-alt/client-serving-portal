-- ==========================================================================
-- AUTO-ASSIGN PROJECT CREATOR AS DEVELOPER
--
-- When a Junior Developer (or anyone) creates a project, they are
-- automatically assigned as that project's Developer so they can edit it.
-- An Administrator still separately assigns a Senior Developer / PM as the
-- project Lead / Approver via the Assignments tab.
-- ==========================================================================

create or replace function public.auto_assign_project_creator_as_developer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role user_role;
begin
  -- Only auto-assign when a profile created the project.
  if new.created_by is null then
    return new;
  end if;

  select role into member_role
  from public.profiles
  where id = new.created_by
    and is_active;

  -- Skip if the creator is not an active team member.
  if member_role is null then
    return new;
  end if;

  -- Avoid duplicate assignments.
  if exists (
    select 1 from public.assignments
    where project_id = new.id
      and developer_user_id = new.created_by
      and is_active
  ) then
    return new;
  end if;

  insert into public.assignments (
    project_id,
    developer_user_id,
    assigned_by,
    assignment_role,
    approval_authority,
    is_active
  ) values (
    new.id,
    new.created_by,
    new.created_by,
    'developer',
    false,
    true
  );

  insert into public.audit_entries (
    actor_user_id, action, entity_type, entity_id, after_value
  ) values (
    new.created_by,
    'project.developer_assigned',
    'project',
    new.id,
    jsonb_build_object('developer_user_id', new.created_by, 'auto_assigned', true)
  );

  return new;
end;
$$;

drop trigger if exists trg_auto_assign_project_creator on public.projects;
create trigger trg_auto_assign_project_creator
after insert on public.projects
for each row execute function public.auto_assign_project_creator_as_developer();
