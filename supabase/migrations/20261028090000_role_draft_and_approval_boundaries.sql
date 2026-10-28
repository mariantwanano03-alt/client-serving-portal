-- ==========================================================================
-- Role boundary hardening
-- Junior Developers may draft deliverables, but only a Senior Developer / PM
-- may approve documents, advance stages, confirm payments or verify links.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Keep documents.current_revision_id in sync after a revision is created.
--    The drafter (including a Junior Developer) is not allowed to update the
--    parent document row directly, so this runs as a SECURITY DEFINER trigger.
-- --------------------------------------------------------------------------
create or replace function public.sync_current_document_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
  set current_revision_id = new.id
  where id = new.document_id;

  return new;
end;
$$;

drop trigger if exists set_current_document_revision on public.document_revisions;
create trigger set_current_document_revision
after insert on public.document_revisions
for each row execute function public.sync_current_document_revision();

-- Backfill documents that were created before the trigger existed.
update public.documents d
set current_revision_id = latest.id
from (
  select distinct on (document_id) document_id, id
  from public.document_revisions
  order by document_id, revision_no desc
) latest
where latest.document_id = d.id
  and d.current_revision_id is null;

-- --------------------------------------------------------------------------
-- 2. Draft inserts can only enter the review queue. A Junior Developer cannot
--    self-approve a requirement/document/revision by inserting a privileged
--    status, and cannot self-verify a development link.
-- --------------------------------------------------------------------------
drop policy if exists "Staff can create requirements" on public.requirements;
create policy "Staff can create requirements"
  on public.requirements for insert
  to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and status in ('draft', 'pending_review')
  );

drop policy if exists "Staff can create documents" on public.documents;
create policy "Staff can create documents"
  on public.documents for insert
  to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and status in ('draft', 'pending_review')
  );

drop policy if exists "Staff can create revisions" on public.document_revisions;
create policy "Staff can create revisions"
  on public.document_revisions for insert
  to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and status in ('draft', 'pending_review')
  );

drop policy if exists "Staff can record development links" on public.development_links;
create policy "Staff can record development links"
  on public.development_links for insert
  to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and verified = false
    and verified_by is null
    and verified_at is null
  );

-- --------------------------------------------------------------------------
-- 3. Approval actions stay with the Senior Developer / PM.
-- --------------------------------------------------------------------------
drop policy if exists "Senior can create approvals" on public.approvals;
create policy "Senior can create approvals"
  on public.approvals for insert
  to authenticated
  with check (
    current_user_role() = 'senior_dev_pm'
    and approver_id = auth.uid()
  );

-- The original schema had no UPDATE policy for document revisions, so the
-- approval action silently failed to move a revision out of pending review.
drop policy if exists "Senior can update revisions" on public.document_revisions;
create policy "Senior can update revisions"
  on public.document_revisions for update
  to authenticated
  using (current_user_role() = 'senior_dev_pm')
  with check (current_user_role() = 'senior_dev_pm');
