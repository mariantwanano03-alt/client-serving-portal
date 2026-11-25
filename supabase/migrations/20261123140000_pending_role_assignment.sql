-- Pending Role Assignment workflow.
--
-- The portal already stores the user's permission-bearing role in
-- `profiles.role` (user_role) and its effective access in `profiles.is_active`.
-- `is_active` is a boolean, so it cannot distinguish "awaiting role assignment"
-- from "suspended". This migration adds exactly one status column and reuses
-- the existing role, profile, trigger and audit structures. No new user table,
-- role table or authentication mechanism is introduced.

do $$
begin
  create type public.account_status as enum ('pending_role_assignment', 'active', 'suspended');
exception
  when duplicate_object then null;
end $$;

-- Add the column before setting its default so the backfill can distinguish
-- legacy rows (NULL) from genuine pending registrations. This keeps the file
-- safe to re-run: pending accounts are never overwritten with "suspended".
alter table public.profiles
  add column if not exists account_status public.account_status;

update public.profiles
   set account_status = case when is_active then 'active'::public.account_status
                             else 'suspended'::public.account_status
                        end
 where account_status is null;

alter table public.profiles
  alter column account_status set default 'pending_role_assignment',
  alter column account_status set not null;

-- Existing accounts retain their current role and effective access. New rows
-- use the column default (pending) until an administrator assigns a role.

-- Keep `is_active` and `account_status` consistent for every writer: the
-- registration trigger, the audited admin endpoint, and direct RLS updates.
-- An explicit status change wins; otherwise an is_active change maps to
-- active/suspended so legacy callers cannot accidentally bypass the workflow.
create or replace function public.sync_profile_account_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- On INSERT there is no OLD record; the status column is authoritative so a
  -- pending row can never be inserted as active by a legacy caller.
  if tg_op = 'INSERT' then
    new.is_active := (new.account_status = 'active');
    return new;
  end if;

  if new.account_status is distinct from old.account_status then
    new.is_active := (new.account_status = 'active');
  elsif new.is_active is distinct from old.is_active then
    new.account_status := case when new.is_active then 'active'::public.account_status
                               else 'suspended'::public.account_status
                          end;
  end if;
  return new;
end $$;

drop trigger if exists sync_profile_account_status on public.profiles;
create trigger sync_profile_account_status
  before insert or update of is_active, account_status on public.profiles
  for each row execute function public.sync_profile_account_status();

-- A pending account has no usable role. Every existing RLS policy and API gate
-- that calls current_user_role() therefore denies access until activation.
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
    from public.profiles
   where id = auth.uid()
     and is_active = true
     and account_status = 'active'
$$;

-- Registration: keep the seeded test accounts active so local/demo seeding is
-- unchanged, but make every genuinely new account pending. The default role is
-- still junior_developer and cannot be supplied by the signup form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_status public.account_status;
  v_created uuid;
begin
  v_role := case
    when new.email = 'admin@test.com' then 'administrator'::public.user_role
    when new.email = 'senior@test.com' then 'senior_dev_pm'::public.user_role
    else 'junior_developer'::public.user_role
  end;
  v_status := case when new.email in ('admin@test.com', 'senior@test.com')
                   then 'active'::public.account_status
                   else 'pending_role_assignment'::public.account_status
              end;

  insert into public.profiles (id, full_name, role, is_active, account_status, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    v_role,
    v_status = 'active',
    v_status,
    new.email
  )
  on conflict (id) do nothing
  returning id into v_created;

  -- Reuse the existing audit table. These entries record the default role and
  -- pending status exactly as they were applied by the system.
  if v_created is not null then
    insert into public.audit_entries (
      actor_user_id, action, entity_type, entity_id, before_value, after_value
    ) values (
      v_created, 'user.registered', 'profile', v_created,
      '{}'::jsonb,
      jsonb_build_object('role', v_role, 'account_status', v_status, 'email', new.email)
    );
    insert into public.audit_entries (
      actor_user_id, action, entity_type, entity_id, before_value, after_value
    ) values (
      v_created, 'user.default_role_assigned', 'profile', v_created,
      '{}'::jsonb,
      jsonb_build_object('role', v_role, 'account_status', v_status)
    );
  end if;

  return new;
end $$;

comment on column public.profiles.account_status is
  'Account status, independent of role: pending_role_assignment, active, or suspended.';
