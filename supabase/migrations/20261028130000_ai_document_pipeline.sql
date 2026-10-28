-- ==========================================================================
-- Phase 2: AI-generated document origin + client delivery gate
-- AI drafts always carry model/version/timestamp metadata and cannot be sent
-- to a client until a Senior Developer / PM has approved the current revision.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. AI origin metadata on revisions
-- --------------------------------------------------------------------------
alter table public.document_revisions
  add column if not exists ai_model text,
  add column if not exists ai_model_version text,
  add column if not exists ai_generated_at timestamptz;

update public.document_revisions
set ai_model = coalesce(ai_model, 'Portal AI'),
    ai_model_version = coalesce(ai_model_version, 'v1'),
    ai_generated_at = coalesce(ai_generated_at, created_at)
where ai_generated = true;

create or replace function public.set_ai_origin_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.ai_generated then
    new.ai_model := coalesce(nullif(trim(new.ai_model), ''), 'Portal AI');
    new.ai_model_version := coalesce(nullif(trim(new.ai_model_version), ''), 'v1');
    new.ai_generated_at := coalesce(new.ai_generated_at, now());
  else
    new.ai_model := null;
    new.ai_model_version := null;
    new.ai_generated_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_ai_origin_defaults on public.document_revisions;
create trigger set_ai_origin_defaults
before insert or update on public.document_revisions
for each row execute function public.set_ai_origin_defaults();

-- --------------------------------------------------------------------------
-- 2. Client delivery metadata on documents
-- --------------------------------------------------------------------------
alter table public.documents
  add column if not exists sent_to_client_at timestamptz,
  add column if not exists sent_to_client_by uuid references public.profiles(id);

-- A new revision reopens the document for internal review and invalidates any
-- previous client delivery.
create or replace function public.sync_current_document_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
  set current_revision_id = new.id,
      status = new.status,
      sent_to_client_at = null,
      sent_to_client_by = null
  where id = new.document_id;

  return new;
end;
$$;

-- A revision status change (for example Senior approval) also updates the
-- parent document and clears a stale delivery state.
create or replace function public.sync_document_status_from_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
  set status = new.status,
      sent_to_client_at = null,
      sent_to_client_by = null
  where id = new.document_id
    and current_revision_id = new.id;

  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Enforce the two-step delivery gate in the database
-- --------------------------------------------------------------------------
create or replace function public.enforce_client_delivery_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  revision_status text;
begin
  if new.status = 'sent_to_client' then
    if old.status <> 'approved' then
      raise exception 'Document must be approved before it can be sent to the client';
    end if;

    select status into revision_status
    from public.document_revisions
    where id = new.current_revision_id;

    if revision_status is distinct from 'approved' then
      raise exception 'The current document revision must be approved before it can be sent to the client';
    end if;

    new.sent_to_client_at := coalesce(new.sent_to_client_at, now());
    new.sent_to_client_by := coalesce(new.sent_to_client_by, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_client_delivery_gate on public.documents;
create trigger enforce_client_delivery_gate
before update of status on public.documents
for each row execute function public.enforce_client_delivery_gate();
