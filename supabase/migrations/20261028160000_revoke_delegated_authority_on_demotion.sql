-- ==========================================================================
-- Harden the project assignment matrix.
--
-- When a Senior Developer / PM is demoted away from the senior role, revoke
-- any delegated approval authority immediately. Lead assignments are removed
-- entirely; delivery assignments remain active but lose approval authority.
-- This keeps the database invariant that only an active Senior PM can hold
-- approval authority, even if the profile is later promoted again.
-- ==========================================================================

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

    update public.assignments
    set approval_authority = false
    where developer_user_id = new.id
      and assignment_role = 'developer'
      and approval_authority;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_lead_role_on_profile_change on public.profiles;
create trigger enforce_lead_role_on_profile_change
after update of role on public.profiles
for each row execute function public.enforce_lead_role_on_profile_change();
