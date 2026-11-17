-- ============================================================================
-- Discovery Meetings: controlled client onboarding workflow
-- ============================================================================
-- A Discovery Meeting is a standalone pre-client record. It captures prospective
-- client information during a discovery session, generates an AI discovery
-- document, and upon explicit approval, automatically creates a client record.
-- ============================================================================

-- 1. Discovery meetings table
create table if not exists discovery_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  status text not null default 'scheduled',
  -- Prospective client information captured during the meeting
  client_name text not null,
  primary_contact text not null,
  contact_email text,
  contact_phone text,
  company_address text,
  company_description text,
  industry text,
  business_requirements text,
  client_objectives text,
  problems_challenges text,
  required_services text,
  additional_notes text,
  -- AI-generated discovery document content (generated from meeting data)
  discovery_document_content text,
  -- Relationships
  client_id uuid references clients(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_meeting_status_check
    check (status in ('scheduled', 'in_progress', 'pending_review', 'approved', 'rejected')),
  constraint discovery_meeting_client_name_not_blank
    check (length(trim(client_name)) > 0),
  constraint discovery_meeting_primary_contact_not_blank
    check (length(trim(primary_contact)) > 0)
);

-- 2. Add content column to document_revisions for AI-generated document text
alter table document_revisions
  add column if not exists content text;

-- 3. Indexes
create index if not exists discovery_meetings_status_idx on discovery_meetings(status);
create index if not exists discovery_meetings_client_id_idx on discovery_meetings(client_id);
create index if not exists discovery_meetings_created_by_idx on discovery_meetings(created_by);
create index if not exists document_revisions_content_idx on document_revisions(content) where content is not null;

-- 4. Enable RLS
alter table discovery_meetings enable row level security;

-- 5. RLS policies for discovery_meetings
-- Staff (senior_dev_pm, junior_developer) can view all discovery meetings
create policy "Staff can view discovery meetings"
  on discovery_meetings for select
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Staff can create discovery meetings
create policy "Staff can create discovery meetings"
  on discovery_meetings for insert
  to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Senior Dev / PM and Administrator can update discovery meetings (approve/reject)
create policy "Senior can update discovery meetings"
  on discovery_meetings for update
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'administrator'))
  with check (current_user_role() in ('senior_dev_pm', 'administrator'));

-- Senior Dev / PM and Administrator can delete discovery meetings
create policy "Senior can delete discovery meetings"
  on discovery_meetings for delete
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'administrator'));
