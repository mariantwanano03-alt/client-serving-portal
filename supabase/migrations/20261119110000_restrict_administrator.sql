-- Restrict `administrator` to oversight-only access.
-- Defender in depth: this migration tightens RLS so direct PostgREST/direct
-- Supabase client calls cannot perform business operations even if a UI or API
-- gate is bypassed. Existing staff roles keep their prior permissions.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles: administrator may READ users and update OTHER users through the
--    trusted API. Self-edit was previously allowed through a broad UPDATE
--    policy and allowed any user to promote themselves.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Admins can manage profiles" on public.profiles;
drop policy if exists "Users can update own theme preference" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can update other profiles" on public.profiles;

create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (current_user_role() = 'administrator');

create policy "Admins can update other profiles"
  on public.profiles for update to authenticated
  using (current_user_role() = 'administrator' and id <> auth.uid())
  with check (current_user_role() = 'administrator' and id <> auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Clients: keep read-only admin access, remove every admin/broad write path.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Admins can manage clients" on public.clients;
drop policy if exists "Allow authenticated insert clients" on public.clients;
drop policy if exists "Staff can create clients" on public.clients;
drop policy if exists "Admins can view clients" on public.clients;

create policy "Admins can view clients"
  on public.clients for select to authenticated
  using (current_user_role() = 'administrator');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Projects: keep read-only admin access, remove every admin/broad write path.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Admins can manage projects" on public.projects;
drop policy if exists "Allow authenticated insert projects" on public.projects;
drop policy if exists "Staff can create projects" on public.projects;
drop policy if exists "Senior can edit projects" on public.projects;

create policy "Senior can edit projects"
  on public.projects for update to authenticated
  using (current_user_role() = 'senior_dev_pm')
  with check (current_user_role() = 'senior_dev_pm');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Assignments / related client records: administrators may view assignments
--    as part of project oversight but may not create/change them.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Admins can manage assignments" on public.assignments;
drop policy if exists "Senior can manage assignments" on public.assignments;
drop policy if exists "Senior can insert assignments" on public.assignments;

create policy "Senior can manage assignments"
  on public.assignments for all to authenticated
  using (current_user_role() = 'senior_dev_pm')
  with check (current_user_role() = 'senior_dev_pm');

create policy "Senior can insert assignments"
  on public.assignments for insert to authenticated
  with check (current_user_role() = 'senior_dev_pm');

drop policy if exists "Admins can manage client contacts" on public.client_contacts;
drop policy if exists "Admins can manage outbox messages" on public.outbox_messages;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Documents: only senior/junior staff may write. Broad "authenticated"
--    INSERT/UPDATE policies allowed administrators to forge business records.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Allow authenticated insert documents" on public.documents;
drop policy if exists "Allow authenticated update documents" on public.documents;
drop policy if exists "Allow authenticated insert document_revisions" on public.document_revisions;
drop policy if exists "Allow authenticated update document_revisions" on public.document_revisions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Tables that may not exist in every deployment are handled defensively.
-- ─────────────────────────────────────────────────────────────────────────────
do $migration$
begin
  if to_regclass('public.document_versions') is not null then
    execute $sql$drop policy if exists "Senior can manage document versions" on public.document_versions$sql$;
    execute $sql$create policy "Senior can manage document versions" on public.document_versions for all to authenticated using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm')$sql$;
  end if;

  if to_regclass('public.discovery_meetings') is not null then
    execute $sql$drop policy if exists "Allow authenticated insert discovery meetings" on public.discovery_meetings$sql$;
    execute $sql$drop policy if exists "Admins can update discovery meetings" on public.discovery_meetings$sql$;
    execute $sql$drop policy if exists "Admins can delete discovery meetings" on public.discovery_meetings$sql$;
    execute $sql$drop policy if exists "Senior can update discovery meetings" on public.discovery_meetings$sql$;
    execute $sql$drop policy if exists "Senior can delete discovery meetings" on public.discovery_meetings$sql$;
    execute $sql$create policy "Senior can update discovery meetings" on public.discovery_meetings for update to authenticated using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm')$sql$;
    execute $sql$create policy "Senior can delete discovery meetings" on public.discovery_meetings for delete to authenticated using (current_user_role() = 'senior_dev_pm')$sql$;
  end if;
end
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Discovery sessions: RLS was not enabled; broad policies let any
--    authenticated user read/write. Restrict to active staff.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.discovery_sessions enable row level security;
drop policy if exists "Allow authenticated insert discovery sessions" on public.discovery_sessions;
drop policy if exists "Allow authenticated insert discovery_sessions" on public.discovery_sessions;
drop policy if exists "Allow authenticated select discovery_sessions" on public.discovery_sessions;
drop policy if exists "Allow authenticated update discovery_sessions" on public.discovery_sessions;
drop policy if exists "ds_insert_authenticated" on public.discovery_sessions;
drop policy if exists "ds_select_authenticated" on public.discovery_sessions;
drop policy if exists "ds_update_authenticated" on public.discovery_sessions;
drop policy if exists "Staff can view discovery sessions" on public.discovery_sessions;

create policy "Staff can view discovery sessions"
  on public.discovery_sessions for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));

create policy "Staff can insert discovery sessions"
  on public.discovery_sessions for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

create policy "Staff can update discovery sessions"
  on public.discovery_sessions for update to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'))
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Storage: meeting audio/media are business records. Only staff may access.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Authenticated users can upload meeting audio" on storage.objects;
drop policy if exists "Authenticated users can view meeting audio" on storage.objects;
drop policy if exists "Authenticated users can delete meeting audio" on storage.objects;
drop policy if exists "Authenticated users can upload discovery media" on storage.objects;
drop policy if exists "Authenticated users can view discovery media" on storage.objects;
drop policy if exists "Authenticated users can delete discovery media" on storage.objects;

create policy "Staff can upload meeting media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('meeting-transcripts', 'discovery-media')
    and current_user_role() in ('senior_dev_pm', 'junior_developer')
  );

create policy "Staff can view meeting media"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('meeting-transcripts', 'discovery-media')
    and current_user_role() in ('senior_dev_pm', 'junior_developer')
  );

create policy "Staff can delete meeting media"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('meeting-transcripts', 'discovery-media')
    and current_user_role() in ('senior_dev_pm', 'junior_developer')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Audit trail: immutable and only writable through a trusted RPC that
--    derives the actor from auth.uid(). No client can forge or edit entries.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "System can create audit entries" on public.audit_entries;

create or replace function public.insert_audit_entry(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before_value jsonb default null,
  p_after_value jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to write audit entries';
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.]{1,79}$' then
    raise exception 'Invalid audit action';
  end if;
  if p_entity_type is null or p_entity_type !~ '^[a-z][a-z0-9_.]{1,49}$' then
    raise exception 'Invalid audit entity type';
  end if;

  insert into public.audit_entries
    (actor_user_id, action, entity_type, entity_id, before_value, after_value)
  values
    (auth.uid(), p_action, p_entity_type, p_entity_id, p_before_value, p_after_value)
  returning id into v_id;

  return v_id;
end
$fn$;

revoke all on function public.insert_audit_entry(text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.insert_audit_entry(text, text, uuid, jsonb, jsonb) to authenticated;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'Audit entries are immutable';
end
$fn$;

drop trigger if exists audit_entries_immutable on public.audit_entries;
create trigger audit_entries_immutable
  before update or delete on public.audit_entries
  for each row execute function public.prevent_audit_mutation();

revoke update, delete on public.audit_entries from anon, authenticated;

commit;
