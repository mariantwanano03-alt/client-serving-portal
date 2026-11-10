-- ==========================================================================
-- Fix handle_new_user trigger to assign correct roles for admin/senior emails
-- ==========================================================================

-- Fix any existing profiles for admin@test.com and senior@test.com
update public.profiles p
set
  role = 'administrator',
  is_active = true,
  full_name = coalesce(nullif(p.full_name, ''), 'Administrator')
from auth.users u
where u.id = p.id
  and u.email = 'admin@test.com';

update public.profiles p
set
  role = 'senior_dev_pm',
  is_active = true,
  full_name = coalesce(nullif(p.full_name, ''), 'Senior PM')
from auth.users u
where u.id = p.id
  and u.email = 'senior@test.com';

-- Insert profiles for admin@test.com / senior@test.com if they exist in auth.users but lack a profile
insert into public.profiles (id, full_name, role, is_active)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  case
    when u.email = 'admin@test.com' then 'administrator'::user_role
    when u.email = 'senior@test.com' then 'senior_dev_pm'::user_role
    else coalesce((u.raw_user_meta_data->>'role')::user_role, 'junior_developer'::user_role)
  end,
  true
from auth.users u
where u.email in ('admin@test.com', 'senior@test.com')
  and not exists (
    select 1 from public.profiles p where p.id = u.id
  );

drop trigger if exists on_auth_user_created on auth.users;

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
    case
      when new.email = 'admin@test.com' then 'administrator'::user_role
      when new.email = 'senior@test.com' then 'senior_dev_pm'::user_role
      else coalesce(
        (new.raw_user_meta_data->>'role')::user_role,
        'junior_developer'::user_role
      )
    end,
    true
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
      full_name = coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
