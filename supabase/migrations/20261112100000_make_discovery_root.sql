-- Skip if already applied
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261112200000') THEN
    RETURN;
  END IF;
END $$;
-- Allow discovery sessions to exist without a client or project
ALTER TABLE discovery_sessions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE discovery_sessions ALTER COLUMN client_id DROP NOT NULL;

-- Track who created the discovery session
ALTER TABLE discovery_sessions ADD COLUMN IF NOT EXISTS created_by uuid references profiles(id);
