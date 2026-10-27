-- -----------------------------------------------------------------------
-- Fix 1: Add created_by to requirements (was missing from original schema)
-- -----------------------------------------------------------------------
alter table requirements
  add column if not exists created_by uuid references profiles(id);

-- -----------------------------------------------------------------------
-- Fix 2: Allow senior_dev_pm to read ALL active profiles
--         (needed for team-assignment dropdowns in the UI)
-- -----------------------------------------------------------------------
drop policy if exists "Senior can read team profiles" on profiles;
create policy "Senior can read team profiles"
  on profiles for select
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer') and is_active);

-- -----------------------------------------------------------------------
-- Fix 3: Ensure admins can still fully manage profiles
--         (drop + recreate is idempotent — original may already exist)
-- -----------------------------------------------------------------------
drop policy if exists "Admins can manage profiles" on profiles;
create policy "Admins can manage profiles"
  on profiles for all
  to authenticated
  using  (current_user_role() = 'administrator')
  with check (current_user_role() = 'administrator');

-- -----------------------------------------------------------------------
-- Fix 4: Allow senior_dev_pm to UPDATE their own project (stage changes)
--         The existing project_policies migration only adds SELECT/INSERT.
-- -----------------------------------------------------------------------
drop policy if exists "Senior can update projects" on projects;
create policy "Senior can update projects"
  on projects for update
  to authenticated
  using  (current_user_role() = 'senior_dev_pm')
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 5: Readiness items need a standalone INSERT policy
--         (the "for all" policy may not cover INSERT without a using clause)
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert readiness items" on readiness_items;
create policy "Senior can insert readiness items"
  on readiness_items for insert
  to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- -----------------------------------------------------------------------
-- Fix 6: client_contacts "for all" policy — make sure INSERT is covered
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert client contacts" on client_contacts;
create policy "Senior can insert client contacts"
  on client_contacts for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 7: quotations / quotation_line_items — explicit INSERT policies
--         (belt-and-suspenders alongside the existing "for all" policies)
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert quotations" on quotations;
create policy "Senior can insert quotations"
  on quotations for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

drop policy if exists "Senior can insert quotation lines" on quotation_line_items;
create policy "Senior can insert quotation lines"
  on quotation_line_items for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 8: deposits / purchase_orders — explicit INSERT
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert deposits" on deposits;
create policy "Senior can insert deposits"
  on deposits for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

drop policy if exists "Senior can insert purchase orders" on purchase_orders;
create policy "Senior can insert purchase orders"
  on purchase_orders for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 9: assignments / handovers — explicit INSERT
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert assignments" on assignments;
create policy "Senior can insert assignments"
  on assignments for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

drop policy if exists "Senior can insert handovers" on handovers;
create policy "Senior can insert handovers"
  on handovers for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 10: project_stage_history — explicit INSERT
-- -----------------------------------------------------------------------
drop policy if exists "Senior can insert stage history" on project_stage_history;
create policy "Senior can insert stage history"
  on project_stage_history for insert
  to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- -----------------------------------------------------------------------
-- Fix 11: audit_entries — allow all authenticated staff to INSERT
--          (the existing policy uses with check (true) which should work,
--           but re-creating makes it explicit and idempotent)
-- -----------------------------------------------------------------------
drop policy if exists "System can create audit entries" on audit_entries;
create policy "System can create audit entries"
  on audit_entries for insert
  to authenticated
  with check (true);

