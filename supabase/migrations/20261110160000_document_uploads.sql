-- Private bucket for uploaded source documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('document-uploads', 'document-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Schema delta: track uploaded originals on document_revisions
ALTER TABLE document_revisions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'manual', 'uploaded')),
  ADD COLUMN IF NOT EXISTS uploaded_file_path text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_file_name text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_file_size bigint NULL,
  ADD COLUMN IF NOT EXISTS uploaded_mime_type text NULL;

-- Backfill existing rows
UPDATE document_revisions SET source = 'ai' WHERE source IS NULL;

-- Authenticated users can read their own project's uploads
DROP POLICY IF EXISTS "doc_uploads_select_authenticated" ON storage.objects;
CREATE POLICY "doc_uploads_select_authenticated"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'document-uploads'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "doc_uploads_insert_authenticated" ON storage.objects;
CREATE POLICY "doc_uploads_insert_authenticated"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'document-uploads'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "doc_uploads_delete_owner" ON storage.objects;
CREATE POLICY "doc_uploads_delete_owner"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'document-uploads'
    AND auth.uid() = owner
  );
