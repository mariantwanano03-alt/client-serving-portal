-- Critical fix: policies are inert unless RLS is enabled on the table.
-- `clients` and `audit_entries` had RLS disabled, which allowed any
-- authenticated caller (including administrators) to bypass every policy and
-- directly insert/update business records or forge audit entries.

begin;

alter table public.clients enable row level security;
alter table public.audit_entries enable row level security;

-- The discovery-approval flow rolls back a just-created client if the linked
-- project update fails. Keep that rollback available to active staff only;
-- administrators still have no write path.
drop policy if exists "Staff can delete clients" on public.clients;
create policy "Staff can delete clients"
  on public.clients for delete to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- Defensive: no direct writes to audit_entries. All application writes go
-- through insert_audit_entry() (SECURITY DEFINER) or trusted server code.
drop policy if exists "Authenticated users can insert audit entries" on public.audit_entries;
drop policy if exists "Users can insert audit entries" on public.audit_entries;
drop policy if exists "Admins can insert audit entries" on public.audit_entries;
drop policy if exists "System can create audit entries" on public.audit_entries;

commit;
