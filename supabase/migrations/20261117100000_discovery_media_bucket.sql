-- ============================================================================
-- Discovery Media Storage Bucket and Project File URL
-- ============================================================================

-- 1. Storage bucket for discovery media (audio, video, documents)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'discovery-media',
  'discovery-media',
  false,
  104857600,
  ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
on conflict (id) do nothing;

-- 2. Storage policies for discovery-media
drop policy if exists "Authenticated users can upload discovery media" on storage.objects;
create policy "Authenticated users can upload discovery media"
on storage.objects for insert
to authenticated
with check (bucket_id = 'discovery-media');

drop policy if exists "Authenticated users can view discovery media" on storage.objects;
create policy "Authenticated users can view discovery media"
on storage.objects for select
to authenticated
using (bucket_id = 'discovery-media');

drop policy if exists "Authenticated users can delete discovery media" on storage.objects;
create policy "Authenticated users can delete discovery media"
on storage.objects for delete
to authenticated
using (bucket_id = 'discovery-media');

-- 3. Add file_url column to projects
alter table projects
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists file_content_type text;

-- 6. Discovery sessions table for tracking creation meetings
create table if not exists discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_title text not null,
  transcript text,
  created_by uuid references profiles(id) on delete cascade,
  generation_status text not null default 'pending',
  meeting_date date not null default now(),
  created_at timestamptz not null default now()
);

-- Allow all authenticated users to insert discovery sessions
create policy "Allow authenticated insert discovery sessions"
  on discovery_sessions for insert
  to authenticated
  with check (true);

-- Staff can view all discovery sessions
create policy "Staff can view discovery sessions"
  on discovery_sessions for select
  to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer', 'administrator'));
