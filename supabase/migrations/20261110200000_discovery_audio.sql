-- ============================================================================
-- Discovery Meeting Audio Recording
-- ============================================================================

-- 1. Audio file fields on discovery_meetings
alter table discovery_meetings
  add column if not exists audio_storage_ref text,
  add column if not exists audio_file_name text,
  add column if not exists audio_content_type text,
  add column if not exists audio_duration_seconds integer;

-- 2. Indexes
create index if not exists discovery_meetings_audio_storage_ref_idx
  on discovery_meetings(audio_storage_ref) where audio_storage_ref is not null;

-- 3. Storage bucket for meeting audio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-transcripts',
  'meeting-transcripts',
  false,
  52428800,
  ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']
)
on conflict (id) do nothing;

-- 4. Storage policies (drop + recreate idempotently)
drop policy if exists "Authenticated users can upload meeting audio" on storage.objects;
create policy "Authenticated users can upload meeting audio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'meeting-transcripts');

drop policy if exists "Authenticated users can view meeting audio" on storage.objects;
create policy "Authenticated users can view meeting audio"
on storage.objects for select
to authenticated
using (bucket_id = 'meeting-transcripts');

drop policy if exists "Authenticated users can delete meeting audio" on storage.objects;
create policy "Authenticated users can delete meeting audio"
on storage.objects for delete
to authenticated
using (bucket_id = 'meeting-transcripts');
