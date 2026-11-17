-- ============================================================================
-- Client Serving Portal — End-to-End Workflow Restructure
-- ============================================================================
-- Extends existing tables to support the integrated workflow:
-- Create Project → New Client → Discovery Meeting → Transcript → Approval
-- → Auto Client Creation → Auto Document Generation → Readiness → Handover
-- ============================================================================

-- 1. Make projects.client_id nullable for provisional (pre-client) projects
alter table projects
  alter column client_id drop not null;

-- 2. Add provisional/onboarding tracking to projects
alter table projects
  add column if not exists is_provisional boolean not null default false,
  add column if not exists discovery_meeting_id uuid references discovery_meetings(id) on delete set null,
  add column if not exists client_creation_status text not null default 'not_required'
    check (client_creation_status in ('not_required', 'pending', 'created', 'skipped'));

-- 3. Extend discovery_meetings with transcript fields
alter table discovery_meetings
  add column if not exists transcript_text text,
  add column if not exists transcript_file_name text,
  add column if not exists transcript_content_type text,
  add column if not exists transcript_storage_ref text,
  add column if not exists transcript_processed boolean not null default false,
  add column if not exists extracted_data jsonb,
  add column if not exists extraction_status text not null default 'not_started'
    check (extraction_status in ('not_started', 'processing', 'completed', 'failed'));

-- 4. Document versions for version history
create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  revision_id uuid references document_revisions(id) on delete set null,
  version_no integer not null,
  title text not null,
  content text,
  change_summary text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

-- 5. Link readiness checks to document approvals
alter table readiness_checks
  add column if not exists prd_approved boolean not null default false,
  add column if not exists srs_approved boolean not null default false,
  add column if not exists documents_approved boolean not null default false,
  add column if not exists last_document_check timestamptz;

-- 6. Indexes
create index if not exists projects_is_provisional_idx on projects(is_provisional);
create index if not exists projects_discovery_meeting_id_idx on projects(discovery_meeting_id);
create index if not exists discovery_meetings_extraction_status_idx on discovery_meetings(extraction_status);
create index if not exists document_versions_document_id_idx on document_versions(document_id);

-- 7. Enable RLS on new tables
alter table document_versions enable row level security;

-- 8. RLS policies for document_versions
create policy "Staff can view document versions"
  on document_versions for select
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator'));

create policy "Senior can manage document versions"
  on document_versions for all
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'administrator'))
  with check (current_user_role() in ('senior_dev_pm', 'administrator'));
