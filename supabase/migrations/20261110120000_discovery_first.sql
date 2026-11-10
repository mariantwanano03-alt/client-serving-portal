-- ==========================================================================
-- Discovery-First Flow Migration
-- 1. Add provisional status and promotion tracking to clients
-- 2. Create discovery_sessions table with RLS
-- ==========================================================================

-- 1. Provisional client support
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisional', 'active', 'archived')),
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS origin_discovery_id uuid NULL;

-- 2. Discovery sessions
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_title text,
  meeting_date date,
  audio_path text NULL,
  transcript text NULL,
  extraction jsonb NULL,
  generation_status text NOT NULL DEFAULT 'pending'
    CHECK (generation_status IN
      ('pending','extracting','promoting','generating','complete','failed')),
  failure_reason text NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE discovery_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ds_select_authenticated" ON discovery_sessions;
CREATE POLICY "ds_select_authenticated" ON discovery_sessions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ds_insert_authenticated" ON discovery_sessions;
CREATE POLICY "ds_insert_authenticated" ON discovery_sessions
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ds_update_senior_pm" ON discovery_sessions;
CREATE POLICY "ds_update_senior_pm" ON discovery_sessions
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role in ('senior_dev_pm', 'administrator')
              AND p.is_active = true)
  );

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project ON discovery_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_client ON discovery_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- 3. Fix document_revisions btree index limit on full-text content
DROP INDEX IF EXISTS document_revisions_content_idx;
