-- ==========================================================================
-- Add email column to profiles for user delete/re-add workflow
-- ==========================================================================

-- Add email column to profiles
alter table profiles
  add column if not exists email text;

-- Backfill email from auth.users
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

-- Create index for email lookups
create index if not exists idx_profiles_email on profiles(email);

-- Also update the handle_new_user trigger to store email
drop trigger if exists on_auth_user_created on auth.users;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case
      when new.email = 'admin@test.com' then 'administrator'::user_role
      when new.email = 'senior@test.com' then 'senior_dev_pm'::user_role
      else coalesce(
        (new.raw_user_meta_data->>'role')::user_role,
        'junior_developer'::user_role
      )
    end,
    true,
    new.email
  )
  on conflict (id) do update
    set
      role = case
        when new.email = 'admin@test.com' then 'administrator'::user_role
        when new.email = 'senior@test.com' then 'senior_dev_pm'::user_role
        else coalesce(
          (new.raw_user_meta_data->>'role')::user_role,
          'junior_developer'::user_role
        )
      end,
      is_active = true,
      full_name = coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
      email = new.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
