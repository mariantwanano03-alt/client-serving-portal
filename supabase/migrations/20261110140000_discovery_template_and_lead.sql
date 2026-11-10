-- Add template column to discovery_sessions
ALTER TABLE discovery_sessions ADD COLUMN IF NOT EXISTS template text;

-- Add developer_lead column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS developer_lead uuid REFERENCES profiles(id);

-- Create discovery-media storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('discovery-media', 'discovery-media', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for discovery-media
DROP POLICY IF EXISTS "Authenticated users can upload discovery media" ON storage.objects;
CREATE POLICY "Authenticated users can upload discovery media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'discovery-media');

DROP POLICY IF EXISTS "Authenticated users can read discovery media" ON storage.objects;
CREATE POLICY "Authenticated users can read discovery media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'discovery-media');
