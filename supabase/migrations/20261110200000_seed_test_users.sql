-- ==========================================================================
-- Seed admin@test.com and senior@test.com into auth.users + profiles
-- ==========================================================================

-- 1. admin@test.com (Administrator)
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
)
SELECT gen_random_uuid(), gen_random_uuid(), 'admin@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Administrator", "role": "administrator"}'::jsonb,
  'authenticated', 'authenticated', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@test.com');

-- 2. senior@test.com (Senior Dev / PM)
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
)
SELECT gen_random_uuid(), gen_random_uuid(), 'senior@test.com',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Senior PM", "role": "senior_dev_pm"}'::jsonb,
  'authenticated', 'authenticated', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'senior@test.com');

-- 3. Ensure profiles exist for both (idempotent)
INSERT INTO public.profiles (id, full_name, role, is_active)
SELECT
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  case
    when u.email = 'admin@test.com' then 'administrator'::user_role
    when u.email = 'senior@test.com' then 'senior_dev_pm'::user_role
    else 'junior_developer'::user_role
  end,
  true
FROM auth.users u
WHERE u.email IN ('admin@test.com', 'senior@test.com')
  AND NOT EXISTS (
    select 1 from public.profiles p where p.id = u.id
  );
