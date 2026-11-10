-- ==========================================================================
-- Seed admin@test.com and senior@test.com into auth.users + profiles
-- ==========================================================================

-- 1. admin@test.com (Administrator)
insert into auth.users (
  instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'admin@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Administrator", "role": "administrator"}'::jsonb,
  'authenticated', 'authenticated', now(), now()
) on conflict (email) do nothing;

-- 2. senior@test.com (Senior Dev / PM)
insert into auth.users (
  instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'senior@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Senior PM", "role": "senior_dev_pm"}'::jsonb,
  'authenticated', 'authenticated', now(), now()
) on conflict (email) do nothing;

-- 3. Ensure profiles exist for both (idempotent)
insert into public.profiles (id, full_name, role, is_active)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  case
    when u.email = 'admin@test.com' then 'administrator'::user_role
    when u.email = 'senior@test.com' then 'senior_dev_pm'::user_role
    else 'junior_developer'::user_role
  end,
  true
from auth.users u
where u.email in ('admin@test.com', 'senior@test.com')
  and not exists (
    select 1 from public.profiles p where p.id = u.id
  );
