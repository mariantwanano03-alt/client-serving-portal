-- ==========================================================================
-- TASK 1 / FULL-SYSTEM FIX — Discovery record columns used by the portal UI
-- and AI generation pipeline were missing from the schema.
--
-- The client (ProjectDetailClient handleAddDiscovery) and the AI pipeline
-- (/api/generate-document) both rely on:
--   - discovery_records.status          ('pending_review' | 'approved')
--   - discovery_records.audio_url       (storage public URL)
--   - discovery_records.transcription_status ('pending' | 'completed' | 'failed')
-- Without these columns the discovery capture and the AI generation happy
-- path cannot function.
-- ==========================================================================

alter table public.discovery_records
  add column if not exists status text not null default 'pending_review',
  add column if not exists audio_url text,
  add column if not exists transcription_status text;

-- Backfill existing rows defensively (no-op when column was just added).
update public.discovery_records
set status = 'pending_review'
where status is null;
