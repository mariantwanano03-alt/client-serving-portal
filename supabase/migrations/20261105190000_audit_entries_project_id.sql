-- ==========================================================================
-- Add project_id to audit_entries for project-scoped visibility
--
-- audit_entries currently stores entity_id which may be a project_id,
-- document_id, quotation_id, etc. depending on entity_type. This makes it
-- impossible to query "all audit entries for project X" reliably.
--
-- Add a dedicated project_id column so RLS and frontend queries can filter
-- by project regardless of entity_type.
-- ==========================================================================

alter table public.audit_entries
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- Backfill existing rows where we can infer the project from entity_type
-- document.* → documents.project_id
-- quotation.* → quotations.project_id
-- project.* → entity_id is the project_id
update public.audit_entries ae
set project_id = d.project_id
from public.documents d
where ae.project_id is null
  and ae.entity_type = 'document'
  and ae.entity_id = d.id;

update public.audit_entries ae
set project_id = q.project_id
from public.quotations q
where ae.project_id is null
  and ae.entity_type = 'quotation'
  and ae.entity_id = q.id;

update public.audit_entries ae
set project_id = ae.entity_id
where ae.project_id is null
  and ae.entity_type = 'project';

-- Enable RLS (idempotent)
alter table public.audit_entries enable row level security;

-- Drop and recreate policies for role-scoped visibility
drop policy if exists "Admins can view all audit entries" on public.audit_entries;
drop policy if exists "Senior can view assigned project audit entries" on public.audit_entries;
drop policy if exists "Junior can view assigned project audit entries" on public.audit_entries;
drop policy if exists "System can create audit entries" on public.audit_entries;

-- Administrator: global view of all audit entries
create policy "Admins can view all audit entries"
  on public.audit_entries for select
  to authenticated
  using (current_user_role() = 'administrator');

-- Senior Dev / PM: view audit entries for projects where they are Lead or Approver
create policy "Senior can view assigned project audit entries"
  on public.audit_entries for select
  to authenticated
  using (
    current_user_role() = 'senior_dev_pm'
    and project_id is not null
    and exists (
      select 1 from public.assignments a
      where a.project_id = audit_entries.project_id
        and a.developer_user_id = auth.uid()
        and a.is_active
        and (a.assignment_role = 'lead' or a.approval_authority = true)
    )
  );

-- Junior Developer: view audit entries for projects where they are assigned Developer
create policy "Junior can view assigned project audit entries"
  on public.audit_entries for select
  to authenticated
  using (
    current_user_role() = 'junior_developer'
    and project_id is not null
    and exists (
      select 1 from public.assignments a
      where a.project_id = audit_entries.project_id
        and a.developer_user_id = auth.uid()
        and a.is_active
        and a.assignment_role = 'developer'
    )
  );

-- System can create audit entries (unchanged)
create policy "System can create audit entries"
  on public.audit_entries for insert
  to authenticated
  with check (true);
