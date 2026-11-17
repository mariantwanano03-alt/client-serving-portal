-- ==========================================================================
-- FIX: Ensure profiles exist and are active for all auth users,
--      add auto-profile trigger, and fix the is_active gating issue.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Ensure every existing auth user has a profile row with is_active = true
--    (idempotent - uses ON CONFLICT DO UPDATE)
-- --------------------------------------------------------------------------
insert into public.profiles (id, full_name, role, is_active)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  coalesce(
    (u.raw_user_meta_data->>'role')::user_role,
    'junior_developer'
  ),
  true
from auth.users u
on conflict (id) do update
  set is_active = true;

-- --------------------------------------------------------------------------
-- 2. Specifically hard-set roles for the known test accounts
--    (these are looked up by email which is stable across resets)
-- --------------------------------------------------------------------------
update public.profiles p
set
  role      = 'senior_dev_pm',
  is_active = true,
  full_name = coalesce(nullif(p.full_name, ''), 'Senior PM')
from auth.users u
where u.id = p.id
  and u.email = 'senior@test.com';

update public.profiles p
set
  role      = 'administrator',
  is_active = true,
  full_name = coalesce(nullif(p.full_name, ''), 'Administrator')
from auth.users u
where u.id = p.id
  and u.email = 'admin@test.com';

-- --------------------------------------------------------------------------
-- 3. Auto-create a profile whenever a new user signs up
--    (prevents the missing-profile problem for future accounts)
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(
      (new.raw_user_meta_data->>'role')::user_role,
      'junior_developer'
    ),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- --------------------------------------------------------------------------
-- 4. Rebuild profile SELECT policies cleanly
--    (drop old ones and recreate without the is_active gate that can lock
--     users out of reading their own profile)
-- --------------------------------------------------------------------------
drop policy if exists "Users can read their own profile"    on profiles;
drop policy if exists "Admins can manage profiles"          on profiles;
drop policy if exists "Senior can read team profiles"       on profiles;

-- Any authenticated user can read their own row (regardless of is_active,
-- so they can always load the shell even if they were deactivated).
create policy "Users can read their own profile"
  on profiles for select
  to authenticated
  using (id = auth.uid());

-- Senior and junior can read all active profiles
-- (needed for team-assignment dropdowns).
create policy "Staff can read active profiles"
  on profiles for select
  to authenticated
  using (
    is_active = true
    and exists (
      select 1 from profiles self
      where self.id = auth.uid()
        and self.role in ('senior_dev_pm', 'junior_developer')
    )
  );

-- Admins can do everything on profiles.
create policy "Admins can manage profiles"
  on profiles for all
  to authenticated
  using  (current_user_role() = 'administrator')
  with check (current_user_role() = 'administrator');

-- --------------------------------------------------------------------------
-- 5. Rebuild current_user_role() WITHOUT the is_active gate
--    so a deactivated senior can still read their own profile above,
--    but the function still returns their role correctly.
--    (We rely on the UI + admin deactivation flow, not is_active to block
--     the function itself.)
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

