-- ==========================================================================
-- Seed Additional Developer Team Members
-- ==========================================================================

-- 1. Alex Rivers (Junior Developer)
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'junior@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Alex Rivers", "role": "junior_developer"}'::jsonb,
  'authenticated',
  'authenticated',
  now(),
  now()
where not exists (select 1 from auth.users where email = 'junior@test.com');

-- 2. Marcus Vance (Junior Developer)
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'marcus@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Marcus Vance", "role": "junior_developer"}'::jsonb,
  'authenticated',
  'authenticated',
  now(),
  now()
where not exists (select 1 from auth.users where email = 'marcus@test.com');

-- 3. Elena Rostova (Senior Dev / PM)
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'elena@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Elena Rostova", "role": "senior_dev_pm"}'::jsonb,
  'authenticated',
  'authenticated',
  now(),
  now()
where not exists (select 1 from auth.users where email = 'elena@test.com');

-- Ensure profiles are synchronized for all new users
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
where u.email in ('junior@test.com', 'marcus@test.com', 'elena@test.com')
on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = true;

