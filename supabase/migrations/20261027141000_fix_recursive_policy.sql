-- ==========================================================================
-- HOTFIX: Remove the recursive profiles policy that caused
-- "infinite recursion detected in policy for relation profiles"
-- ==========================================================================

-- Drop the broken policy that self-references the profiles table
drop policy if exists "Staff can read active profiles" on profiles;

-- Replace with a version that uses current_user_role() which is
-- SECURITY DEFINER — it bypasses RLS when it reads profiles,
-- so there is NO recursion.
create policy "Staff can read active profiles"
  on profiles for select
  to authenticated
  using (
    is_active = true
    and current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator')
  );

