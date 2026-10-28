-- ==========================================================================
-- Document drafting support
-- Junior Developers must be able to open an existing (initial) document and
-- draft its content. Draft content lives on the immutable revision row; each
-- save creates a new revision that stays in the review queue until a Senior
-- Developer / PM approves it.
-- ==========================================================================

alter table public.document_revisions
  add column if not exists content text;

-- Keep the parent document pointing at the newest revision and mirror its
-- review status. This trigger runs as SECURITY DEFINER so a Junior Developer
-- can submit a revision without needing UPDATE rights on documents.
create or replace function public.sync_current_document_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
  set current_revision_id = new.id,
      status = new.status
  where id = new.document_id;

  return new;
end;
$$;

-- If a revision's status changes (for example a Senior approves it), keep the
-- parent document status in sync when that revision is the current one.
create or replace function public.sync_document_status_from_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
  set status = new.status
  where id = new.document_id
    and current_revision_id = new.id;

  return new;
end;
$$;

drop trigger if exists sync_document_status_from_revision on public.document_revisions;
create trigger sync_document_status_from_revision
after update of status on public.document_revisions
for each row execute function public.sync_document_status_from_revision();

-- Backfill parent statuses that drifted from their current revision.
update public.documents d
set status = r.status
from public.document_revisions r
where r.id = d.current_revision_id
  and d.status is distinct from r.status;
