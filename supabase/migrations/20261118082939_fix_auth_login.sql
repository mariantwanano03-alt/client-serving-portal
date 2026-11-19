-- Fix: Remove is_active gate from profile RLS policy
-- The policy "Users can read their own profile" currently gates on is_active,
-- which prevents users with is_active = false from reading their profile
-- and accessing the application after sign-in.
-- This migration removes the is_active gate so active users can log in,
-- while the current_user_role() function still gating on is_active ensures
-- suspended users are effectively refused role-based access.

-- Drop the old policy that requires is_active
drop policy if exists "Users can read their own profile" on profiles;

-- Create new policy without is_active gate - any authenticated user can read their own profile
create policy "Users can read their own profile"
on profiles for select
to authenticated
using (id = auth.uid());

-- Rebuild current_user_role() WITHOUT removing the is_active check,
-- so suspended users (is_active = false) still have their role hidden
-- and are effectively refused from role-restricted features.
drop function if exists public.current_user_role();

create or replace function public.current_user_role()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;